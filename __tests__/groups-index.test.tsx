import type { GroupListItem, ServiceProviderItem } from '@/lib/groups'
import { describe, expect, test, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'

/**
 * The client pages: a menu of four registers, and the chosen one's list.
 *
 * Reshaped 25 September 2026 to the Administration page's layout — menu left,
 * register in the middle, section in the URL. The loaders and the staff check
 * are mocked so this measures the page; who can see which group is the
 * database's decision (`group_summary` is `security_invoker`) and is verified
 * there, not here.
 *
 * What a plausible implementation gets wrong, and what each block pins:
 *
 * - **The sections show one list.** Households and entities come from the SAME
 *   query, split by `group_type`; forget the filter and every register shows
 *   everything, which looks fine with one kind of test fixture.
 * - **A future group_type vanishes.** Two exact filters (`=== household`,
 *   `=== business_entity`) put a new type — a trust, an SMSF — in NO section.
 *   Entities is deliberately the remainder, and the trust test is the proof.
 * - **Provider rows navigate.** A provider has no page; a row that links 404s.
 * - **A bad section falls back silently** instead of answering not-found.
 */
let GROUPS: GroupListItem[] = []
let PROVIDERS: ServiceProviderItem[] = []

vi.mock('next/navigation', () => ({
  redirect: () => {
    throw new Error('unexpected redirect')
  },
  notFound: () => {
    throw new Error('notFound')
  },
}))
vi.mock('@/lib/staff', () => ({
  getCurrentStaff: async () => ({ id: 's1', full_name: 'A Adviser', status: 'active' }),
}))
vi.mock('@/lib/groups', () => ({
  getVisibleGroups: async () => GROUPS,
  getServiceProviders: async () => PROVIDERS,
}))

const { default: GroupsIndexPage } = await import('@/app/(shell)/groups/page')

const group = (o: Partial<GroupListItem> = {}): GroupListItem => ({
  group_id: 'g1',
  name: 'Testsmith Household',
  group_type: 'household',
  status: 'active',
  member_count: 3,
  primary_contact: 'Jane Testsmith',
  ...o,
})

const MIXED = [
  group(),
  group({ group_id: 'g2', name: 'Acme Pty Ltd', group_type: 'business_entity' }),
]

/* The register's own panel. The menu is a list of four items too, so any
   listitem/list query has to be scoped here or it counts the menu. */
const register = () => within(document.querySelector('.qw-section-in') as HTMLElement)

const show = async (groups: GroupListItem[], section?: string) => {
  GROUPS = groups
  return render(
    await GroupsIndexPage(section === undefined ? undefined : { searchParams: Promise.resolve({ section }) }),
  )
}

describe('the menu', () => {
  test('lists the four registers, in order, as links', async () => {
    await show([group()])
    const menu = screen.getByRole('navigation', { name: 'Client sections' })
    const links = Array.from(menu.querySelectorAll('a'))
    expect(links.map((a) => a.textContent)).toEqual([
      'Client households',
      'Legal entities / structures',
      'Service providers',
      'Referral partners',
    ])
    expect(links.map((a) => a.getAttribute('href'))).toEqual([
      '/groups',
      '/groups?section=entities',
      '/groups?section=providers',
      '/groups?section=referrers',
    ])
  })

  test('marks the register you are on, and /groups opens on households', async () => {
    await show([group()])
    const menu = screen.getByRole('navigation', { name: 'Client sections' })
    const current = Array.from(menu.querySelectorAll('a[aria-current="page"]'))
    expect(current.map((a) => a.textContent)).toEqual(['Client households'])
  })

  test('a section that does not exist is not found, and so is a repeated one', async () => {
    await expect(show([group()], 'nope')).rejects.toThrow('notFound')
    await expect(
      GroupsIndexPage({ searchParams: Promise.resolve({ section: ['households', 'entities'] }) }),
    ).rejects.toThrow('notFound')
  })

  test('the heading names the register, invisibly — the admin page’s call', async () => {
    const { unmount } = await show([group()], 'providers')
    const h1 = screen.getByRole('heading', { level: 1 })
    expect(h1.textContent).toBe('Service providers')
    expect(h1.className).toContain('sr-only')
    unmount()
    await show([group()])
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Client households')
  })

  /* The admin page's columns, so the two sectioned pages do not rearrange
     themselves — 3/6/3 at lg, the menu narrowing to 2/7/3 from xl. */
  test('three columns, the menu bare on the left, the register faded in a card', async () => {
    const { container } = await show([group()])
    const cols = Array.from(container.querySelectorAll<HTMLElement>(':scope > div[class*="lg:col-span-"]'))
    expect(cols.map((c) => (c.className.match(/lg:col-span-\d+/) ?? [''])[0])).toEqual([
      'lg:col-span-3',
      'lg:col-span-6',
      'lg:col-span-3',
    ])
    expect(cols[0]!.querySelector('nav')).toBeTruthy()
    expect(cols[0]!.querySelector('section'), 'the menu is not boxed in a card').toBeNull()
    expect(cols[1]!.querySelector('.qw-section-in'), 'the register carries the section fade').toBeTruthy()
    expect(cols[2]!.textContent, 'the right column is reserved').toBe('')
  })
})

describe('the household register', () => {
  test('shows households only — the entity belongs to the other register', async () => {
    await show(MIXED)
    expect(screen.getByRole('link', { name: /Testsmith Household/ })).toBeTruthy()
    expect(screen.queryByRole('link', { name: /Acme Pty Ltd/ })).toBeNull()
    expect(screen.getByText('1 household')).toBeTruthy()
  })

  test('every group is a link to its own page, and the whole row is the link', async () => {
    await show([group()])
    const link = screen.getByRole('link', { name: /Testsmith Household/ })
    expect(link.getAttribute('href')).toBe('/groups/g1')
    expect(link.textContent).toContain('Household')
    expect(link.textContent).toContain('3 members')
    expect(link.textContent).toContain('Jane Testsmith')
  })

  test('counts in the plural when there are several', async () => {
    await show([group(), group({ group_id: 'g3', name: 'Second Household' })])
    expect(screen.getByText('2 households')).toBeTruthy()
    expect(register().getAllByRole('listitem')).toHaveLength(2)
  })

  /**
   * Marked only when NOT active, the rule the accounts list already follows.
   * A pill on every row says nothing; a pill on the prospect says something.
   */
  test('a status is marked only when it is not active', async () => {
    await show([group({ status: 'prospect' })])
    expect(within(register().getByRole('listitem')).getByText('prospect')).toBeTruthy()
  })

  test('an active group carries no status pill', async () => {
    await show([group({ status: 'active' })])
    expect(within(register().getByRole('listitem')).queryByText('active')).toBeNull()
  })

  test('a group with nobody on it still reads as a row, not a blank', async () => {
    await show([group({ member_count: null, primary_contact: null })])
    expect(screen.getByRole('link', { name: /Testsmith Household/ }).textContent).toContain('0 members')
  })

  /**
   * **Not "there are no client households".** An adviser sees the groups they
   * own or are assigned to, so an empty list far more often means nobody has
   * assigned them any — and telling them the wrong one of those sends them to
   * the wrong person.
   */
  test('an empty register explains that visibility is per-adviser', async () => {
    await show([])
    expect(register().queryByRole('list'), 'no sheet is drawn around nothing').toBeNull()
    expect(screen.getByText(/No client households to show/)).toBeTruthy()
    expect(document.body.textContent).toMatch(/own or have been given access to/)
    expect(document.body.textContent).toMatch(/ask an administrator/i)
  })
})

describe('the entities register', () => {
  test('shows the entity, reads its type as words, and leaves the household out', async () => {
    await show(MIXED, 'entities')
    const link = screen.getByRole('link', { name: /Acme Pty Ltd/ })
    expect(link.textContent).toContain('Business entity')
    expect(link.textContent).not.toContain('business_entity')
    expect(screen.queryByRole('link', { name: /Testsmith Household/ })).toBeNull()
    expect(screen.getByText('1 entity')).toBeTruthy()
  })

  /**
   * The remainder, not an exact match: a group_type this page has never heard
   * of — a trust, an SMSF — lands HERE rather than in no register at all.
   * Mutation, and it was run: change the entities filter to
   * `=== 'business_entity'` — this fails with the trust in no section.
   */
  test('a group_type nobody has heard of still lands in a register', async () => {
    await show([group({ group_id: 'g9', name: 'Testsmith Family Trust', group_type: 'trust' })], 'entities')
    expect(screen.getByRole('link', { name: /Testsmith Family Trust/ })).toBeTruthy()
  })
})

describe('the provider register', () => {
  test('lists providers by name, and the rows are NOT links — there is nowhere to go', async () => {
    PROVIDERS = [
      { party_id: 'p1', name: 'Macquarie Wrap', since: '2024-03-01' },
      { party_id: 'p2', name: 'HUB24', since: null },
    ]
    await show([], 'providers')
    expect(screen.getByText('Macquarie Wrap')).toBeTruthy()
    expect(screen.getByText('HUB24')).toBeTruthy()
    expect(screen.getByText('2 providers')).toBeTruthy()
    expect(screen.getByText(/since 2024/)).toBeTruthy()
    expect(screen.getByText('Macquarie Wrap').closest('a')).toBeNull()
  })

  test('an empty register says what a provider is, not that something failed', async () => {
    PROVIDERS = []
    await show([], 'providers')
    expect(screen.getByText(/No service providers recorded/)).toBeTruthy()
  })
})

describe('the referrers register', () => {
  test('says plainly that nothing is modelled yet', async () => {
    await show([], 'referrers')
    expect(screen.getByText(/Referral partners are not tracked yet/)).toBeTruthy()
    expect(document.body.textContent).toMatch(/not yet modelled/)
  })
})
