/**
 * How a group's investment value divides across its accounts.
 *
 * ## One arc per account, in one hue — chosen on sight
 *
 * Four palettes were tried in code and none read right. The fifth attempt put
 * six treatments side by side at real size, beside the real account rows, and
 * the choice was made by looking — which is how every other colour on this page
 * was settled.
 *
 * What won is **per account, in a single indigo ramp**. A by-type version was
 * also built and is worth knowing about, because it answers a measured
 * objection this one does not:
 *
 * * **The tiles beside the ring already colour these accounts** — an emerald
 *   shield for superannuation, a gold rising line for investment. So an account
 *   is green in its row and indigo in the ring: two encodings for one thing,
 *   eighteen pixels apart. That was the argument for grouping by type, and it
 *   was overruled on sight in favour of keeping per-account shares.
 * * **One hue, not six.** The palettes that failed were categorical — different
 *   hues implying different kinds of thing. These are the same kind of thing in
 *   different amounts, which is what a sequential ramp says. It also keeps the
 *   ring clear of every colour that already means something here: green is a
 *   live state, amber needs attention, red is the wrong direction, gold is an
 *   investment tile, sky is insurance, brand orange is an action.
 *
 * Pure and renderer-free, because Recharts owns the arc geometry — so the
 * arithmetic is checkable without a DOM. Same reasoning as `wealthSummary()`.
 */

/**
 * The account types, and how they read.
 *
 * Shared with the accounts list, which prints the same words on each row. The
 * ring no longer groups by type, but the map stays here rather than back in the
 * page: it is account vocabulary, one definition, and the by-type grouping is a
 * decision that could return.
 */
export const ACCOUNT_TYPE_LABEL: Record<string, string> = {
  investment: 'Investment',
  superannuation: 'Superannuation',
}

/** The shape the chart needs from an account row, and nothing more. */
export type MixAccount = {
  account_id: string
  label: string
  latest_value: string | number | null
}

export type MixSlice = {
  /** Stable key. `other` for the grouped tail. */
  key: string
  label: string
  value: number
  /** Fraction of the drawn total, 0–1. */
  share: number
  /** How many accounts fold into this arc — one, except for the tail. */
  accounts: number
}

export type AccountMix = {
  /** What the ring draws, largest first. Empty when there is nothing to draw. */
  slices: MixSlice[]
  /** The sum of what is drawn — NOT the group's holdings, which may be more. */
  total: number
  /** Accounts with no recorded value, or recorded at zero. Never hidden. */
  missing: number
  /** How many accounts the ring represents, tail included. */
  counted: number
}

/**
 * The most arcs drawn before the tail is grouped.
 *
 * **Four, and the ramp is why.** A single hue on a white sheet runs out of
 * usable steps fast: indigo 400 and paler measure under the 3:1 non-text floor
 * against white, and 900 beside 800 is a difference no reader can see. That
 * leaves three indigos with real separation — 900, 700, 500 — plus one neutral
 * for whatever is left. A fifth arc would have to be either invisible or a
 * near-twin of its neighbour.
 */
export const MAX_SLICES = 4

export function accountMix(accounts: MixAccount[]): AccountMix {
  const valued = accounts
    .map((a) => ({ key: a.account_id, label: a.label, value: Number(a.latest_value) }))
    /* `latest_value` arrives as a string over PostgREST, so this is a Number()
       away from being a concatenation bug. A null becomes NaN and is dropped
       here rather than poisoning the total. An account recorded at exactly zero
       is a VALUED account that cannot be drawn — it counts as missing, because
       a zero-width arc is not something a reader can see or hover. */
    .filter((a) => Number.isFinite(a.value) && a.value > 0)
    .sort((a, b) => b.value - a.value)

  const total = valued.reduce((sum, a) => sum + a.value, 0)

  /*
   * There is no zero-total guard, and that is deliberate: the filter above
   * keeps only finite values greater than zero, so `total` is positive whenever
   * anything survives it, and when nothing does the map below produces an empty
   * array and the same figures a guard would have returned. One was written and
   * a mutation proved it dead. The invariant it defended is upheld by the
   * filter: **`total > 0` whenever `slices` is non-empty**.
   */
  const head = valued.slice(0, valued.length > MAX_SLICES ? MAX_SLICES - 1 : MAX_SLICES)
  const tail = valued.slice(head.length)
  const drawn = tail.length
    ? [
        ...head.map((a) => ({ ...a, accounts: 1 })),
        {
          key: 'other',
          label: `${tail.length} smaller accounts`,
          value: tail.reduce((sum, a) => sum + a.value, 0),
          accounts: tail.length,
        },
      ]
    : head.map((a) => ({ ...a, accounts: 1 }))

  return {
    slices: drawn.map((a) => ({ ...a, share: a.value / total })),
    total,
    missing: accounts.length - valued.length,
    counted: valued.length,
  }
}

/**
 * A share as whole percent, and never a bare `0%` for a segment that is there.
 *
 * `<1%` rather than rounding to nothing: the arc is drawn, so a reader can see
 * it and hover it, and a legend saying zero beside a visible segment reads as a
 * rendering fault.
 */
export function sharePct(share: number) {
  const whole = Math.round(share * 100)
  return whole === 0 ? '<1%' : `${whole}%`
}
