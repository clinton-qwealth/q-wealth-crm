/**
 * How a group's investment value divides across its accounts.
 *
 * **Pure, and deliberately separate from the chart that draws it.** The donut
 * moved to Recharts on 10 September, which means the library owns the arc
 * geometry — so the arithmetic that used to be checkable through
 * `stroke-dasharray` attributes is no longer visible in the DOM at all. Putting
 * it here keeps it checkable, with no renderer involved: shares, ordering,
 * grouping and — the one that matters — what the chart is unable to show.
 *
 * The same reasoning as `wealthSummary()` and `coverSummary()`: a rule worth
 * getting right is a rule worth testing without a browser in the way.
 */

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
}

export type AccountMix = {
  /** What the ring draws, largest first. Empty when there is nothing to draw. */
  slices: MixSlice[]
  /**
   * The sum of what is drawn — NOT the group's holdings, which may be more.
   * Zero exactly when `slices` is empty, which is what keeps every share's
   * division safe without a guard. See the note in `accountMix`.
   */
  total: number
  /** Accounts with no recorded value, or recorded at zero. Never hidden. */
  missing: number
  /** How many accounts the ring actually represents, tail included. */
  counted: number
}

/**
 * The most segments drawn before the tail is grouped.
 *
 * Six, because that is how many steps the violet ramp has — and two accounts
 * sharing a shade would make the legend ambiguous, which is worse than a
 * grouped "4 smaller accounts" that says exactly what it is.
 */
export const MAX_SLICES = 6

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
   * There is no zero-total guard here, and that is deliberate.
   *
   * One was written — `if (!valued.length || total <= 0) return { slices: [] …
   * }` — and a mutation proved it **dead**: the filter above keeps only finite
   * values greater than zero, so `total` is positive whenever anything survives
   * it, and when nothing survives the code below maps an empty array to an
   * empty array and reports the same figures the guard returned. Replacing the
   * condition with `false` changed no output at all.
   *
   * So the invariant it was defending is upheld one step earlier, by the filter:
   * **`total > 0` whenever `drawn` is non-empty**, which is what makes the
   * `a.value / total` below safe. Removed rather than kept, on the same
   * reasoning as the nav matcher's dead root branch — an unreachable guard
   * reads as a live rule and invites somebody to "fix" the filter beneath it.
   */
  const head = valued.slice(0, valued.length > MAX_SLICES ? MAX_SLICES - 1 : MAX_SLICES)
  const tail = valued.slice(head.length)
  const drawn = tail.length
    ? [
        ...head,
        {
          key: 'other',
          label: `${tail.length} smaller accounts`,
          value: tail.reduce((sum, a) => sum + a.value, 0),
        },
      ]
    : head

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
 * it and hover it, and a legend saying `0%` beside a visible segment reads as a
 * rendering fault.
 */
export function sharePct(share: number) {
  const whole = Math.round(share * 100)
  return whole === 0 ? '<1%' : `${whole}%`
}
