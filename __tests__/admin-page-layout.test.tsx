import { render } from '@testing-library/react'
import { beforeEach, describe, expect, test, vi } from 'vitest'

/**
 * The Administration page's shape: three columns like the group page, a menu
 * of sections on the left, the chosen section's tabs in the middle, and the
 * right column reserved.
 *
 * Asked for on 20 September 2026 as three columns with Users first; regrouped
 * on 24 September behind a vertical menu — User management, Workflow
 * management, Observability — with the section carried in `?section=`.
 *
 * Every assertion here is the kind of change that looks like nothing in a diff
 * and is noticed only by whoever opens the page expecting the old arrangement,
 * so each is pinned. What a plausible implementation gets wrong:
 *
 * - **The menu is buttons.** It renders, it switches, and nobody can send a
 *   colleague to the roles list or use the back button to leave it.
 * - **A bad `?section=` falls back to the first one.** A mistyped bookmark
 *   silently opens User management and the roles look like they have vanished.
 * - **The tabs remember the previous section's selection.** `Tabs` holds its
 *   selected id in state; a move between sections that reuses the instance
 *   leaves "templates" selected in a set that has no such tab. Only a key on
 *   the section prevents it, and only a re-render across sections shows it.
 */
let manageStaff = true

vi.mock('next/navigation', () => ({
  redirect: () => { throw new Error('redirect') },
  notFound: () => { throw new Error('notFound') },
}))
vi.mock('@/lib/staff', () => ({
  getCurrentStaff: async () => ({ id: 's1', access_profiles: { manage_staff: manageStaff } }),
}))
vi.mock('@/lib/admin', () => ({
  AUDIT_PAGE_SIZE: 50,
  isAdmin: (s: { access_profiles: { manage_staff: boolean } }) => s.access_profiles.manage_staff,
  getAuditEntries: async () => ({ entries: [], hasMore: false }),
  getAuditActors: async () => [],
  getStaffForAdmin: async () => [],
  getAccessProfiles: async () => [],
  getUserGroupsForAdmin: async () => [],
  getTemplatesForAdmin: async () => [],
  getWorkflowRoles: async () => [],
}))
/* The panels are stubbed: this file is about where they sit, not what they
   render, and each drags in the whole drawer and feed machinery otherwise. */
vi.mock('@/components/audit-trail', () => ({ AuditTrail: () => <div data-slot="audit-panel" /> }))
vi.mock('@/components/staff-list', () => ({ StaffList: () => <div data-slot="staff-panel" /> }))
vi.mock('@/components/user-group-list', () => ({ UserGroupList: () => <div data-slot="user-groups-panel" /> }))
vi.mock('@/components/template-list', () => ({ TemplateList: () => <div data-slot="templates-panel" /> }))
vi.mock('@/components/workflow-role-list', () => ({ WorkflowRoleList: () => <div data-slot="roles-panel" /> }))

const { default: AdminPage } = await import('@/app/(shell)/admin/page')

/** `/admin` with no section, or `/admin?section=<section>`. */
const page = async (section?: string) =>
  render(await AdminPage(section === undefined ? undefined : { searchParams: Promise.resolve({ section }) }))

const columns = (container: HTMLElement) =>
  Array.from(container.querySelectorAll<HTMLElement>(':scope > div[class*="lg:col-span-"]'))

beforeEach(() => {
  manageStaff = true
})

describe('the Administration menu', () => {
  test('lists User management, Workflow management and Observability, in that order, as links', async () => {
    const { getByRole } = await page()
    const menu = getByRole('navigation', { name: 'Administration sections' })
    const links = Array.from(menu.querySelectorAll('a'))
    /* Links, with hrefs — not buttons. The menu is navigation, and a bookmark
       to the roles list has to be possible. */
    expect(links.map((a) => a.textContent)).toEqual([
      'User management',
      'Workflow management',
      'Observability',
    ])
    expect(links.map((a) => a.getAttribute('href'))).toEqual([
      '/admin',
      '/admin?section=workflows',
      '/admin?section=observability',
    ])
  })

  test('marks the section you are on, and only that one', async () => {
    const { getByRole } = await page('workflows')
    const menu = getByRole('navigation', { name: 'Administration sections' })
    const current = Array.from(menu.querySelectorAll('a[aria-current="page"]'))
    expect(current.map((a) => a.textContent)).toEqual(['Workflow management'])
  })

  test('a section that does not exist is not found, the same as any other wrong URL', async () => {
    await expect(page('nope')).rejects.toThrow('notFound')
  })

  /* Next hands a repeated key over as an array. Two sections is not a request
     this page can honour, and picking the first would be guessing. */
  test('two sections at once is not a request it will guess at', async () => {
    await expect(
      AdminPage({ searchParams: Promise.resolve({ section: ['users', 'workflows'] }) }),
    ).rejects.toThrow('notFound')
  })
})

