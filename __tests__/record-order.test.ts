import { describe, expect, test } from 'vitest'
import { liveFirst } from '@/lib/record-order'

/**
 * `liveFirst`, which sinks a closed account below the live ones.
 *
 * Two buckets and no third rule — the caller has already chosen an order (the
 * group page's query sorts by label) and this must not overrule it. That is
 * most of what is asserted below, because "sorts them into buckets" is easy to
 * get right and "leaves everything else alone" is the part that quietly breaks.
 */
type Row = { name: string; live: boolean }
const row = (name: string, live: boolean): Row => ({ name, live })
const isLive = (r: Row) => r.live
const names = (rows: Row[]) => rows.map((r) => r.name)

describe('liveFirst', () => {
  test('puts every dormant row after every live one', () => {
    const out = liveFirst(
      [row('a', true), row('b', false), row('c', true), row('d', false)],
      isLive,
    )
    expect(names(out)).toEqual(['a', 'c', 'b', 'd'])
  })

  /**
   * **The assertion that stops this growing a name sort.**
   *
   * Ordering by label here would look right today, because the query already
   * does it, and would be wrong the moment a caller wants something else. So
   * the input is deliberately NOT alphabetical, and it has to come back just as
   * unalphabetical — a stable two-bucket sort preserves the order it was given,
   * which is the whole reason this can be one line.
   */
  test('and preserves the order it was given inside each bucket', () => {
    const out = liveFirst(
      [row('zebra', true), row('yak', false), row('ant', true), row('bee', false)],
      isLive,
    )
    expect(names(out)).toEqual(['zebra', 'ant', 'yak', 'bee'])
  })

  test('a list that is all live, or all dormant, comes back untouched', () => {
    const live = [row('c', true), row('a', true), row('b', true)]
    const dead = [row('c', false), row('a', false), row('b', false)]
    expect(names(liveFirst(live, isLive))).toEqual(['c', 'a', 'b'])
    expect(names(liveFirst(dead, isLive))).toEqual(['c', 'a', 'b'])
  })

  test('an empty list is not a special case', () => {
    expect(liveFirst([], isLive)).toEqual([])
  })

  /* The same rows are handed to `wealthSummary` and `AccountDonut`. Neither can
     observe an order today — one sums, the other re-sorts by value — but a
     shared array mutated by a display concern stops being harmless without
     warning. */
  test('does not reorder the caller’s own array', () => {
    const input = [row('a', true), row('b', false), row('c', true)]
    const out = liveFirst(input, isLive)
    expect(names(input), 'the input was sorted in place').toEqual(['a', 'b', 'c'])
    expect(out).not.toBe(input)
  })

  /* The predicate decides, not a status string, so the one helper serves both
     accounts (`active`) and policies (`in_force`). */
  test('the caller’s predicate is what decides, whatever the field is called', () => {
    const policies = [
      { status: 'lapsed' },
      { status: 'in_force' },
      { status: 'cancelled' },
      { status: 'in_force' },
    ]
    expect(liveFirst(policies, (p) => p.status === 'in_force').map((p) => p.status)).toEqual([
      'in_force',
      'in_force',
      'lapsed',
      'cancelled',
    ])
  })
})
