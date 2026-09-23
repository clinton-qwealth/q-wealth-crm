import { describe, expect, test } from 'vitest'
import {
  applyFilters,
  filterOptions,
  money,
  reconcileFilters,
  totalCents,
  NO_DATE,
  NO_FILTERS,
  type ParkingRow,
} from '@/lib/parking-report'
import { monthKey, monthLabel } from '@/lib/note-date'

const row = (over: Partial<ParkingRow>): ParkingRow => ({
  person_name: 'Clinton Hatcher',
  payment_date: '2026-09-14',
  ticket: '81000210953',
  amount_cents: 2508,
  ...over,
})

/* Chosen so each filter partitions the set differently: two months, two
   people, and one receipt whose date could not be read. */
const set: ParkingRow[] = [
  row({ ticket: 'a', payment_date: '2026-09-14', person_name: 'Clinton Hatcher', amount_cents: 2508 }),
  row({ ticket: 'b', payment_date: '2026-09-02', person_name: 'Sarah Chen', amount_cents: 1000 }),
  row({ ticket: 'c', payment_date: '2026-08-30', person_name: 'Clinton Hatcher', amount_cents: 500 }),
  row({ ticket: 'd', payment_date: null, person_name: 'Sarah Chen', amount_cents: null }),
]

describe('month keys', () => {
  /**
   * The whole reason `monthKey` slices rather than parsing. A `YYYY-MM-DD` put
   * through `new Date()` is an instant at UTC midnight, so the 1st of a month
   * is the PREVIOUS month for any reader west of Greenwich.
   *
   * Mutation: `new Date(iso).toISOString().slice(0, 7)` — this fails for
   * 2026-09-01 under TZ=America/New_York, and passes in Sydney, which is the
   * class of bug that ships.
   */
  test('the first of the month is that month, not the one before', () => {
    expect(monthKey('2026-09-01')).toBe('2026-09')
    expect(monthKey('2026-01-01')).toBe('2026-01')
  })

  test('a missing or unreadable date has no month', () => {
    expect(monthKey(null)).toBeNull()
    expect(monthKey('')).toBeNull()
    expect(monthKey('not a date')).toBeNull()
  })

  test('months read as a person writes them, and an unknown one is handed back', () => {
    expect(monthLabel('2026-09')).toBe('Sep 2026')
    expect(monthLabel('2026-13')).toBe('2026-13')
  })

  /* Lexicographic order IS chronological order for YYYY-MM. The month sort
     relies on it rather than on any date arithmetic. */
  test('month keys sort chronologically as plain strings', () => {
    expect(['2026-01', '2025-12', '2026-10', '2026-02'].sort()).toEqual([
      '2025-12',
      '2026-01',
      '2026-02',
      '2026-10',
    ])
  })
})

describe('filters', () => {
  test('no filters is every row', () => {
    expect(applyFilters(set, NO_FILTERS).map((r) => r.ticket)).toEqual(['a', 'b', 'c', 'd'])
  })

  test('the two filters AND together', () => {
    expect(applyFilters(set, { month: '2026-09', person: null }).map((r) => r.ticket)).toEqual(['a', 'b'])
    expect(applyFilters(set, { month: null, person: 'Sarah Chen' }).map((r) => r.ticket)).toEqual(['b', 'd'])
    expect(applyFilters(set, { month: '2026-09', person: 'Sarah Chen' }).map((r) => r.ticket)).toEqual(['b'])
    expect(applyFilters(set, { month: '2026-08', person: 'Sarah Chen' })).toEqual([])
  })

  /**
   * A receipt whose date could not be read is in the report and in the total.
   * Without its own bucket it would show under "All months" and be reachable
   * from no month at all — present in the total, absent from the table, which
   * reads as an arithmetic error rather than as a missing date.
   *
   * Mutation: drop NO_DATE from `monthOf` and let the row fall out — row `d`
   * becomes unreachable and this fails.
   */
  test('a receipt with no date is reachable, under its own heading', () => {
    expect(applyFilters(set, { month: NO_DATE, person: null }).map((r) => r.ticket)).toEqual(['d'])
  })

  test('months are offered newest first, with the undated last', () => {
    expect(filterOptions(set, NO_FILTERS).months).toEqual(['2026-09', '2026-08', NO_DATE])
  })

  /**
   * Month is upstream of person: the people offered are the people with a
   * receipt in the chosen month, because an option that yields an empty table
   * is a dead end rather than a choice.
   *
   * Mutation: derive `people` from all rows instead of `inMonth` — August
   * would offer Sarah Chen, who has no August receipt.
   */
  test('only people with a receipt in the chosen month are offered', () => {
    expect(filterOptions(set, NO_FILTERS).people).toEqual(['Clinton Hatcher', 'Sarah Chen'])
    expect(filterOptions(set, { month: '2026-08', person: null }).people).toEqual(['Clinton Hatcher'])
  })

  /* Months are NOT narrowed by the person, deliberately — that is what makes
     month the upstream one, and it means a reader can always change month
     without first clearing the person. */
  test('every month stays offered whoever is chosen', () => {
    expect(filterOptions(set, { month: null, person: 'Clinton Hatcher' }).months).toEqual([
      '2026-09',
      '2026-08',
      NO_DATE,
    ])
  })

  test('a person the new month does not contain is cleared, not left matching nothing', () => {
    expect(reconcileFilters(set, { month: '2026-08', person: 'Sarah Chen' })).toEqual({
      month: '2026-08',
      person: null,
    })
    // One who IS in the month survives.
    expect(reconcileFilters(set, { month: '2026-08', person: 'Clinton Hatcher' })).toEqual({
      month: '2026-08',
      person: 'Clinton Hatcher',
    })
  })
})

describe('the total', () => {
  /**
   * The total is computed from the rows it is handed, so it cannot disagree
   * with the table above it. A total that still reads the whole report while
   * one month is displayed is a wrong number on a page somebody is paying
   * from — the single most consequential thing this file protects.
   */
  test('follows the filter rather than the whole report', () => {
    expect(totalCents(set)).toBe(4008)
    expect(totalCents(applyFilters(set, { month: '2026-09', person: null }))).toBe(3508)
    expect(totalCents(applyFilters(set, { month: '2026-08', person: null }))).toBe(500)
  })

  test('an unreadable amount counts as nothing, not as NaN', () => {
    expect(totalCents([row({ amount_cents: null })])).toBe(0)
    expect(totalCents(applyFilters(set, { month: NO_DATE, person: null }))).toBe(0)
  })

  test('money writes cents as dollars, with separators and a sign', () => {
    expect(money(2508)).toBe('$25.08')
    expect(money(0)).toBe('$0.00')
    expect(money(123456789)).toBe('$1,234,567.89')
    expect(money(-500)).toBe('-$5.00')
    expect(money(null)).toBe('—')
  })
})