describe('the sections', () => {
  test('/admin opens on User management: Users first, then User groups', async () => {
    const { getAllByRole, getByRole } = await page()
    expect(getAllByRole('tab').map((t) => t.textContent)).toEqual(['Users', 'User groups'])
    const menu = getByRole('navigation', { name: 'Administration sections' })
    expect(menu.querySelector('a[aria-current="page"]')?.textContent).toBe('User management')
  })

  test('Workflow management holds Templates, then the Roles they pick from', async () => {
    const { getAllByRole } = await page('workflows')
    /* Roles after Templates, because it holds the names a template picks
       from. The order is the assertion: a role list ahead of the templates
       it serves would separate the two things read together. */
    expect(getAllByRole('tab').map((t) => t.textContent)).toEqual(['Templates', 'Roles'])
  })

  test('Observability holds the audit trail', async () => {
    const { getAllByRole } = await page('observability')
    expect(getAllByRole('tab').map((t) => t.textContent)).toEqual(['Audit trail'])
  })

  test('the first tab is the one selected, so each section opens on something', async () => {
    for (const section of [undefined, 'workflows', 'observability']) {
      const { getAllByRole, unmount } = await page(section)
      const selected = getAllByRole('tab').filter((t) => t.getAttribute('aria-selected') === 'true')
      expect(selected.length, `section ${section ?? 'users'} has one selected tab`).toBe(1)
      unmount()
    }
  })

  /**
   * The h1 names the section and spends no pixels. The visible heading block
   * went on 25 September — the top bar's pill names the area, the menu's mark
   * names the section, and the block restating both just pushed the work down
   * the page. The h1 itself STAYS, `sr-only`, because a reader navigating by
   * headings needs an anchor; deleting it outright would pass a "no heading
   * block" assertion while quietly removing the page's name from assistive
   * output — which is why both halves are asserted here.
   */
  test('the heading names the section, invisibly', async () => {
    const { getByRole, unmount } = await page('workflows')
    const h1 = getByRole('heading', { level: 1 })
    expect(h1.textContent).toBe('Workflow management')
    expect(h1.className).toContain('sr-only')
    unmount()
    const second = await page()
    expect(second.getByRole('heading', { level: 1 }).textContent).toBe('User management')
  })

  /**
   * The tab strip must not carry a selection across sections.
   *
   * Rendered as a re-render of ONE React root — first Workflow management,
   * then User management into the same container — because that is what a
   * client-side navigation does, and it is the only way the bug shows: a
   * fresh render per section always starts clean. Mutation, and it was run:
   * remove `key={section.id}` from the working area's wrapper in the page —
   * this fails with zero selected tabs.
   *
   * That key also replays the section's fade, so removing it breaks both at
   * once. The fade is asserted separately below, since a class can be dropped
   * without the key going with it.
   */
  test('moving between sections does not carry the old selection over', async () => {
    const first = await AdminPage({ searchParams: Promise.resolve({ section: 'workflows' }) })
    const { rerender, getAllByRole } = render(first)
    expect(getAllByRole('tab').filter((t) => t.getAttribute('aria-selected') === 'true').map((t) => t.textContent)).toEqual(['Templates'])

    rerender(await AdminPage())
    expect(getAllByRole('tab').filter((t) => t.getAttribute('aria-selected') === 'true').map((t) => t.textContent)).toEqual(['Users'])
  })
})

describe('the columns', () => {
  /* 3 / 6 / 3 over the shell's twelve columns — the group page's split, so the
     two pages an administrator moves between do not rearrange themselves. */
  test('three columns: the menu on the left, the working area in the middle', async () => {
    const { container } = await page()
    /* Only the three that carry a column span — the page heading is also
       `col-span-full` and is not one of the columns. */
    const cols = columns(container)
    expect(cols.map((c) => (c.className.match(/lg:col-span-\d+/) ?? [''])[0])).toEqual([
      'lg:col-span-3',
      'lg:col-span-6',
      'lg:col-span-3',
    ])
    /* Narrower from xl, 25 Sep 2026: three short labels do not need a quarter
       of a wide screen, and the working area takes what they give up. The
       right column carries no xl span of its own and keeps its 3, so the row
       still sums to twelve. Only at xl — see the page for why not lg. */
    expect(cols.map((c) => (c.className.match(/xl:col-span-\d+/) ?? [''])[0])).toEqual([
      'xl:col-span-2',
      'xl:col-span-7',
      '',
    ])
    expect(cols[0]!.querySelector('nav'), 'the menu sits on the left').toBeTruthy()
    /* The frosted rail, shared with /groups so the twins keep matching. */
    expect(cols[0]!.className, 'on the frosted rail').toContain('backdrop-blur')
    /* Bare: the menu is chrome, not a record, so it gets no card of its own.
       A `section` here would be the Card's element. */
    expect(cols[0]!.querySelector('section'), 'the menu is not boxed in a card').toBeNull()
    expect(cols[1]!.querySelector('[data-slot="staff-panel"]'), 'the work sits in the centre').toBeTruthy()
  })

  /* The fade that joins the click to the content landing a round trip later.
     A CSS animation runs on MOUNT, so the class is only half of it — the key
     on the same element is what replays it, and that is pinned above. */
  test('the working area fades its section in', async () => {
    const { container } = await page()
    const faded = columns(container)[1]!.querySelector('.qw-section-in')
    expect(faded, 'the working area carries the section fade').toBeTruthy()
    /* Inside the card, not around it: fading the border and shadow too would
       read as the card blinking rather than as its contents changing. */
    expect(faded!.closest('section'), 'the fade is inside the card').toBeTruthy()
  })

  test('the right column is reserved and empty, not filled with a placeholder', async () => {
    const { container } = await page()
    expect(columns(container)[2]!.textContent).toBe('')
  })

  test('somebody without manage_staff still gets not-found, before any of this', async () => {
    manageStaff = false
    await expect(page()).rejects.toThrow('notFound')
  })
})
