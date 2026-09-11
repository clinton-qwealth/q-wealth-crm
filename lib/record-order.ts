/**
 * Record ordering for the lists on the group page.
 */

/**
 * Live records first, everything else after, **in the order they arrived**.
 *
 * Asked for on 11 September: a closed account should sink to the bottom of the
 * Investment Accounts list rather than sit between two live ones. The same
 * applies to a lapsed or cancelled policy in the section below it.
 *
 * ## It sorts into two buckets and nothing else
 *
 * The rows come out of Postgres already ordered by label, and that order has to
 * survive inside each bucket — a list that is alphabetical apart from one
 * displaced row reads as a bug. This leans on `Array.prototype.sort` being
 * STABLE, which the language has required since ES2019, so equal keys keep
 * their relative positions and the alphabetical order comes through untouched.
 *
 * That is why the comparison is `Number(!isLive(a)) - Number(!isLive(b))` and
 * never a tiebreak on a name. Sorting by label here would work today and be
 * wrong the moment a caller wants a different order — the caller has already
 * chosen one, and this must not overrule it. The test feeds deliberately
 * unsorted names and asserts they come back just as unsorted.
 *
 * Returns a new array; the input is not touched, because these rows are also
 * handed to `wealthSummary` and `accountMix` and a sort in place would reorder
 * what they see. (Neither can actually observe an order — one sums, the other
 * re-sorts by value — but a shared array being mutated by a display concern is
 * the kind of thing that stops being harmless without warning.)
 */
export function liveFirst<T>(rows: readonly T[], isLive: (row: T) => boolean): T[] {
  return [...rows].sort((a, b) => Number(!isLive(a)) - Number(!isLive(b)))
}
