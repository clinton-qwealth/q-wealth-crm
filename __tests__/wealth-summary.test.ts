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

  /**
   * The thirty-day change under each headline, asked for on 11 September.
   *
   * The arithmetic is one division, and the way to get it wrong is not in the
   * division — it is in choosing which accounts go on each side of it.
   */
  describe('the 30-day change', () => {
    /* The real group, reproduced: two accounts with a baseline and one holding
       $100,000 on a single valuation with no history behind it. */
    const real = [
      { latest_value: '284350.75', baseline_value: '279360.57' },
      { latest_value: '112900.00', baseline_value: '117070.00' },
      { latest_value: '100000.00', baseline_value: null },
    ]

    /**
     * **Both sides are the same accounts, and this is the assertion that says
     * so.**
     *
     * Summing every latest value against every baseline that happens to exist
     * divides a three-account total by a two-account history: $497,251 against
     * $396,431 reads as **+25%** when the money actually moved **+0.2%**. That
     * is not a rounding difference, it is a different claim, and it would be
     * printed in green under a client's total wealth.
     */
    test('compares only the accounts that have both sides of the comparison', () => {
      const { investments } = wealthSummary(real)
      expect(investments.change?.text).toBe('+0.2%')
      expect(investments.change?.pct).toBe(0.2)
      // The trap, stated as a number so its absence is unmistakable.
      const naive = (497250.75 - 396430.57) / 396430.57 * 100
      expect(Math.round(naive)).toBe(25)
      expect(investments.change!.pct).not.toBeCloseTo(naive, 0)
    })

    test('and says how much of the total it speaks for when that is less than all of it', () => {
      const { wealth, investments, assets } = wealthSummary(real)
      expect(investments.change).toEqual({
        pct: 0.2,
        text: '+0.2%',
        covered: 2,
        valued: 3,
      })
      for (const f of [wealth, investments, assets]) {
        expect(f.note, f.label).toMatch(/30-day change covers 2 of 3 valued accounts/)
      }
    })

    test('but stays quiet when it covers every valued account', () => {
      const { investments } = wealthSummary([
        { latest_value: '100', baseline_value: '100' },
        { latest_value: '200', baseline_value: '100' },
      ])
      expect(investments.change?.covered).toBe(2)
      expect(investments.note ?? '').not.toMatch(/30-day change/)
    })

    test('a fall is signed and negative', () => {
      const { investments } = wealthSummary([
        { latest_value: '96000', baseline_value: '100000' },
      ])
      expect(investments.change?.text).toBe('-4.0%')
      expect(investments.change?.pct).toBe(-4)
    })

    /**
     * Rounded before the sign is read, so the colour a tile picks from `pct`
     * always agrees with the text beside it. Unrounded, this move is positive
     * and would print "+0.0%" in green — a green mark on a figure that has not
     * visibly moved.
     */
    test('a move too small to print is flat, not a signed zero', () => {
      const { investments } = wealthSummary([
        { latest_value: '100040', baseline_value: '100000' },
      ])
      expect(investments.change?.pct).toBe(0)
      expect(investments.change?.text).toBe('0.0%')
      expect(investments.change?.text).not.toContain('+')
    })

    test('no comparable account means no change at all, rather than zero', () => {
      const { investments } = wealthSummary([
        { latest_value: '100000', baseline_value: null },
        { latest_value: null, baseline_value: null },
      ])
      expect(investments.change).toBeUndefined()
      expect(investments.note ?? '').not.toMatch(/30-day change/)
    })

    /* A baseline total of zero cannot be divided by. Reachable: an account
       whose thirty days before the latest valuation all read zero. */
    test('a zero baseline produces no change, not an infinity', () => {
      const { investments } = wealthSummary([{ latest_value: '5000', baseline_value: '0' }])
      expect(investments.change).toBeUndefined()
    })

    test('rows with no baseline field at all simply cannot be compared', () => {
      const { investments } = wealthSummary(rows)
      expect(investments.value).toBe('$1,284,300')
      expect(investments.change).toBeUndefined()
    })
  })
})
