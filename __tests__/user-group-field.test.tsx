import { act, fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, test, vi } from 'vitest'

/**
 * The household's user group on the Group profile card.
 *
 * What would go wrong quietly: a pencil for somebody the database will refuse;
 * "None" travelling as `''`; an archived current group vanishing from the
 * select so that merely opening the editor changes the value.
 */
vi.mock('@/app/(shell)/groups/actions', () => ({
  setGroupUserGroup: vi.fn(async () => ({ ok: true as const })),
}))
const { UserGroupField } = await import('@/components/user-group-field')
const { setGroupUserGroup } = await import('@/app/(shell)/groups/actions')

const OPTIONS = [
  { id: 'ug-north', name: 'North', status: 'active' },
  { id: 'ug-south', name: 'South', status: 'active' },
]
const G = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'

beforeEach(() => {
  vi.mocked(setGroupUserGroup).mockClear()
  vi.mocked(setGroupUserGroup).mockResolvedValue({ ok: true })
})

describe('UserGroupField', () => {
  test('reads as a pill, or an em-dash when the household is in no group', () => {
    const { container, unmount } = render(<UserGroupField groupId={G} current={OPTIONS[0]!} options={OPTIONS} canEdit={false} />)
    expect(container.textContent).toContain('North')
    unmount()
    const { container: c2 } = render(<UserGroupField groupId={G} current={null} options={OPTIONS} canEdit={false} />)
    expect(c2.textContent).toContain('—')
  })

  test('the pencil appears only for somebody who may edit the household', () => {
    const { unmount } = render(<UserGroupField groupId={G} current={null} options={OPTIONS} canEdit={false} />)
    expect(screen.queryByRole('button', { name: 'Edit user group' })).toBeNull()
    unmount()
    render(<UserGroupField groupId={G} current={null} options={OPTIONS} canEdit />)
    expect(screen.getByRole('button', { name: 'Edit user group' })).toBeTruthy()
  })

  test('editing offers None first, then the active groups, with the current one selected', () => {
    render(<UserGroupField groupId={G} current={OPTIONS[1]!} options={OPTIONS} canEdit />)
    act(() => { fireEvent.click(screen.getByRole('button', { name: 'Edit user group' })) })
    const select = screen.getByRole('combobox', { name: 'User group' }) as HTMLSelectElement
    expect(Array.from(select.options).map((o) => [o.value, o.textContent])).toEqual([
      ['', 'None'],
      ['ug-north', 'North'],
      ['ug-south', 'South'],
    ])
    expect(select.value).toBe('ug-south')
    expect(document.querySelector('[data-slot="user-group-note"]')!.textContent).toContain('may hide it from you')
  })

  /* Archived, so not among the options — but it is the CURRENT value, and it
     stays selectable so opening the editor never changes the household. */
  test('a current group that has been archived is kept as an option, named as archived', () => {
    render(<UserGroupField groupId={G} current={{ id: 'ug-old', name: 'Old territory', status: 'archived' }} options={OPTIONS} canEdit />)
    act(() => { fireEvent.click(screen.getByRole('button', { name: 'Edit user group' })) })
    const select = screen.getByRole('combobox', { name: 'User group' }) as HTMLSelectElement
    expect(Array.from(select.options).map((o) => o.value)).toEqual(['', 'ug-north', 'ug-south', 'ug-old'])
    expect(select.value).toBe('ug-old')
    expect(Array.from(select.options).at(-1)!.textContent).toBe('Old territory (archived)')
  })

  test('choosing a group calls the action with it; choosing None sends null', async () => {
    render(<UserGroupField groupId={G} current={OPTIONS[0]!} options={OPTIONS} canEdit />)
    act(() => { fireEvent.click(screen.getByRole('button', { name: 'Edit user group' })) })
    await act(async () => { fireEvent.change(screen.getByRole('combobox', { name: 'User group' }), { target: { value: 'ug-south' } }) })
    expect(setGroupUserGroup).toHaveBeenLastCalledWith(G, 'ug-south')
    /* A save closes the editor; open it again for None. */
    act(() => { fireEvent.click(screen.getByRole('button', { name: 'Edit user group' })) })
    await act(async () => { fireEvent.change(screen.getByRole('combobox', { name: 'User group' }), { target: { value: '' } }) })
    expect(setGroupUserGroup).toHaveBeenLastCalledWith(G, null)
  })

  test('the database’s refusal is shown beside the control, and the editor stays open', async () => {
    vi.mocked(setGroupUserGroup).mockResolvedValueOnce({ error: 'No such user group, or it has been archived' })
    render(<UserGroupField groupId={G} current={null} options={OPTIONS} canEdit />)
    act(() => { fireEvent.click(screen.getByRole('button', { name: 'Edit user group' })) })
    await act(async () => { fireEvent.change(screen.getByRole('combobox', { name: 'User group' }), { target: { value: 'ug-north' } }) })
    expect(screen.getByRole('alert').textContent).toBe('No such user group, or it has been archived')
    expect(screen.getByRole('combobox', { name: 'User group' })).toBeTruthy()
  })
})
