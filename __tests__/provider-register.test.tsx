import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, test } from 'vitest'
import { ProviderRegister } from '@/components/provider-register'
import type { ServiceProviderItem } from '@/lib/groups'

/**
 * The provider register's toolbar and rows — the client registers' treatment,
 * asked for 26 Sep, plus the change that unlocked it: the rows are LINKS now,
 * because `/groups/providers/[partyId]` exists. Search's own comment carried
 * "goes nowhere useful" for these records; a row that navigates is the point
 * of the page, so a regression to plain rows is the first thing pinned.
 */
const P = (o: Partial<ServiceProviderItem>): ServiceProviderItem => ({
  party_id: 'p1',
  name: 'HUB24',
  since: '2025-02-01',
  ...o,
})

const ROWS = [
  P({}),
  P({ party_id: 'p2', name: 'Macquarie Wrap', since: '2024-03-01' }),
  P({ party_id: 'p3', name: 'AIA', since: null }),
]

const names = () =>
  screen.getAllByRole('listitem').map((li) => li.querySelector('.font-semibold')?.textContent)

const show = (rows: ServiceProviderItem[] = ROWS) =>
  render(
    <ProviderRegister
      providers={rows}
      action={<button type="button">New provider</button>}
      empty={{ title: 'None yet', body: 'Empty.', action: <button type="button">Make one</button> }}
    />,
  )

describe('the provider register', () => {
  test('every provider is a link to its own page', () => {
    show()
    const link = screen.getByRole('link', { name: /HUB24/ })
    expect(link.getAttribute('href')).toBe('/groups/providers/p1')
  })

  test('search narrows by name and the count says of how many', () => {
    show()
    fireEvent.change(screen.getByPlaceholderText('Search'), { target: { value: 'mac' } })
    expect(names()).toEqual(['Macquarie Wrap'])
    expect(screen.getByText('1 of 3 providers')).toBeTruthy()
  })

  /* "Newest" puts the youngest start date first, and a provider with NO date
     last — unknown is older than any known start, not newer. */
  test('newest sorts by start date, unknowns last', () => {
    show()
    fireEvent.change(screen.getByLabelText('Sort'), { target: { value: 'newest' } })
    expect(names()).toEqual(['HUB24', 'Macquarie Wrap', 'AIA'])
  })

  test('an empty register leads with its call to action and no toolbar', () => {
    show([])
    expect(screen.getByText('None yet')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Make one' })).toBeTruthy()
    expect(screen.queryByPlaceholderText('Search')).toBeNull()
  })

  test('the + rides the toolbar, pinned right', () => {
    show()
    const add = screen.getByRole('button', { name: 'New provider' })
    expect((add.parentElement as HTMLElement).className).toContain('ml-auto')
  })
})
