import type { GroupListItem } from '@/lib/groups'
import { describe, expect, test, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'

/**
 * The groups index: a list, and every row a link to that group's own page.
 *
 * The loader and the staff check are mocked so this measures the list. Who can
 * see which group is the database's decision — `group_summary` is
 * `security_invoker` — and is verified there, not here.
 */
let GROUPS: GroupListItem[] = []

vi.mock('next/navigation', () => ({
  redirect: () => {
    throw new Error('unexpected redirect')
  },
}))
vi.mock('@/lib/staff', () => ({
  getCurrentStaff: async () => ({ id: 's1', full_name: 'A Adviser', status: 'active' }),
}))
vi.mock('@/lib/groups', () => ({ getVisibleGroups: async () => GROUPS }))

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

const show = async (groups: GroupListItem[]) => {
  GROUPS = groups
  render(await GroupsIndexPage())
}

describe('the groups index', () => {
  test('every group is a link to its own page', async () => {
    await show([
      group(),
      group({ group_id: 'g2', name: 'Acme Pty Ltd', group_type: 'business_entity' }),
    ])

    const one = screen.getByRole('link', { name: /Testsmith Household/ })
    const two = screen.getByRole('link', { name: /Acme Pty Ltd/ })
    expect(one.getAttribute('href')).toBe('/groups/g1')
    expect(two.getAttribute('href')).toBe('/groups/g2')
  })

  /**
   * The WHOLE row is the link, not just the name. A 120px name inside a wide
   * row is a target people miss, and there is nothing else on the row to click
   * so nothing is being swallowed.
   */
  test('the row itself is the link, carrying the second line with it', async () => {
    await show([group()])
    const link = screen.getByRole('link', { name: /Testsmith Household/ })
    expect(link.textContent).toContain('Household')
    expect(link.textContent).toContain('3 members')
    expect(link.textContent).toContain('Jane Testsmith')
    // One link per row, so the row is not two overlapping targets.
    expect(screen.getAllByRole('link')).toHaveLength(1)
  })

  test('the groups are one list, and the count says how many', async () => {
    await show([group(), group({ group_id: 'g2', name: 'Acme Pty Ltd' })])
    expect(screen.getAllByRole('listitem')).toHaveLength(2)
    expect(screen.getAllByRole('list')).toHaveLength(1)
    expect(screen.getByText('2 groups')).toBeTruthy()
  })

  test('one group is counted in the singular', async () => {
    await show([group()])
    expect(screen.getByText('1 group')).toBeTruthy()
  })

  /** The type is read as words, not as the enum value. */
  test('a business entity reads as one rather than as its enum value', async () => {
    await show([group({ group_type: 'business_entity' })])
    const link = screen.getByRole('link', { name: /Testsmith Household/ })
    expect(link.textContent).toContain('Business entity')
    expect(link.textContent).not.toContain('business_entity')
  })

  /**
   * Marked only when NOT active, the rule the accounts list already follows.
   * A pill on every row says nothing; a pill on the prospect says something.
   */
  test('a status is marked only when it is not active', async () => {
    await show([group({ status: 'prospect' })])
    const row = screen.getByRole('listitem')
    expect(within(row).getByText('prospect')).toBeTruthy()
  })

  test('an active group carries no status pill', async () => {
    await show([group({ status: 'active' })])
    const row = screen.getByRole('listitem')
    expect(within(row).queryByText('active')).toBeNull()
  })

  test('a group with nobody on it still reads as a row, not a blank', async () => {
    await show([group({ member_count: null, primary_contact: null })])
    const link = screen.getByRole('link', { name: /Testsmith Household/ })
    expect(link.textContent).toContain('0 members')
    expect(link.textContent).toContain('Household')
  })

  /**
   * **Not "there are no client groups".** An adviser sees the groups they own
   * or are assigned to, so an empty list far more often means nobody has
   * assigned them any than that the firm has no clients — and telling them the
   * wrong one of those sends them to the wrong person.
   */
  test('an empty list explains that visibility is per-adviser', async () => {
    await show([])
    expect(screen.queryByRole('list')).toBeNull()
    expect(screen.getByText(/No client groups to show/)).toBeTruthy()
    expect(document.body.textContent).toMatch(/own or have been given access to/)
    expect(document.body.textContent).toMatch(/ask an administrator/i)
  })

  test('the page names itself and what the list is', async () => {
    await show([group()])
    expect(screen.getByRole('heading', { level: 1, name: 'Groups' })).toBeTruthy()
  })
})
