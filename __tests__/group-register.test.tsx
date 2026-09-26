import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, test } from 'vitest'
import { GroupRegister } from '@/components/group-register'
import type { GroupListItem } from '@/lib/groups'

/**
 * The register's toolbar: search, status filter, sort — narrowing rows the
 * server already sent, in memory, through `lib/group-register.ts`.
 *
 * What a plausible implementation gets wrong, and what each test pins:
 *
 * - **The search matches the words on the row**, type and status included, so
 *   typing "household" lights everything and the search is decorative. It
 *   matches the two columns a person types from memory: name and contact.
 * - **The count keeps saying the filtered number alone.** "1 household" over a
 *   narrowed list reads as the whole register, which is how somebody concludes
 *   a client is missing. Narrowed, it says "1 of 3".
 * - **Filtered-to-nothing draws the register's empty state**, telling the
 *   reader the register is empty when their own keystroke is what emptied it.
 * - **The status options are hard-coded**, so a status born in the database is
 *   unfilterable until somebody edits a component.
 */
const row = (o: Partial<GroupListItem>): GroupListItem => ({
  group_id: 'g1',
  name: 'Testsmith Household',
  group_type: 'household',
  status: 'active',
  member_count: 3,
  primary_contact: 'Jane Testsmith',
  ...o,
})

const ROWS = [
  row({}),
  row({ group_id: 'g2', name: 'Brown Family', member_count: 5, primary_contact: 'Ada Brown' }),
  row({ group_id: 'g3', name: 'Chen Household', status: 'prospect', member_count: 1, primary_contact: null }),
]

const names = () =>
  screen.getAllByRole('listitem').map((li) => li.querySelector('.font-semibold')?.textContent)

const show = (rows: GroupListItem[] = ROWS) =>
  render(
    <GroupRegister
      groups={rows}
      noun={['household', 'households']}
      action={<button type="button">New household</button>}
      empty={{ title: 'Nothing here', body: 'Truly nothing.', action: <button type="button">Make one</button> }}
    />,
  )

describe('search', () => {
  test('narrows by name, and the count says of how many', () => {
    show()
    fireEvent.change(screen.getByPlaceholderText('Search'), {
      target: { value: 'brown' },
    })
    expect(names()).toEqual(['Brown Family'])
    expect(screen.getByText('1 of 3 households')).toBeTruthy()
  })

  test('finds the primary contact too — the other name a person remembers', () => {
    show()
    fireEvent.change(screen.getByPlaceholderText('Search'), {
      target: { value: 'ada' },
    })
    expect(names()).toEqual(['Brown Family'])
  })

  test('does not match the words the row merely wears, like its type', () => {
    show()
    fireEvent.change(screen.getByPlaceholderText('Search'), {
      target: { value: 'household' },
    })
    /* Two rows NAMED household match; Brown Family must not, even though its
       second line reads "Household · …". */
    expect(names()).toEqual(['Chen Household', 'Testsmith Household'])
  })

  test('matching nothing is not an empty register — it offers to clear, and clearing works', () => {
    show()
    fireEvent.change(screen.getByPlaceholderText('Search'), {
      target: { value: 'zzz' },
    })
    expect(screen.getByText(/Nothing matches “zzz”/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }))
    expect(names()).toHaveLength(3)
  })
})

describe('the status filter', () => {
  test('offers the statuses the rows actually have, actives first', () => {
    show()
    const options = Array.from((screen.getByLabelText('Filter by status') as HTMLSelectElement).options)
    expect(options.map((o) => o.value)).toEqual(['all', 'active', 'prospect'])
    /* The resting option is the control's visible name. */
    expect(options[0]!.textContent).toBe('Status')
  })

  test('narrows to the chosen status', () => {
    show()
    fireEvent.change(screen.getByLabelText('Filter by status'), { target: { value: 'prospect' } })
    expect(names()).toEqual(['Chen Household'])
    expect(screen.getByText('1 of 3 households')).toBeTruthy()
  })
})

describe('sort', () => {
  test('defaults to name A–Z', () => {
    show()
    expect(names()).toEqual(['Brown Family', 'Chen Household', 'Testsmith Household'])
  })

  test('flips to Z–A, and to most members', () => {
    show()
    fireEvent.change(screen.getByLabelText('Sort'), { target: { value: 'name_desc' } })
    expect(names()).toEqual(['Testsmith Household', 'Chen Household', 'Brown Family'])
    fireEvent.change(screen.getByLabelText('Sort'), { target: { value: 'members_desc' } })
    expect(names()).toEqual(['Brown Family', 'Testsmith Household', 'Chen Household'])
  })
})

describe('the count', () => {
  test('says the plain total when nothing narrows it', () => {
    show()
    expect(screen.getByText('3 households')).toBeTruthy()
  })

  test('speaks in the singular only when the WHOLE register is one row', () => {
    show([row({})])
    expect(screen.getByText('1 household')).toBeTruthy()
  })
})

describe('the + and the empty register', () => {
  test('the action rides the toolbar, pinned right of the controls', () => {
    show()
    const add = screen.getByRole('button', { name: 'New household' })
    expect((add.parentElement as HTMLElement).className).toContain('ml-auto')
  })

  /**
   * Register-empty and filtered-to-nothing are different facts with different
   * furniture: the empty register leads with its own call to action, and the
   * toolbar does not render at all — controls over nothing are noise.
   */
  test('an empty register shows its words and its call to action, and no toolbar', () => {
    show([])
    expect(screen.getByText('Nothing here')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Make one' })).toBeTruthy()
    expect(screen.queryByPlaceholderText('Search')).toBeNull()
    expect(screen.queryByLabelText('Sort')).toBeNull()
  })
})
