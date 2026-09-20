import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, test, vi } from 'vitest'
import type { UserGroupRow } from '@/lib/admin'

/**
 * The User groups tab and the drawer it opens.
 *
 * What a plausible screen would get wrong: a plural where there is one; a
 * members form without the sentinel, so emptying it does nothing; a form that
 * forgets which group it is about; a drawer per row.
 */
vi.mock('@/app/(shell)/admin/actions', () => ({
  createUserGroup: vi.fn(async () => ({ ok: true as const })),
  saveUserGroupDetails: vi.fn(async () => ({ ok: true as const })),
  addUserGroupMember: vi.fn(async () => ({ ok: true as const })),
  removeUserGroupMember: vi.fn(async () => ({ ok: true as const })),
}))
const { UserGroupList } = await import('@/components/user-group-list')

/* s1 and s2 are members of North; s3 is not, and matches a search for "e". */
const STAFF = [
  { id: 's1', name: 'Sarah Chen' },
  { id: 's2', name: 'Reece Testlee' },
  { id: 's3', name: 'Nina New' },
]
const NORTH: UserGroupRow = { id: 'ug-north', name: 'North', status: 'active', created_at: '2026-09-20T00:00:00+00:00', members: [{ id: 's1', name: 'Sarah Chen' }, { id: 's2', name: 'Reece Testlee' }], household_count: 5 }
const OLD: UserGroupRow = { id: 'ug-old', name: 'Old territory', status: 'archived', created_at: '2026-09-01T00:00:00+00:00', members: [{ id: 's2', name: 'Reece Testlee' }], household_count: 1 }

const list = (groups: UserGroupRow[] = [NORTH, OLD]) => render(<UserGroupList groups={groups} staff={STAFF} />)
const open = (name: string) => act(() => { fireEvent.click(screen.getByRole('button', { name: `Open ${name}` })) })
const drawer = (c: HTMLElement) => c.querySelector<HTMLElement>('dialog.qw-drawer')!
const edit = (d: HTMLElement, box: string) => act(() => { fireEvent.click(within(d).getByRole('button', { name: `Edit ${box}` })) })

describe('the user group list', () => {
  test('a row carries the name, its counts in the right number, and its status', () => {
    const { container } = list()
    const rows = container.querySelectorAll('li')
    expect(rows[0]!.textContent).toContain('North')
    expect(rows[0]!.textContent).toContain('2 members · 5 households')
    /* Singular for one of either. A list of territories is mostly small
       numbers, so "1 members" is the wrong-looking case that happens most. */
    expect(rows[1]!.textContent).toContain('1 member · 1 household')
    expect(rows[1]!.textContent).not.toContain('1 members')
  })

  /* The status pill carries its state in the COLOUR as well as the word:
     `on` is the green that marks something live everywhere in this app, and an
     archived group wearing it would read as active at a glance. */
  test('an active group’s pill is the live one and an archived group’s is not', () => {
    const { container } = list()
    const pill = (row: Element) => row.querySelector('span[class*="ring-"]')!
    const rows = container.querySelectorAll('li')
    expect(pill(rows[0]!).textContent).toBe('Active')
    expect(pill(rows[0]!).className).toContain('emerald')
    expect(pill(rows[1]!).textContent).toBe('Archived')
    expect(pill(rows[1]!).className, 'archived must not wear the live green').not.toContain('emerald')
  })

  test('renders ONE drawer however many groups there are, and the second row opens the second group', () => {
    const { container } = list()
    expect(container.querySelectorAll('dialog.qw-drawer')).toHaveLength(1)
    open('Old territory')
    expect(within(drawer(container)).getByRole('heading', { level: 2 }).textContent).toBe('Old territory')
  })

  test('empty shows the empty state with the rule and a prominent create control; populated puts a quiet one in the toolbar', () => {
    const { container, unmount } = list([])
    expect(container.textContent).toContain('No user groups yet')
    expect(container.textContent).toContain('limited user can see')
    expect(screen.getByRole('button', { name: 'New user group' })).toBeTruthy()
    expect(container.querySelector('[data-slot="section-toolbar"]')).toBeNull()
    unmount()
    const { container: c2 } = list()
    expect(within(c2.querySelector<HTMLElement>('[data-slot="section-toolbar"]')!).getByRole('button', { name: 'New user group' })).toBeTruthy()
  })

  test('the create dialog has one field, capped at the database’s sixty', async () => {
    const { createUserGroup } = await import('@/app/(shell)/admin/actions')
    list()
    act(() => { fireEvent.click(screen.getByRole('button', { name: 'New user group' })) })
    const name = screen.getByPlaceholderText('e.g. Sydney') as HTMLInputElement
    expect([name.name, name.required, name.maxLength]).toEqual(['name', true, 60])
    await act(async () => { fireEvent.change(name, { target: { value: 'Sydney' } }) })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Create' })) })
    expect(createUserGroup).toHaveBeenCalled()
  })
})

