import { act, fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, test, vi } from 'vitest'

/**
 * The household's user groups, in their own section under the Group profile.
 *
 * What would go wrong quietly: a pencil for somebody the database will refuse;
 * an archived CURRENT territory vanishing from the list so that opening the
 * editor and saving silently drops it; a save that sends one territory when
 * several are ticked; Cancel writing.
 */
vi.mock('@/app/(shell)/groups/actions', () => ({
  setGroupUserGroups: vi.fn(async () => ({ ok: true as const })),
}))
const { UserGroupsBox } = await import('@/components/user-groups-box')
const { setGroupUserGroups } = await import('@/app/(shell)/groups/actions')

const NORTH = { id: 'ug-north', name: 'North', status: 'active' }
const SOUTH = { id: 'ug-south', name: 'South', status: 'active' }
const OLD = { id: 'ug-old', name: 'Old territory', status: 'archived' }
const OPTIONS = [NORTH, SOUTH]
const G = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'

const box = (current: typeof OPTIONS, canEdit = true) =>
  render(<UserGroupsBox groupId={G} current={current} options={OPTIONS} canEdit={canEdit} />)
const openEditor = () =>
  act(() => { fireEvent.click(screen.getByRole('button', { name: 'Edit user groups' })) })
const tick = (name: string) => act(() => { fireEvent.click(screen.getByLabelText(name)) })
const save = () => act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Save' })) })

beforeEach(() => {
  vi.mocked(setGroupUserGroups).mockClear()
  vi.mocked(setGroupUserGroups).mockResolvedValue({ ok: true })
})

describe('UserGroupsBox', () => {
  test('it is its own titled section, not a field in the profile list', () => {
    const { container } = box([NORTH])
    const section = container.querySelector('[data-slot="user-groups-box"]')!
    expect(section.querySelector('h2')!.textContent).toBe('User groups')
  })

  test('reads as a pill per territory, and an em-dash when it is in none', () => {
    const { container, unmount } = box([NORTH, SOUTH], false)
    expect(container.textContent).toContain('North')
    expect(container.textContent).toContain('South')
    unmount()
    const { container: c2 } = box([], false)
    expect(c2.textContent).toContain('—')
    expect(c2.textContent, 'and says what being in none means').toContain('every colleague')
  })

  test('the pencil appears only for somebody who may edit the household', () => {
    const { unmount } = box([], false)
    expect(screen.queryByRole('button', { name: 'Edit user groups' })).toBeNull()
    unmount()
    box([])
    expect(screen.getByRole('button', { name: 'Edit user groups' })).toBeTruthy()
  })

  test('editing offers a checkbox per active territory, ticked to match', () => {
    box([SOUTH])
    openEditor()
    const boxes = screen.getAllByRole('checkbox') as HTMLInputElement[]
    expect(boxes.map((b) => [b.closest('label')!.textContent!.trim(), b.checked])).toEqual([
      ['North', false],
      ['South', true],
    ])
    expect(document.querySelector('[data-slot="user-group-note"]')!.textContent).toContain('may hide it from you')
  })

  /* Archived, so not offered to a household that is not in it — but this one IS,
     and it stays ticked so that opening the editor and saving cannot drop it. */
  test('an archived territory the household already holds is kept, ticked and named', () => {
    box([OLD])
    openEditor()
    const boxes = screen.getAllByRole('checkbox') as HTMLInputElement[]
    expect(boxes.map((b) => b.closest('label')!.textContent!.trim())).toEqual([
      'North',
      'South',
      'Old territory (archived)',
    ])
    expect(boxes[2]!.checked).toBe(true)
  })

  test('saving sends every ticked territory, as the whole set', async () => {
    box([NORTH])
    openEditor()
    tick('South')
    await save()
    expect(setGroupUserGroups).toHaveBeenCalledWith(G, ['ug-north', 'ug-south'])
  })

  /* An empty set is the instruction "belong to none", and must travel. */
  test('unticking everything sends an empty set rather than nothing', async () => {
    box([NORTH])
    openEditor()
    tick('North')
    await save()
    expect(setGroupUserGroups).toHaveBeenCalledWith(G, [])
  })

  test('Cancel writes nothing and restores what was there', async () => {
    box([NORTH])
    openEditor()
    tick('South')
    act(() => { fireEvent.click(screen.getByRole('button', { name: 'Cancel' })) })
    expect(setGroupUserGroups).not.toHaveBeenCalled()
    openEditor()
    const boxes = screen.getAllByRole('checkbox') as HTMLInputElement[]
    expect(boxes.map((b) => b.checked), 'the abandoned tick did not survive').toEqual([true, false])
  })

  test('the database’s refusal is shown and the editor stays open', async () => {
    vi.mocked(setGroupUserGroups).mockResolvedValueOnce({ error: 'That user group is archived' })
    box([])
    openEditor()
    tick('North')
    await save()
    expect(screen.getByRole('alert').textContent).toBe('That user group is archived')
    expect(screen.getByRole('button', { name: 'Save' }), 'still there to try again').toBeTruthy()
  })
})
