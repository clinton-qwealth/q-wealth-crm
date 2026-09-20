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
  saveUserGroupMembers: vi.fn(async () => ({ ok: true as const })),
}))
const { UserGroupList } = await import('@/components/user-group-list')

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
  test('the read state contains no form control at all', () => {
    const { container } = list()
    open('North')
    expect(drawer(container).querySelectorAll('input, select, textarea')).toHaveLength(0)
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

  /* The sentinel FIRST, then one box per person offered, ticked for members. */
  test('editing Members offers every active person behind the sentinel, ticked for the current members', () => {
    const { container } = list()
    open('North')
    const d = drawer(container)
    edit(d, 'members')
    const form = within(d).getByRole('button', { name: 'Save' }).closest('form')!
    const inputs = Array.from(form.querySelectorAll<HTMLInputElement>('input'))
    expect(inputs.map((i) => [i.type, i.name])).toEqual([
      ['hidden', 'user_group_id'],
      ['hidden', 'members_present'],
      ['checkbox', 'staff_ids'],
      ['checkbox', 'staff_ids'],
      ['checkbox', 'staff_ids'],
    ])
    const boxes = inputs.filter((i) => i.type === 'checkbox')
    expect(boxes.map((b) => [b.value, b.checked])).toEqual([
      ['s1', true],
      ['s2', true],
      ['s3', false],
    ])
  })

  test('with nobody active to add, the sentinel still travels', () => {
    const { container } = render(<UserGroupList groups={[NORTH]} staff={[]} />)
    open('North')
    const d = drawer(container)
    edit(d, 'members')
    expect(d.querySelector('input[name="members_present"]')).toBeTruthy()
    expect(d.querySelectorAll('input[name="staff_ids"]')).toHaveLength(0)
    expect(d.textContent).toContain('Nobody active on the staff to add')
  })
})