describe('the user group drawer', () => {
  /**
   * The FieldBox rule is that reading a record cannot change it. The Members
   * box is the one exception, and the same kind as the Photo box: it is not a
   * form at all but a set of immediate actions, so its search field lives in
   * the read state. The guarantee is kept a different way — the field carries
   * no `name`, so it submits nothing — and that is asserted rather than assumed.
   */
  test('the read state holds no form control but the member search, which submits nothing', () => {
    const { container } = list()
    open('North')
    const d = drawer(container)
    const controls = Array.from(d.querySelectorAll<HTMLElement>('input, select, textarea'))
    expect(controls).toHaveLength(1)
    expect(controls[0]!.getAttribute('aria-label')).toBe('Search staff to add to North')
    expect(controls[0]!.getAttribute('name'), 'it is a filter, not a field').toBeNull()
  })

  test('reads the name, status, households and members', () => {
    const { container } = list()
    open('North')
    const d = drawer(container)
    expect(within(d).getByText('Name').nextElementSibling?.textContent).toContain('North')
    expect(within(d).getByText('Status').nextElementSibling?.textContent).toContain('Active')
    expect(within(d).getByText('Households').nextElementSibling?.textContent).toContain('5')
    const members = within(d).getByRole('heading', { name: 'Members' }).closest('form')!
    expect(members.textContent).toContain('Sarah Chen')
    expect(members.textContent).toContain('Reece Testlee')
    expect(members.textContent).not.toContain('Nina New')
  })

  test('a group with nobody in it says so', () => {
    const { container } = list([{ ...NORTH, members: [], household_count: 0 }])
    open('North')
    const d = drawer(container)
    expect(d.textContent).toContain('No members yet')
    expect(within(d).getByText('Households').nextElementSibling?.textContent).toContain('None yet')
  })

  test('editing Details is about THIS group, offers the name and the two statuses, and says what archiving means', () => {
    const { container } = list()
    open('Old territory')
    const d = drawer(container)
    edit(d, 'details')
    const form = within(d).getByRole('button', { name: 'Save' }).closest('form')!
    expect(Array.from(form.querySelectorAll('input')).map((i) => i.getAttribute('name'))).toEqual(['user_group_id', 'name'])
    expect(form.querySelector<HTMLInputElement>('input[name="user_group_id"]')!.value).toBe('ug-old')
    expect(form.querySelector<HTMLInputElement>('input[name="name"]')!.value).toBe('Old territory')
    const status = form.querySelector<HTMLSelectElement>('select[name="status"]')!
    expect(Array.from(status.options).map((o) => o.textContent)).toEqual(['Active', 'Archived'])
    expect(status.value).toBe('archived')
    expect(form.querySelector('[data-slot="archive-note"]')!.textContent).toContain('keep it until changed')
  })

  /**
   * Members are managed by SEARCH AND REMOVE, not a checkbox per colleague.
   * The list must show nobody until something is typed — a picker that dumps
   * every one of 200 staff on opening is the control this replaced.
   */
  test('the Members box lists current members and offers nobody until you search', () => {
    const { container } = list()
    open('North')
    const d = drawer(container)
    const box = within(d).getByRole('heading', { name: 'Members' }).closest('form')!
    expect(box.querySelector('[data-slot="member-list"]')!.textContent).toContain('Sarah Chen')
    expect(box.querySelector('[data-slot="member-list"]')!.textContent).toContain('Reece Testlee')
    expect(box.querySelector('[data-slot="member-matches"]'), 'nothing offered before a search').toBeNull()
    expect(box.textContent, 'and no non-member is listed either').not.toContain('Nina New')
  })

  test('there is no Save: each add and each remove is its own action', () => {
    const { container } = list()
    open('North')
    const d = drawer(container)
    const box = within(d).getByRole('heading', { name: 'Members' }).closest('form')!
    expect(within(box as HTMLElement).queryByRole('button', { name: 'Save' })).toBeNull()
    expect(within(box as HTMLElement).queryByRole('button', { name: 'Edit members' })).toBeNull()
    expect(box.querySelector('input[type="checkbox"]'), 'no checkbox set any more').toBeNull()
  })

  test('searching offers only people who are NOT already members, and adds one', async () => {
    const { addUserGroupMember } = await import('@/app/(shell)/admin/actions')
    const { container } = list()
    open('North')
    const d = drawer(container)
    const search = within(d).getByLabelText('Search staff to add to North')
    await act(async () => { fireEvent.change(search, { target: { value: 'e' } }) })
    const matches = d.querySelector('[data-slot="member-matches"]')!
    /* Nina matches "e" and is not a member; Reece matches but already is. */
    expect(matches.textContent).toContain('Nina New')
    expect(matches.textContent).not.toContain('Reece Testlee')
    await act(async () => { fireEvent.click(within(d).getByRole('button', { name: 'Add Nina New' })) })
    expect(addUserGroupMember).toHaveBeenCalledWith('ug-north', 's3')
  })

  test('a search matching only existing members says so rather than offering nothing', async () => {
    const { container } = list()
    open('North')
    const d = drawer(container)
    await act(async () => {
      fireEvent.change(within(d).getByLabelText('Search staff to add to North'), { target: { value: 'Sarah' } })
    })
    expect(d.querySelector('[data-slot="member-matches"]')).toBeNull()
    expect(d.textContent).toContain('already a member')
  })

  test('removing names the one person and the one group', async () => {
    const { removeUserGroupMember } = await import('@/app/(shell)/admin/actions')
    const { container } = list()
    open('North')
    await act(async () => {
      fireEvent.click(within(drawer(container)).getByRole('button', { name: 'Remove Sarah Chen' }))
    })
    expect(removeUserGroupMember).toHaveBeenCalledWith('ug-north', 's1')
  })

  test('the database’s refusal is shown in the box', async () => {
    const { removeUserGroupMember } = await import('@/app/(shell)/admin/actions')
    vi.mocked(removeUserGroupMember).mockResolvedValueOnce({ error: 'Only an administrator can manage user groups' })
    const { container } = list()
    open('North')
    await act(async () => {
      fireEvent.click(within(drawer(container)).getByRole('button', { name: 'Remove Sarah Chen' }))
    })
    expect(within(drawer(container)).getByRole('alert').textContent).toBe('Only an administrator can manage user groups')
  })

  test('a group with nobody in it says so, and still offers the search', () => {
    const { container } = list([{ ...NORTH, members: [], household_count: 0 }])
    open('North')
    const d = drawer(container)
    expect(d.textContent).toContain('No members yet')
    expect(within(d).getByLabelText('Search staff to add to North')).toBeTruthy()
  })
})
