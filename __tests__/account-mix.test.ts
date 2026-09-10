import { describe, expect, test } from 'vitest'
import { ACCOUNT_TYPE_LABEL, accountMix, sharePct, type MixAccount } from '@/lib/account-mix'

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
  account_type: 'investment',
  ...o,
})

const superannuation = (v: string | number | null) =>
  account({ account_type: 'superannuation', latest_value: v })
const investment = (v: string | number | null) =>
  account({ account_type: 'investment', latest_value: v })

describe('accountMix', () => {
  test('one slice per type, largest share first, shares summing to one', () => {
    const { slices, total } = accountMix([
      investment(200),
      superannuation(700),
      investment(100),
    ])
    expect(slices.map((s) => s.label)).toEqual(['Superannuation', 'Investment'])
    expect(slices.map((s) => s.share)).toEqual([0.7, 0.3])
    expect(slices.reduce((sum, s) => sum + s.share, 0)).toBeCloseTo(1, 10)
    expect(total).toBe(1000)
  })

  /** Every account of a type folds into its one arc, and the arc says how many. */
  test('a type’s arc sums its accounts and counts them', () => {
    const { slices } = accountMix([investment(100), investment(250), superannuation(400)])
    const inv = slices.find((s) => s.key === 'investment')!
    expect(inv.value).toBe(350)
    expect(inv.accounts).toBe(2)
    expect(slices.find((s) => s.key === 'superannuation')!.accounts).toBe(1)
  })

  /**
   * The key is the TYPE, not the rank — which is what lets the colour be keyed
   * by meaning. If this were positional, superannuation would be emerald only
   * when it happened to be the bigger slice.
   */
  test('the key is the account type, whichever share is larger', () => {
    expect(accountMix([superannuation(900), investment(100)]).slices.map((s) => s.key)).toEqual([
      'superannuation',
      'investment',
    ])
    // Reversed magnitudes: the order flips, the keys do not change meaning.
    expect(accountMix([superannuation(100), investment(900)]).slices.map((s) => s.key)).toEqual([
      'investment',
      'superannuation',
    ])
  })

  test('a single type is the whole ring', () => {
    const { slices, counted } = accountMix([investment(300), investment(200)])
    expect(slices).toHaveLength(1)
    expect(slices[0]).toMatchObject({ key: 'investment', share: 1, value: 500, accounts: 2 })
    expect(counted).toBe(2)
  })

  /* The view returns numerics as strings over PostgREST. Concatenation instead
     of addition would give "700200" — plausible-looking and very wrong. */
  test('string values from the database are added, not concatenated', () => {
    expect(accountMix([investment('486210'), investment('212940')]).total).toBe(699150)
  })

  /**
   * An unknown type is drawn and named rather than dropped. The enum holds two
   * values; a third must not make money vanish from the ring.
   */
  test('an unrecognised type keeps its arc and falls back to its raw name', () => {
    const { slices } = accountMix([account({ account_type: 'annuity', latest_value: 500 })])
    expect(slices).toHaveLength(1)
    expect(slices[0]).toMatchObject({ key: 'annuity', label: 'annuity' })
  })

  describe('what it cannot draw, it counts', () => {
    test('an account with no recorded value is missing, not dropped', () => {
      const mix = accountMix([investment(500), investment(null), superannuation(null)])
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
      const mix = accountMix([investment(500), investment(0)])
      expect(mix.slices).toHaveLength(1)
      expect(mix.missing).toBe(1)
      expect(mix.slices[0].accounts).toBe(1)
    })

    test('a value that is not a number counts as missing rather than poisoning the total', () => {
      const mix = accountMix([investment(500), investment('not a number')])
      expect(mix.total).toBe(500)
      expect(mix.missing).toBe(1)
      expect(Number.isFinite(mix.total)).toBe(true)
    })

    /* A type present only through unvalued accounts gets no arc at all, rather
       than a zero-width one. */
    test('a type with nothing valued is absent from the ring', () => {
      const mix = accountMix([investment(500), superannuation(null), superannuation(0)])
      expect(mix.slices.map((s) => s.key)).toEqual(['investment'])
      expect(mix.missing).toBe(2)
    })

    test('nothing is missing when every account has a value', () => {
      expect(accountMix([investment(1), superannuation(2)]).missing).toBe(0)
    })
  })

  describe('nothing to draw', () => {
    /**
     * The invariant that replaced a guard. An explicit `total <= 0` early return
     * was written and removed after a mutation showed it dead: the `> 0` filter
     * upstream means `total` is positive whenever a slice exists.
     */
    test('all accounts at zero yields no slices and a zero total, not NaN', () => {
      const mix = accountMix([investment(0), superannuation('0')])
      expect(mix.slices).toEqual([])
      expect(mix.total).toBe(0)
      expect(mix.missing).toBe(2)
      expect(mix.counted).toBe(0)
    })

    test('a zero total never produces a NaN share, however it arises', () => {
      for (const accounts of [
        [] as MixAccount[],
        [investment(0)],
        [investment(null), superannuation('x')],
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
})

describe('ACCOUNT_TYPE_LABEL', () => {
  /* One map, shared with the accounts list, so the ring's legend and the row
     beneath it cannot disagree about what an account type is called. */
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
