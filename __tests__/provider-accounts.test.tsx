import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, test } from 'vitest'
import { ProviderAccounts } from '@/components/provider-accounts'
import type { ProviderHolding } from '@/lib/groups'

/**
 * The accounts register on a provider's page — the group register's toolbar
 * over the holdings, asked for 27 Sep. The pins are the rules a plausible cut
 * drops:
 *
 * - **Search only reads the label**, so "brown" finds nothing although the
 *   Browns hold an account — a person remembers an account by its people and
 *   its household as often as by its name.
 * - **The Type filter is hard-coded**, offering Investment on a super-only
 *   provider — the derived-options rule, again.
 * - **"Highest value" treats unknown as zero**, ranking an unvalued account
 *   as the smallest instead of sinking it to the bottom as unknown.
 */
const A = (o: Partial<ProviderHolding>): ProviderHolding => ({
  kind: 'account',
  group_id: 'g1',
  group_name: 'Testsmith Household',
  record_id: 'a1',
  label: 'HUB24 Invest',
  status: 'active',
  number: null,
  cover_types: null,
  lives_insured: null,
  total_lump_sum_cover: null,
  total_monthly_benefit: null,
  account_type: 'investment',
  owners: 'Janet Testsmith',
  latest_value: 250000,
  change_amount: null,
  change_pct: null,
  ...o,
})

const ROWS = [
  A({}),
  A({ record_id: 'a2', label: 'Wrap — Joint', group_id: 'g2', group_name: 'Brown Family', owners: 'Ada Brown', latest_value: 900000 }),
  /* Named to START the alphabet on purpose: under the unknown-as-zero bug this
     row ties with the zero-balance one and the alphabetical tiebreak floats it
     ABOVE — which is exactly how the vacuous first version of the sort test
     let that bug through. */
  A({ record_id: 'a3', label: 'Accelerator Super', account_type: 'superannuation', latest_value: null, owners: 'Leon Heidelberger' }),
  A({ record_id: 'a4', label: 'Zero Balance Wrap', latest_value: 0, owners: 'Zed Osei' }),
]

const names = () =>
  screen.getAllByRole('listitem').map((li) => li.querySelector('.font-semibold')?.textContent)

describe('the provider accounts register', () => {
  test('search finds an account by its household and by its owner, not only its label', () => {
    render(<ProviderAccounts rows={ROWS} />)
    fireEvent.change(screen.getByPlaceholderText('Search'), { target: { value: 'brown' } })
    expect(names()).toEqual(['Wrap — Joint'])
    fireEvent.change(screen.getByPlaceholderText('Search'), { target: { value: 'janet' } })
    expect(names()).toEqual(['HUB24 Invest'])
  })

  test('the Type options are the types present, as words', () => {
    render(<ProviderAccounts rows={ROWS} />)
    const options = Array.from((screen.getByLabelText('Filter by type') as HTMLSelectElement).options)
    expect(options.map((o) => o.value)).toEqual(['all', 'investment', 'superannuation'])
    expect(options[0]!.textContent).toBe('Type')
    fireEvent.change(screen.getByLabelText('Filter by type'), { target: { value: 'superannuation' } })
    expect(names()).toEqual(['Accelerator Super'])
  })

  test('highest value ranks the valued — a ZERO balance included — and sinks the unknown below it', () => {
    render(<ProviderAccounts rows={ROWS} />)
    fireEvent.change(screen.getByLabelText('Sort'), { target: { value: 'value_desc' } })
    /* $0 is a value; "no valuation" is not. The zero-balance account outranks
       the unvalued one, whatever the alphabet says. Mutation, and it was run
       until it actually failed: coalesce unknown to zero and the unvalued
       'Accelerator Super' floats above 'Zero Balance Wrap' on the tiebreak. */
    expect(names()).toEqual(['Wrap — Joint', 'HUB24 Invest', 'Zero Balance Wrap', 'Accelerator Super'])
  })

  test('filtered to nothing offers to clear, and clearing restores the register', () => {
    render(<ProviderAccounts rows={ROWS} />)
    fireEvent.change(screen.getByPlaceholderText('Search'), { target: { value: 'zzz' } })
    expect(screen.getByText(/Nothing matches “zzz”/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }))
    expect(names()).toHaveLength(4)
  })
})
