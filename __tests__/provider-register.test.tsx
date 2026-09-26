import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, test } from 'vitest'
import { ProviderRegister } from '@/components/provider-register'
import type { ProviderRegisterRow } from '@/lib/groups'

/**
 * The provider register's toolbar and rows — the client registers' treatment,
 * asked for 26 Sep, plus the change that unlocked it: the rows are LINKS now,
 * because `/groups/providers/[partyId]` exists. Search's own comment carried
 * "goes nowhere useful" for these records; a row that navigates is the point
 * of the page, so a regression to plain rows is the first thing pinned.
 */
const P = (o: Partial<ProviderRegisterRow>): ProviderRegisterRow => ({
  party_id: 'p1',
  name: 'HUB24',
  since: '2025-02-01',
  logo_path: null,
  kinds: ['account'],
  ...o,
})

const ROWS = [
  P({}),
  P({ party_id: 'p2', name: 'Macquarie Wrap', since: '2024-03-01' }),
  P({ party_id: 'p3', name: 'AIA', since: null, kinds: ['policy'] }),
]

const names = () =>
  screen.getAllByRole('listitem').map((li) => li.querySelector('.font-semibold')?.textContent)

const show = (rows: ProviderRegisterRow[] = ROWS) =>
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

  test('search narrows by name', () => {
    show()
    fireEvent.change(screen.getByPlaceholderText('Search'), { target: { value: 'mac' } })
    expect(names()).toEqual(['Macquarie Wrap'])
    expect(screen.queryByText(/1 of 3/), 'no count caption').toBeNull()
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

/**
 * The Type filter and what dresses it — both read the ONE derivation
 * (holdings → kind), so the filter, the row's second line and the record
 * page's Provides field cannot disagree.
 */
describe('the type filter', () => {
  test('narrows to insurers, and back out with Clear filters', () => {
    show()
    fireEvent.change(screen.getByLabelText('Filter by type'), { target: { value: 'insurer' } })
    expect(names()).toEqual(['AIA'])
    fireEvent.change(screen.getByLabelText('Filter by type'), { target: { value: 'platform' } })
    expect(names()).toEqual(['HUB24', 'Macquarie Wrap'])
  })

  test('offers only the types present in the rows', () => {
    show([P({}), P({ party_id: 'p2', name: 'Netwealth' })])
    const options = Array.from((screen.getByLabelText('Filter by type') as HTMLSelectElement).options)
    expect(options.map((o) => o.value)).toEqual(['all', 'platform'])
    expect(options[0]!.textContent, 'the resting option is the control’s name').toBe('Type')
  })

  test('a provider of both kinds answers both filters', () => {
    show([P({ kinds: ['account', 'policy'] })])
    fireEvent.change(screen.getByLabelText('Filter by type'), { target: { value: 'insurer' } })
    expect(names()).toEqual(['HUB24'])
  })

  test('the row wears its kinds, and a provider with nothing wears "Provider"', () => {
    show([P({ kinds: ['account', 'policy'] }), P({ party_id: 'p9', name: 'Nobody Yet', since: null, kinds: [] })])
    expect(screen.getByText(/Platform · Insurer · since 2025/)).toBeTruthy()
    expect(screen.getByText('Provider')).toBeTruthy()
  })
})

describe('the logo', () => {
  test('a provider with a logo wears it in the row; one without keeps the building', () => {
    const { container } = show([
      P({ logo_path: 'p1/abc.png' }),
      P({ party_id: 'p2', name: 'Netwealth' }),
    ])
    const img = container.querySelector('img') as HTMLImageElement
    expect(img.getAttribute('src')).toContain('/api/provider-logo/p1')
    /* The cache key rides along, so a replaced logo is not shown stale. */
    expect(img.getAttribute('src')).toContain('v=abc.png')
    expect(container.querySelectorAll('img')).toHaveLength(1)
    expect(container.querySelectorAll('svg[aria-hidden]').length).toBeGreaterThan(0)
  })
})
