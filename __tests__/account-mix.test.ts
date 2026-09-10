import { describe, expect, test } from 'vitest'
import { ACCOUNT_TYPE_LABEL, accountMix, MAX_SLICES, sharePct, type MixAccount } from '@/lib/account-mix'

/**
 * The arithmetic behind the investment mix donut, which since 10 September
 * groups **by account type** rather than per account.
 *
 * Pure and renderer-free because Recharts owns the arc geometry — the maths used
 * to be readable out of `stroke-dasharray` attributes and no longer is.
 *
 * The regrouping is not a formatting change: it decides what the chart MEANS,
 * and it exists because the tiles beside the ring already colour these accounts
 * emerald and gold. So the assertions that matter most are that a type's arc
 * sums every account of that type, and that the key is the type — because the
 * colour is keyed off it, and a green arc has to be superannuation whether it is
 * the larger share or the smaller one.
 */
const account = (o: Partial<MixAccount> & { latest_value: string | number | null }): MixAccount => ({
  account_id: `a${Math.random().toString(36).slice(2)}`,
  label: 'An account',
  ...o,
})

describe('accountMix', () => {
  test('one slice per account, largest share first, shares summing to one', () => {
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
     of addition would give "700200" — plausible-looking and very wrong. */
  test('string values from the database are added, not concatenated', () => {
    expect(accountMix([account({ latest_value: '486210' }), account({ latest_value: '212940' })]).total).toBe(699150)
  })

  test('a single account is the whole ring', () => {
    const { slices, counted } = accountMix([account({ label: 'Only', latest_value: 500 })])
    expect(slices).toHaveLength(1)
    expect(slices[0]).toMatchObject({ label: 'Only', share: 1, value: 500, accounts: 1 })
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
      const mix = accountMix([account({ latest_value: 500 }), account({ latest_value: 'nope' })])
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
     * The invariant that replaced a guard. An explicit `total <= 0` early
     * return was written and removed after a mutation showed it dead: the
     * `> 0` filter upstream means `total` is positive whenever a slice exists.
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
  })

  /**
   * The ramp has four tones and no more, because a single hue on white runs
   * out: indigo-400 and paler fall under the 3:1 floor and 900 beside 800 is
   * indistinguishable. So a fifth account is grouped rather than given a
   * colour that would be invisible or a near-twin.
   */
  describe('more accounts than the ramp has tones', () => {
    test('the tail groups into one slice, and the shares still fill the ring', () => {
      const mix = accountMix(
        Array.from({ length: 9 }, (_, i) => account({ label: `Account ${i}`, latest_value: 100 - i })),
      )
      expect(mix.slices).toHaveLength(MAX_SLICES)
      expect(mix.slices[MAX_SLICES - 1]).toMatchObject({ key: 'other', label: '6 smaller accounts', accounts: 6 })
      expect(mix.slices.reduce((sum, s) => sum + s.share, 0)).toBeCloseTo(1, 10)
      // Grouped, not discarded: every account is still represented.
      expect(mix.counted).toBe(9)
    })

    test('the grouped slice carries the sum of the tail', () => {
      const mix = accountMix(Array.from({ length: 6 }, (_, i) => account({ label: `A${i}`, latest_value: 10 })))
      // Six equal accounts: three drawn, three grouped at 30 of 60.
      expect(mix.slices[MAX_SLICES - 1]).toMatchObject({ value: 30, label: '3 smaller accounts' })
    })

    test('exactly four accounts are each drawn, with no grouping', () => {
      const mix = accountMix(Array.from({ length: MAX_SLICES }, (_, i) => account({ label: `A${i}`, latest_value: 10 })))
      expect(mix.slices).toHaveLength(MAX_SLICES)
      expect(mix.slices.some((s) => s.key === 'other')).toBe(false)
      expect(mix.slices.every((s) => s.accounts === 1)).toBe(true)
    })

    test('one over the limit groups rather than dropping the last', () => {
      const mix = accountMix(Array.from({ length: MAX_SLICES + 1 }, (_, i) => account({ label: `A${i}`, latest_value: 10 })))
      expect(mix.slices).toHaveLength(MAX_SLICES)
      expect(mix.slices[MAX_SLICES - 1].label).toBe('2 smaller accounts')
    })
  })
})

describe('ACCOUNT_TYPE_LABEL', () => {
  /* Shared with the accounts list, which prints these words on each row. The
     ring no longer groups by type, but the map stays one definition — and the
     by-type grouping is a decision that could return. */
  test('names both types the enum holds', () => {
    expect(ACCOUNT_TYPE_LABEL).toMatchObject({
      investment: 'Investment',
      superannuation: 'Superannuation',
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
