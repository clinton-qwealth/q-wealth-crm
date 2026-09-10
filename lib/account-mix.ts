/**
 * How a group's investment value divides — **by account type**, not by account.
 *
 * ## Why by type
 *
 * The chart began as one segment per account and was recoloured three times
 * without ever looking right. The reason turned out to be structural rather
 * than a matter of hue, and it was found by measuring the page:
 *
 * 1. **The tiles beside it already colour these accounts.** An emerald shield
 *    is superannuation; a gold rising line is investment. A per-account ring
 *    gave the same account a third, unrelated colour, so "Joint Super" read
 *    green in the row and indigo in the ring — two encodings for one thing,
 *    eighteen pixels apart.
 * 2. **Area, not saturation.** This page's tile glyphs run 94–98% saturated,
 *    *more* than the fills that were replaced (69–82%) — so the page is not shy
 *    of strong colour. What it had never carried was a large *field* of it: a
 *    glyph is a dot inside a pale tile, where the ring was ~15,000px² of the
 *    stuff, the biggest patch of colour anywhere on the page.
 *
 * Grouping by type answers both at once. The ring wears the tiles' own two
 * colours, adds no new colour language, and — because there are exactly two
 * account types — it is two calm arcs rather than six competing ones.
 *
 * **What it gives up, plainly:** per-account shares. The list immediately to the
 * left already prints every account's value, so that reading is a glance away;
 * what it could not do is answer "how much of this is in super", which is the
 * question a ring is good at.
 *
 * Pure and renderer-free, because Recharts owns the arc geometry — so the
 * arithmetic is checkable without a DOM. Same reasoning as `wealthSummary()`.
 */

/**
 * The account types, and how they read.
 *
 * One map, shared with the accounts list — which prints the same words on each
 * row — so the ring's legend and the row beneath it cannot disagree.
 */
export const ACCOUNT_TYPE_LABEL: Record<string, string> = {
  investment: 'Investment',
  superannuation: 'Superannuation',
}

/** The shape the chart needs from an account row, and nothing more. */
export type MixAccount = {
  account_id: string
  account_type: string
  latest_value: string | number | null
}

export type MixSlice = {
  /** The `account_type`, so a colour can be keyed by meaning rather than rank. */
  key: string
  label: string
  value: number
  /** Fraction of the drawn total, 0–1. */
  share: number
  /** How many accounts fold into this arc. */
  accounts: number
}

export type AccountMix = {
  /** What the ring draws, largest first. Empty when there is nothing to draw. */
  slices: MixSlice[]
  /** The sum of what is drawn — NOT the group's holdings, which may be more. */
  total: number
  /** Accounts with no recorded value, or recorded at zero. Never hidden. */
  missing: number
  /** How many accounts the ring represents, across every arc. */
  counted: number
}

export function accountMix(accounts: MixAccount[]): AccountMix {
  const valued = accounts
    .map((a) => ({ type: a.account_type, value: Number(a.latest_value) }))
    /* `latest_value` arrives as a string over PostgREST, so this is a Number()
       away from being a concatenation bug. A null becomes NaN and is dropped
       here rather than poisoning the total. An account recorded at exactly zero
       is a VALUED account that cannot be drawn — it counts as missing, because
       a zero-width arc is not something a reader can see or hover. */
    .filter((a) => Number.isFinite(a.value) && a.value > 0)

  const total = valued.reduce((sum, a) => sum + a.value, 0)

  /*
   * There is no zero-total guard, and that is deliberate: the filter above
   * keeps only finite values greater than zero, so `total` is positive whenever
   * anything survives it, and when nothing does the map below produces an empty
   * array and the same figures a guard would have returned. One was written and
   * a mutation proved it dead — see the equivalent note that used to sit here.
   * The invariant it defended is upheld by the filter: **`total > 0` whenever
   * `slices` is non-empty**, which is what makes the division safe.
   */
  const byType = new Map<string, { value: number; accounts: number }>()
  for (const a of valued) {
    const at = byType.get(a.type) ?? { value: 0, accounts: 0 }
    byType.set(a.type, { value: at.value + a.value, accounts: at.accounts + 1 })
  }

  const slices = [...byType.entries()]
    .map(([key, { value, accounts: n }]) => ({
      key,
      /* Falls back to the raw type rather than dropping the arc. The enum holds
         two values today; a third would still be drawn and still be named,
         which is better than a ring that quietly omits money. */
      label: ACCOUNT_TYPE_LABEL[key] ?? key,
      value,
      share: value / total,
      accounts: n,
    }))
    .sort((a, b) => b.value - a.value)

  return {
    slices,
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
