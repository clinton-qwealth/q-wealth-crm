import { describe, expect, test } from 'vitest'
import { dayLabel, seriesNote, valueSeries } from '@/lib/value-series'

/**
 * The account chart's arithmetic.
 *
 * Two things here are worth a test and the rest is plumbing: that a gap in the
 * calendar stays a gap, and that no date is ever put through `new Date()`.
 * Both are bugs this codebase has shipped before in other places, which is why
 * `lib/note-date.ts` carries two opposite rules side by side.
 */

const at = (as_at: string, value: string | number) => ({ as_at, value })

describe('dayLabel', () => {
  test('reads the calendar day, not an instant', () => {
    expect(dayLabel('2026-09-16')).toBe('16 Sep')
    expect(dayLabel('2026-01-01')).toBe('1 Jan')
    expect(dayLabel('2026-12-31')).toBe('31 Dec')
  })

  /**
   * The whole reason this function splits the string. `new Date('2026-09-01')`
   * is UTC midnight, which is 31 August anywhere west of Greenwich — and the
   * bug would be invisible in Sydney, where the office is.
   */
  test('and gives the same answer whatever the runtime timezone', () => {
    const tz = process.env.TZ
    const seen = new Set<string>()
    for (const zone of ['UTC', 'America/Los_Angeles', 'Australia/Sydney', 'Pacific/Kiritimati']) {
      process.env.TZ = zone
      seen.add(dayLabel('2026-09-01'))
    }
    process.env.TZ = tz
    expect([...seen]).toEqual(['1 Sep'])
  })
})

describe('valueSeries', () => {
  test('fills every day between the first and the last', () => {
    const s = valueSeries([at('2026-09-14', 100), at('2026-09-17', 130)])
    expect(s.points.map((p) => p.day)).toEqual([
      '2026-09-14',
      '2026-09-15',
      '2026-09-16',
      '2026-09-17',
    ])
  })

  /**
   * The point of filling. A bar chart spaces bars evenly, so handing it only
   * Friday and Monday would draw them adjacent and claim the weekend did not
   * happen. The days between carry null, which draws nothing.
   */
  test('and a day with no valuation is null, not absent and not zero', () => {
    const s = valueSeries([at('2026-09-14', 100), at('2026-09-17', 130)])
    expect(s.points.map((p) => p.value)).toEqual([100, null, null, 130])
    expect(s.recorded).toBe(2)
  })

  test('crosses a month boundary correctly', () => {
    const s = valueSeries([at('2026-08-30', 1), at('2026-09-02', 4)])
    expect(s.points.map((p) => p.day)).toEqual([
      '2026-08-30',
      '2026-08-31',
      '2026-09-01',
      '2026-09-02',
    ])
  })

  /* PostgREST hands numerics back as strings; a Number() away from being a
     concatenation bug, the same note account-mix.ts carries. */
  test('reads numeric strings as numbers', () => {
    const s = valueSeries([at('2026-09-16', '189296.57')])
    expect(s.points[0].value).toBe(189296.57)
    expect(s.high).toBe(189296.57)
  })

  /**
   * An account may be below zero since 17 September, so the domain must hold
   * one. A chart that clamped at zero would draw an overdrawn account as flat.
   */
  test('keeps a negative value and reports it in the domain', () => {
    const s = valueSeries([at('2026-09-15', 100), at('2026-09-16', -69.23)])
    expect(s.low).toBe(-69.23)
    expect(s.high).toBe(100)
    expect(s.points.map((p) => p.value)).toEqual([100, -69.23])
  })

  test('a single valuation is a series of one', () => {
    const s = valueSeries([at('2026-09-16', 500)])
    expect(s.points).toHaveLength(1)
    expect(s.recorded).toBe(1)
    expect(s.low).toBe(500)
    expect(s.high).toBe(500)
  })

  test('nothing recorded is an empty series rather than a thrown error', () => {
    expect(valueSeries(null)).toEqual({ points: [], recorded: 0, low: 0, high: 0, ticks: [] })
    expect(valueSeries([])).toEqual({ points: [], recorded: 0, low: 0, high: 0, ticks: [] })
  })

  test('a malformed row is dropped rather than poisoning the window', () => {
    const s = valueSeries([
      at('2026-09-16', 100),
      at('not-a-date', 5),
      at('2026-09-17', 'abc'),
      at('2026-09-18', 120),
    ])
    expect(s.recorded).toBe(2)
    expect(s.points.map((p) => p.value)).toEqual([100, null, 120])
  })

  /* Three at most: the ends are what a reader checks, the middle says the
     spacing is even. Thirty-one dates under one chart is a grey smear. */
  test('labels at most three days however long the window', () => {
    /* Thirty, not thirty-one: September has thirty days. The first draft of
       this fixture asked for `2026-09-31` and the test failed, which is the
       fixture being wrong rather than the code — the source is a `date`
       column, so a day that does not exist cannot arrive. */
    const rows = Array.from({ length: 30 }, (_, i) => at(`2026-09-${String(i + 1).padStart(2, '0')}`, i))
    const s = valueSeries(rows)
    expect(s.points).toHaveLength(30)
    expect(s.ticks).toEqual(['2026-09-01', '2026-09-15', '2026-09-30'])
  })

  test('and labels both ends when there are only two', () => {
    const s = valueSeries([at('2026-09-16', 1), at('2026-09-17', 2)])
    expect(s.ticks).toEqual(['2026-09-16', '2026-09-17'])
  })
})

describe('seriesNote', () => {
  /* A lone bar with no note reads as a chart that failed, rather than a
     history that has not accumulated. Two production accounts are in exactly
     that state today. */
  test('says so when there is only one valuation', () => {
    expect(seriesNote(valueSeries([at('2026-09-16', 1)]))).toBe(
      'One valuation recorded. A daily feed fills this in over a month.',
    )
  })

  test('counts the days with none', () => {
    expect(seriesNote(valueSeries([at('2026-09-14', 1), at('2026-09-17', 2)]))).toBe(
      '2 valuations over 4 days; 2 days have none.',
    )
  })

  test('and says one day in the singular', () => {
    expect(seriesNote(valueSeries([at('2026-09-14', 1), at('2026-09-16', 2)]))).toBe(
      '2 valuations over 3 days; 1 day has none.',
    )
  })

  test('says nothing is missing when nothing is', () => {
    expect(seriesNote(valueSeries([at('2026-09-16', 1), at('2026-09-17', 2)]))).toBe(
      '2 valuations, one for every day shown.',
    )
  })

  test('and says nothing at all with no series', () => {
    expect(seriesNote(valueSeries([]))).toBeUndefined()
  })
})
