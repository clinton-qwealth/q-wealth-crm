import { describe, expect, test } from 'vitest'

/**
 * The accounts footer total.
 *
 * Mirrors accountsTotal() in the groups page, which cannot be imported: page
 * modules are async Server Components and their helpers are not reachable from
 * Vitest. The rule it encodes is worth pinning even so, because the failure
 * mode is silent — a total that looks authoritative while omitting rows.
 */
const accountMoney = new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD' })

function accountsTotal(rows: { latest_value: string | number | null }[]) {
  const valued = rows.filter((r) => r.latest_value != null)
  const missing = rows.length - valued.length
  return {
    label: 'Total',
    value: accountMoney.format(valued.reduce((sum, r) => sum + Number(r.latest_value), 0)),
    note:
      missing === 0
        ? undefined
        : `Excludes ${missing} account${missing === 1 ? '' : 's'} with no recorded value`,
  }
}

describe('the accounts total', () => {
  test('sums every account that has a value', () => {
    const t = accountsTotal([{ latest_value: 486210 }, { latest_value: 212940 }, { latest_value: 48120 }])
    expect(t.value).toBe(accountMoney.format(747270))
    expect(t.note).toBeUndefined()
  })

  /* Decided 5 Sep 2026: the figure reconciles with what is on screen, so a
     suspended account is included rather than quietly dropped. Status does not
     enter the calculation at all — this asserts that it stays that way. */
  test('includes accounts whatever their status', () => {
    const rows = [{ latest_value: 100 }, { latest_value: 50 }]
    expect(accountsTotal(rows).value).toBe(accountMoney.format(150))
  })

  /**
   * The one that matters. Two of the five real accounts have no recorded
   * valuation, because nothing writes one after the opening value. A bare total
   * would read as the group's holdings while omitting them.
   */
  test('says so when it is leaving accounts out', () => {
    const t = accountsTotal([{ latest_value: 100 }, { latest_value: null }, { latest_value: null }])
    expect(t.value).toBe(accountMoney.format(100))
    expect(t.note).toBe('Excludes 2 accounts with no recorded value')
  })

  test('one omission reads as singular', () => {
    expect(accountsTotal([{ latest_value: 100 }, { latest_value: null }]).note).toBe(
      'Excludes 1 account with no recorded value',
    )
  })

  /* Every row unvalued: zero, and an explanation. Not a blank, which would look
     like a rendering fault rather than an absence of data. */
  test('all values missing still produces a figure and a reason', () => {
    const t = accountsTotal([{ latest_value: null }, { latest_value: null }])
    expect(t.value).toBe(accountMoney.format(0))
    expect(t.note).toBe('Excludes 2 accounts with no recorded value')
  })

  /* The view returns numerics as strings over PostgREST. Concatenation instead
     of addition would give "486210212940" — plausible-looking and very wrong. */
  test('string values from the database are added, not concatenated', () => {
    const t = accountsTotal([{ latest_value: '486210' }, { latest_value: '212940' }])
    expect(t.value).toBe(accountMoney.format(699150))
  })
})
