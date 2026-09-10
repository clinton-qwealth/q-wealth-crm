import { describe, expect, test } from 'vitest'
import { accountMix, MAX_SLICES, sharePct, type MixAccount } from '@/lib/account-mix'

/**
 * The arithmetic behind the investment mix donut.
 *
 * **This file exists because Recharts owns the drawing.** The hand-rolled
 * version put its geometry in `stroke-dasharray` attributes, so the maths could
 * be read straight out of the DOM; a library's arcs cannot. Rather than lose
 * those assertions, the arithmetic moved into a pure module — which is a better
 * place for it anyway: no renderer, no jsdom, and the rules read as rules.
 *
 * The rule that matters most is the last group: **what the chart cannot show,
 * it counts.**
 */
const account = (o: Partial<MixAccount> & { latest_value: string | number | null }): MixAccount => ({
  account_id: `a${Math.random().toString(36).slice(2)}`,
  label: 'An account',
  ...o,
})

describe('accountMix', () => {
  test('orders slices largest share first, and the shares sum to one', () => {
    const { slices, total } = accountMix([
      account({ label: 'Small', latest_value: 100 }),
      account({ label: 'Large', latest_value: 700 }),
      account({ label: 'Middle', latest_value: 200 }),
    ])
    expect(slices.map((s) => s.label)).toEqual(['Large', 'Middle', 'Small'])
    expect(slices.map((s) => s.share)).toEqual([0.7, 0.2, 0.1])
    expect(slices.reduce((sum, s) => sum + s.share, 0)).toBeCloseTo(1, 10)
    expect(total).toBe(1000)
  })

  /* The view returns numerics as strings over PostgREST. Concatenation instead
     of addition would give "700200100" — plausible-looking and very wrong. */
  test('string values from the database are added, not concatenated', () => {
    const { total } = accountMix([
      account({ latest_value: '486210' }),
      account({ latest_value: '212940' }),
    ])
    expect(total).toBe(699150)
  })

  test('a single account is the whole ring', () => {
    const { slices, total, counted } = accountMix([account({ label: 'Only', latest_value: 500 })])
    expect(slices).toHaveLength(1)
    expect(slices[0].share).toBe(1)
    expect(total).toBe(500)
    expect(counted).toBe(1)
  })

  describe('what it cannot draw, it counts', () => {
    test('an account with no recorded value is missing, not dropped', () => {
      const mix = accountMix([
        account({ latest_value: 500 }),
        account({ latest_value: null }),
        account({ latest_value: null }),
      ])
      expect(mix.slices).toHaveLength(1)
      expect(mix.missing).toBe(2)
      expect(mix.counted).toBe(1)
    })

    /**
     * Zero is the subtle one. It is a *valued* account — somebody wrote a
     * figure — but a zero-width arc cannot be seen or hovered, so it counts as
     * something the chart is not showing rather than as a segment of nothing.
     */
    test('an account recorded at exactly zero counts as missing', () => {
      const mix = accountMix([account({ latest_value: 500 }), account({ latest_value: 0 })])
      expect(mix.slices).toHaveLength(1)
      expect(mix.missing).toBe(1)
    })

    test('a value that is not a number counts as missing rather than poisoning the total', () => {
      const mix = accountMix([
        account({ latest_value: 500 }),
        account({ latest_value: 'not a number' }),
      ])
      expect(mix.total).toBe(500)
      expect(mix.missing).toBe(1)
      expect(Number.isFinite(mix.total)).toBe(true)
    })

    test('nothing is missing when every account has a value', () => {
      expect(accountMix([account({ latest_value: 1 }), account({ latest_value: 2 })]).missing).toBe(0)
    })
  })

  describe('nothing to draw', () => {
    /**
     * The invariant that replaced a guard.
     *
     * An explicit `total <= 0` early return was written here and removed on
     * 10 September after a mutation showed it was dead code: the `> 0` filter
     * upstream means `total` is positive whenever a slice exists, so nothing
     * can divide by zero. This asserts the *consequence* rather than the
     * deleted branch — a zero total comes with no slices, and no share is NaN.
     */
    test('all accounts at zero yields no slices and a zero total, not NaN', () => {
      const mix = accountMix([account({ latest_value: 0 }), account({ latest_value: '0' })])
      expect(mix.slices).toEqual([])
      expect(mix.total).toBe(0)
      expect(mix.missing).toBe(2)
      expect(mix.counted).toBe(0)
    })

    test('a zero total never produces a NaN share, however it arises', () => {
      for (const accounts of [
        [] as MixAccount[],
        [account({ latest_value: 0 })],
        [account({ latest_value: null }), account({ latest_value: 'x' })],
      ]) {
        const mix = accountMix(accounts)
        expect(mix.slices).toEqual([])
        expect(mix.total).toBe(0)
        expect(mix.slices.every((s) => Number.isFinite(s.share))).toBe(true)
      }
    })

    test('no accounts at all yields nothing and counts nothing missing', () => {
      expect(accountMix([])).toEqual({ slices: [], total: 0, missing: 0, counted: 0 })
    })

    test('every account unvalued yields no slices and counts them all', () => {
      const mix = accountMix([account({ latest_value: null }), account({ latest_value: null })])
      expect(mix.slices).toEqual([])
      expect(mix.missing).toBe(2)
    })
  })

  describe('more accounts than the ramp has steps', () => {
    test(`the tail groups into one slice, so nothing shares a colour`, () => {
      const mix = accountMix(
        Array.from({ length: 9 }, (_, i) => account({ label: `Account ${i}`, latest_value: 100 - i })),
      )
      expect(mix.slices).toHaveLength(MAX_SLICES)
      expect(mix.slices[MAX_SLICES - 1]).toMatchObject({ key: 'other', label: '4 smaller accounts' })
      // Grouped, not discarded: the shares still add to the whole ring.
      expect(mix.slices.reduce((sum, s) => sum + s.share, 0)).toBeCloseTo(1, 10)
      // And every account is represented, so the centre count is honest.
      expect(mix.counted).toBe(9)
    })

    test('the grouped slice carries the sum of the tail', () => {
      const mix = accountMix(
        Array.from({ length: 8 }, (_, i) => account({ label: `A${i}`, latest_value: 10 })),
      )
      // Eight equal accounts: five drawn, three grouped at 30 of 80.
      expect(mix.slices[MAX_SLICES - 1].value).toBe(30)
      expect(mix.slices[MAX_SLICES - 1].label).toBe('3 smaller accounts')
    })

    test('exactly six accounts are each drawn, with no grouping', () => {
      const mix = accountMix(
        Array.from({ length: MAX_SLICES }, (_, i) => account({ label: `A${i}`, latest_value: 10 })),
      )
      expect(mix.slices).toHaveLength(MAX_SLICES)
      expect(mix.slices.some((s) => s.key === 'other')).toBe(false)
    })

    test('one over the limit still groups rather than dropping the last', () => {
      const mix = accountMix(
        Array.from({ length: MAX_SLICES + 1 }, (_, i) => account({ label: `A${i}`, latest_value: 10 })),
      )
      expect(mix.slices).toHaveLength(MAX_SLICES)
      expect(mix.slices[MAX_SLICES - 1].label).toBe('2 smaller accounts')
    })
  })
})

describe('sharePct', () => {
  test('whole percents', () => {
    expect(sharePct(0.7)).toBe('70%')
    expect(sharePct(1)).toBe('100%')
  })

  /**
   * A drawn segment must never read as `0%`. The arc is visible and hoverable,
   * so a legend saying zero beside it reads as a rendering fault.
   */
  test('a share too small to round to a percent reads as under one', () => {
    expect(sharePct(0.0004)).toBe('<1%')
    expect(sharePct(0.004)).toBe('<1%')
  })

  test('and rounds rather than truncates', () => {
    expect(sharePct(0.006)).toBe('1%')
    expect(sharePct(0.665)).toBe('67%')
  })
})
