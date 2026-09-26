import { describe, expect, test } from 'vitest'
import { providerSummary } from '@/lib/provider-summary'
import type { ProviderHolding } from '@/lib/groups'

/**
 * The provider header's figures, and the three quiet ways they lie:
 *
 * - **A joint account summed twice.** The holdings view serves one row per
 *   (holding, group), so an account shared across two households arrives
 *   twice — correctly for the lists, catastrophically for a sum. The pin is a
 *   fixture whose duplicate would move the total if counted.
 * - **A closed account still counted.** Its last valuation is history, not FUM.
 * - **An unvalued account silently dropped.** It must be excluded AND counted,
 *   so the note can say what the figure leaves out — DataSection's total rule.
 */
const H = (o: Partial<ProviderHolding>): ProviderHolding => ({
  kind: 'account',
  group_id: 'g1',
  group_name: 'Testsmith Household',
  record_id: 'a1',
  label: 'Account',
  status: 'active',
  number: null,
  cover_types: null,
  lives_insured: null,
  total_lump_sum_cover: null,
  total_monthly_benefit: null,
  account_type: 'investment',
  owners: null,
  latest_value: 100000,
  change_amount: null,
  change_pct: null,
  ...o,
})

describe('providerSummary', () => {
  test('splits FUM by type, and FUM covers types the split does not name', () => {
    const t = providerSummary([
      H({}),
      H({ record_id: 'a2', account_type: 'superannuation', latest_value: 250000 }),
      /* A type outside the two named splits still IS money with the firm. */
      H({ record_id: 'a3', account_type: 'cash', latest_value: 50000 }),
    ])
    expect(t.fum).toBe(400000)
    expect(t.investment).toBe(100000)
    expect(t.superannuation).toBe(250000)
  })

  test('a joint account held by two households counts once', () => {
    const t = providerSummary([
      H({}),
      /* The SAME account, served again for the second household — the view's
         correct behaviour, and the sum's trap. */
      H({ group_id: 'g2', group_name: 'Brown Family' }),
    ])
    expect(t.fum).toBe(100000)
  })

  test('a closed account is history, not FUM', () => {
    const t = providerSummary([H({}), H({ record_id: 'a2', status: 'closed', latest_value: 900000 })])
    expect(t.fum).toBe(100000)
  })

  test('an unvalued account is excluded and counted, never a silent zero', () => {
    const t = providerSummary([H({}), H({ record_id: 'a2', latest_value: null })])
    expect(t.fum).toBe(100000)
    expect(t.unvalued).toBe(1)
  })

  test('policies never enter — cover is not funds under management', () => {
    const t = providerSummary([
      H({ kind: 'policy', record_id: 'i1', account_type: null, latest_value: null, total_lump_sum_cover: 1400000 }),
    ])
    expect(t.fum).toBe(0)
    expect(t.unvalued).toBe(0)
  })

  test('numeric strings from Postgres sum as numbers, not as concatenation', () => {
    const t = providerSummary([H({ latest_value: '100000.00' }), H({ record_id: 'a2', latest_value: '50000.00' })])
    expect(t.fum).toBe(150000)
  })
})
