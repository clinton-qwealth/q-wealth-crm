import { render } from '@testing-library/react'
import { beforeEach, describe, expect, test, vi } from 'vitest'

/**
 * The Administration page's shape, asked for on 20 September 2026: three
 * columns like the group page, the working area in the middle, and **Users as
 * the first tab**, User groups second, the audit trail last.
 *
 * Both are the kind of change that looks like nothing in a diff and is noticed
 * only by whoever opens the page expecting the old arrangement — so both are
 * pinned. The flanking columns are deliberately empty and stay in the markup:
 * they are the reserved space Clinton asked to keep, not placeholders.
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
/* The two panels are stubbed: this file is about where they sit, not what they
   render, and both drag in the whole drawer and feed machinery otherwise. */
vi.mock('@/components/audit-trail', () => ({ AuditTrail: () => <div data-slot="audit-panel" /> }))
vi.mock('@/components/staff-list', () => ({ StaffList: () => <div data-slot="staff-panel" /> }))
vi.mock('@/components/user-group-list', () => ({ UserGroupList: () => <div data-slot="user-groups-panel" /> }))
vi.mock('@/components/template-list', () => ({ TemplateList: () => <div data-slot="templates-panel" /> }))

const { default: AdminPage } = await import('@/app/(shell)/admin/page')
const page = async () => render(await AdminPage())

beforeEach(() => {
  manageStaff = true
})

describe('the Administration page', () => {
  /* User groups between them since the evening of 20 September: another
     thing to use, so it sits with Users rather than after the trail. */
  test('Users first, then User groups and Templates, the audit trail last', async () => {
    const { getAllByRole } = await page()
    /* Templates joined on 23 Sep, THIRD: another thing an administrator comes
       here to use, so it goes with Users and User groups rather than after the
       trail, which stays last as the rarer errand.

       Roles joined on 24 Sep and sits IMMEDIATELY AFTER Templates, because it
       holds the names a template picks from. The order is the assertion: a
       role list parked after the audit trail, or ahead of the templates it
       serves, would separate the two things read together. */
    expect(getAllByRole('tab').map((t) => t.textContent)).toEqual([
      'Users',
      'User groups',
      'Templates',
      'Roles',
      'Audit trail',
    ])
  })

  test('the first tab is the one selected, so Users is what opens', async () => {
    const { getAllByRole } = await page()
    const selected = getAllByRole('tab').filter((t) => t.getAttribute('aria-selected') === 'true')
    expect(selected.map((t) => t.textContent)).toEqual(['Users'])
  })

  /* 3 / 6 / 3 over the shell's twelve columns — the group page's split, so the
     two pages an administrator moves between do not rearrange themselves. */
  test('three columns, with the working area in the middle', async () => {
    const { container } = await page()
    /* Only the three that carry a column span — the page heading is also
       `col-span-full` and is not one of the columns. */
    const cols = Array.from(container.querySelectorAll<HTMLElement>(':scope > div[class*="lg:col-span-"]'))
    expect(cols.map((c) => (c.className.match(/lg:col-span-\d+/) ?? [''])[0])).toEqual([
      'lg:col-span-3',
      'lg:col-span-6',
      'lg:col-span-3',
    ])
    expect(cols[1]!.querySelector('[data-slot="staff-panel"]'), 'the work sits in the centre').toBeTruthy()
  })

  test('the flanking columns are reserved and empty, not filled with placeholders', async () => {
    const { container } = await page()
    const cols = Array.from(container.querySelectorAll<HTMLElement>(':scope > div[class*="lg:col-span-"]'))
    expect(cols[0]!.textContent).toBe('')
    expect(cols[2]!.textContent).toBe('')
  })

  test('somebody without manage_staff still gets not-found, before any of this', async () => {
    manageStaff = false
    await expect(page()).rejects.toThrow('notFound')
  })
})
