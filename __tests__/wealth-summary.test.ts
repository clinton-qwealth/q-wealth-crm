import { describe, expect, test } from 'vitest'
import { wealthSummary } from '@/lib/wealth'

const rows = [{ latest_value: '842100.00' }, { latest_value: '442200.00' }, { latest_value: null }]

describe('wealthSummary', () => {
  test('investments sum the valued accounts and say how many were left out', () => {
    const { investments } = wealthSummary(rows)
    expect(investments.value).toBe('$1,284,300')
    expect(investments.note).toBe('1 unvalued account excluded')
  })

  /**
   * The honesty rule. Nothing else counts as an asset or a liability yet, so
   * all three figures are equal — and every card that would mislead on its own
   * must say what it is missing.
   */
  test('assets and wealth equal investments today, and each says why', () => {
    const { wealth, investments, assets } = wealthSummary(rows)
    expect(assets.value).toBe(investments.value)
    expect(wealth.value).toBe(investments.value)
    expect(assets.note).toMatch(/no other assets recorded/i)
    expect(wealth.note).toMatch(/no liabilities recorded/i)
  })

  test('the unvalued caveat carries onto every figure it affects', () => {
    const { wealth, assets } = wealthSummary(rows)
    expect(wealth.note).toMatch(/1 unvalued account excluded/)
    expect(assets.note).toMatch(/1 unvalued account excluded/)
  })

  test('with every account valued, investments carries no note at all', () => {
    const { investments } = wealthSummary(rows.slice(0, 2))
    expect(investments.note).toBeUndefined()
  })

  test('headline figures are whole dollars — a headline is read, not reconciled', () => {
    expect(wealthSummary([{ latest_value: '1284300.49' }]).investments.value).toBe('$1,284,300')
  })

  test('no accounts is zero, stated, not an error', () => {
    const { wealth } = wealthSummary([])
    expect(wealth.value).toBe('$0')
  })

  test('plural agreement in the caveat', () => {
    const { investments } = wealthSummary([{ latest_value: null }, { latest_value: null }])
    expect(investments.note).toBe('2 unvalued accounts excluded')
  })
})
