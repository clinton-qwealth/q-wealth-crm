import { describe, expect, test } from 'vitest'
import {
  ASSET_CLASSES,
  ASSET_CLASS_LABEL,
  ASSET_FAMILY,
  allocation,
  allocationNote,
} from '@/lib/allocation'

/**
 * The allocation's arithmetic, checked without a renderer.
 *
 * Same split, and the same reason, as `account-mix.test.ts`: jsdom has no
 * layout engine, so nothing downstream can measure a bar. What CAN be checked
 * is the geometry that produces it, and that is the half where this chart could
 * quietly lie — by dropping a negative holding, by normalising a set that does
 * not add up, or by drawing a 4% class the same length as a 40% one.
 *
 * The real numbers below are HUB24 account 24033810 as it landed on
 * 15 September, negative `other` and all.
 */

/** The live account, in the order the view returns it. */
const REAL = [
  { asset_class: 'australian_shares', weight: '0.245600' },
  { asset_class: 'international_shares', weight: '0.492800' },
  { asset_class: 'australian_fixed_interest', weight: '0.142500' },
  { asset_class: 'international_fixed_interest', weight: '0.045100' },
  { asset_class: 'cash', weight: '0.096800' },
  { asset_class: 'other', weight: '-0.022800' },
]

describe('the class list', () => {
  test('every class has a label and a family', () => {
    expect(ASSET_CLASSES.length).toBe(8)
    for (const key of ASSET_CLASSES) {
      expect(ASSET_CLASS_LABEL[key], `${key} has no label`).toBeTruthy()
      expect(ASSET_FAMILY[key], `${key} has no family`).toBeTruthy()
    }
  })

  /* Eight classes over four families is what lets the chart reuse the existing
     four-step ink ramp. A ninth family would mean a fifth colour nobody has
     chosen, so the shape is pinned rather than assumed. */
  test('and the families are the four the colour ramp has inks for', () => {
    expect(new Set(Object.values(ASSET_FAMILY))).toEqual(
      new Set(['shares', 'fixed_interest', 'property', 'cash']),
    )
  })
})

describe('allocation()', () => {
  test('returns one row per reported class, in canonical order', () => {
    const a = allocation([...REAL].reverse())
    expect(a.rows.map((r) => r.key)).toEqual([
      'australian_shares',
      'international_shares',
      'australian_fixed_interest',
      'international_fixed_interest',
      'cash',
      'other',
    ])
  })

  /**
   * The assertion this whole module exists for. `Math.abs` anywhere in the
   * pipeline turns a short position into a holding.
   */
  test('a negative weight keeps its sign and is flagged', () => {
    const other = allocation(REAL).rows.find((r) => r.key === 'other')!
    expect(other.weight).toBeCloseTo(-0.0228, 6)
    expect(other.negative).toBe(true)
  })

  /**
   * The scale is `[min(0, smallest), max(0, largest)]`. With this account
   * min is −0.0228 and max is 0.4928, so the span is 0.5156 and zero sits
   * 4.42% along the track.
   */
  test('the domain makes room below zero, and zero lands where it should', () => {
    const a = allocation(REAL)
    expect(a.zeroPct).toBeCloseTo((0.0228 / 0.5156) * 100, 4)

    const shares = a.rows.find((r) => r.key === 'international_shares')!
    expect(shares.startPct).toBeCloseTo(a.zeroPct, 6)
    expect(shares.lengthPct).toBeCloseTo((0.4928 / 0.5156) * 100, 4)
  })

  /* A negative bar ends exactly where the zero rule is drawn — that adjacency
     is what makes it read as "below zero" rather than as a short first class. */
  test('and a negative bar runs up to the zero rule from the left', () => {
    const a = allocation(REAL)
    const other = a.rows.find((r) => r.key === 'other')!
    expect(other.startPct).toBeCloseTo(0, 6)
    expect(other.startPct + other.lengthPct).toBeCloseTo(a.zeroPct, 6)
  })

  test('with nothing negative, zero is the left edge and every bar starts there', () => {
    const a = allocation([
      { asset_class: 'cash', weight: 0.25 },
      { asset_class: 'australian_shares', weight: 0.75 },
    ])
    expect(a.zeroPct).toBe(0)
    expect(a.rows.every((r) => r.startPct === 0)).toBe(true)
    expect(a.rows.find((r) => r.key === 'australian_shares')!.lengthPct).toBeCloseTo(100, 6)
  })

  /**
   * The migration's own words: a negative slice "is its problem to draw
   * honestly, not this table's to hide". Normalising would also quietly repair
   * a feed that is under-reporting, which is the failure worth seeing.
   */
  test('weights that do not total one are left alone', () => {
    const a = allocation([
      { asset_class: 'australian_shares', weight: 0.5 },
      { asset_class: 'cash', weight: 0.477 },
    ])
    expect(a.total).toBeCloseTo(0.977, 6)
    expect(a.complete).toBe(false)
    expect(a.rows.map((r) => r.weight)).toEqual([0.5, 0.477])
    expect(allocationNote(a)).toBe('Classes total 97.7%, as reported')
  })

  test('and a set that does total one says nothing', () => {
    const a = allocation(REAL)
    expect(a.complete).toBe(true)
    expect(allocationNote(a)).toBeUndefined()
  })

  test('the minus is a real minus sign, not a hyphen', () => {
    const other = allocation(REAL).rows.find((r) => r.key === 'other')!
    expect(other.text).toBe('−2.3%')
    expect(other.text).not.toContain('-')
  })

  /* A live holding that rounds to 0.0% would read as nothing at all. */
  test('a holding too small to round to a tenth still says it exists', () => {
    const a = allocation([
      { asset_class: 'australian_shares', weight: 0.9997 },
      { asset_class: 'listed_property', weight: 0.0003 },
    ])
    expect(a.rows.find((r) => r.key === 'listed_property')!.text).toBe('<0.1%')
  })

  test('a class with no weight is absent rather than drawn as nothing', () => {
    const a = allocation([
      { asset_class: 'australian_shares', weight: 1 },
      { asset_class: 'cash', weight: 0 },
    ])
    expect(a.rows.map((r) => r.key)).toEqual(['australian_shares'])
  })

  /* The feed can add a class before the app knows its name — it did exactly
     that on 15 September. Dropping it is better than printing a raw key, and
     asset-classes.test.ts is what stops the drop being silent. */
  test('a class this module does not know is dropped, not printed raw', () => {
    const a = allocation([
      { asset_class: 'australian_shares', weight: 0.5 },
      { asset_class: 'infrastructure', weight: 0.5 },
    ])
    expect(a.rows.map((r) => r.key)).toEqual(['australian_shares'])
  })

  test('nothing reported draws nothing', () => {
    for (const empty of [null, undefined, []]) {
      const a = allocation(empty)
      expect(a.rows).toEqual([])
      expect(a.zeroPct).toBe(0)
      expect(allocationNote(a)).toBeUndefined()
    }
  })
})
