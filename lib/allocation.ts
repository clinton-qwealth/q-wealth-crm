/**
 * How an account is invested, turned into something drawable.
 *
 * The arithmetic lives here rather than in the component for the reason
 * `lib/account-mix.ts` gives: geometry that can be checked without a renderer
 * is geometry that gets checked. jsdom has no layout engine, so a test can read
 * these numbers but could never measure the bars they produce.
 *
 * ## The thing this module exists to get right
 *
 * A weight may be NEGATIVE. `financial_account_allocations.weight` is
 * `numeric(7,6)` in the range −1 to 1, widened from [0, 1] on 15 September when
 * the first real HUB24 run reported `other = −0.0228` on an account whose
 * classes still totalled exactly one. A short overlay, a pending settlement or
 * an accrual is a fact about a portfolio, and the migration that allowed it
 * wrote down what to do about it: "a negative slice is its problem to draw
 * honestly, not this table's to hide."
 *
 * So: weights are reported, never normalised. They are not scaled to sum to
 * 100, not clamped at zero, and a set that sums to 0.977 is drawn as 0.977 with
 * a note saying so. Dividing through would invent a portfolio nobody reported.
 */

/**
 * The canonical set, in the order it is read: growth first, then defensive,
 * then the remainder. Mirrors `financial_account_allocations_class_known` —
 * `__tests__/asset-classes.test.ts` asserts the two agree in both directions,
 * because a class added to the check constraint and forgotten here would reach
 * a client's screen as the raw string `direct_property`.
 */
export const ASSET_CLASSES = [
  'australian_shares',
  'international_shares',
  'australian_fixed_interest',
  'international_fixed_interest',
  'listed_property',
  'direct_property',
  'cash',
  'other',
] as const

export type AssetClass = (typeof ASSET_CLASSES)[number]

export const ASSET_CLASS_LABEL: Record<AssetClass, string> = {
  australian_shares: 'Australian shares',
  international_shares: 'International shares',
  australian_fixed_interest: 'Australian fixed interest',
  international_fixed_interest: 'International fixed interest',
  listed_property: 'Listed property',
  direct_property: 'Direct property',
  cash: 'Cash',
  other: 'Other',
}

/**
 * Four families over eight classes, and the reason the chart is coloured by
 * family rather than by class.
 *
 * The page's `--mix-1..--mix-4` ramp has four steps by construction
 * (`MAX_SLICES` in account-mix.ts) and is SEQUENTIAL — it means "more" and
 * "less", which is the wrong dimension for a set of kinds. Stretching it to
 * eight would run out, and inventing eight categorical hues would spend colour
 * this page has already committed to other meanings.
 *
 * Family also happens to be the question an adviser actually asks of an
 * allocation — how much growth, how much defensive — so the colour carries
 * information rather than just telling rows apart. The label always names the
 * class, so nothing depends on colour alone.
 */
export type AssetFamily = 'shares' | 'fixed_interest' | 'property' | 'cash'

export const ASSET_FAMILY: Record<AssetClass, AssetFamily> = {
  australian_shares: 'shares',
  international_shares: 'shares',
  australian_fixed_interest: 'fixed_interest',
  international_fixed_interest: 'fixed_interest',
  listed_property: 'property',
  direct_property: 'property',
  cash: 'cash',
  other: 'cash',
}

/**
 * The four family inks, shares to cash down the chart ramp — ONE map, read by
 * the ring and by the bars, because the two are one picture split in two and a
 * class drawn one colour above and another below would read as two things.
 * The tokens are literal hex in `globals.css`; `mix-palette.test.ts` measures
 * them against both grounds the charts paint on.
 */
export const FAMILY_INK: Record<AssetFamily, string> = {
  shares: 'var(--mix-1)',
  fixed_interest: 'var(--mix-2)',
  property: 'var(--mix-3)',
  cash: 'var(--mix-4)',
}

/** U+2212. The same character `owedMoney` uses, and not a hyphen. */
const MINUS = '−'

/** How far a set may stray from 1 and still be called complete. The tolerance
 *  the feed itself enforces before it writes an allocation at all. */
const TOLERANCE = 0.01

export type AllocationRow = {
  key: AssetClass
  label: string
  family: AssetFamily
  /** As reported. Signed. Never normalised. */
  weight: number
  /** `24.6%` · `−2.3%` · `<0.1%` */
  text: string
  negative: boolean
  /** Where the bar starts, as a percentage of the track. */
  startPct: number
  /** How long it is, as a percentage of the track. */
  lengthPct: number
}

export type Allocation = {
  rows: AllocationRow[]
  /** Where zero sits on the track, as a percentage. 0 when nothing is negative,
   *  in which case no zero rule is drawn and every bar starts at the left. */
  zeroPct: number
  /** The reported weights, summed. Not forced to 1. */
  total: number
  /** Whether that sum is within a per cent of one. */
  complete: boolean
}

/** What the view hands over: PostgREST renders `numeric` as a string. */
export type AllocationInput = {
  asset_class: string
  weight: string | number
}

/** `24.6%` · `−2.3%` · `<0.1%` — a weight as the charts print it. Exported so
 *  the ring's family legend prints its sums the way the class rows do. */
export function weightText(weight: number): string {
  const pct = weight * 100
  const abs = Math.abs(pct)
  const sign = weight < 0 ? MINUS : ''
  // A live holding that rounds to 0.0% would read as nothing at all. Saying it
  // is under a tenth of a per cent is both true and visibly not zero.
  if (abs > 0 && abs < 0.05) return `${sign}<0.1%`
  return `${sign}${abs.toFixed(1)}%`
}

/**
 * The scale runs `[min(0, smallest), max(0, largest)]` — NOT `[0, 1]`.
 *
 * Two reasons, and the first is correctness: with a negative weight in the set
 * there is no room below zero on a 0–1 track, so the bar would have nowhere to
 * go. The second is legibility: at the drawer's ~256px of track a fixed 0–100
 * scale draws a 4% class as ten pixels, and seven of eight rows become stubs of
 * the same apparent length. The bar is the picture; the printed percentage is
 * the fact.
 */
export function allocation(input: AllocationInput[] | null | undefined): Allocation {
  const known = new Set<string>(ASSET_CLASSES)

  const parsed = (input ?? [])
    .map((r) => ({ key: r.asset_class, weight: Number(r.weight) }))
    // A class the database has and this module does not is dropped rather than
    // rendered as a raw key. asset-classes.test.ts is what stops that being
    // silent — it fails the moment the two lists disagree.
    .filter((r) => known.has(r.key) && Number.isFinite(r.weight) && r.weight !== 0)
    .map((r) => ({ key: r.key as AssetClass, weight: r.weight }))

  // Canonical order, whatever order the rows arrived in. The view sorts, and
  // relying on that would put the chart's reading order in the database.
  parsed.sort((a, b) => ASSET_CLASSES.indexOf(a.key) - ASSET_CLASSES.indexOf(b.key))

  const total = parsed.reduce((sum, r) => sum + r.weight, 0)

  if (parsed.length === 0) {
    return { rows: [], zeroPct: 0, total: 0, complete: false }
  }

  const min = Math.min(0, ...parsed.map((r) => r.weight))
  const max = Math.max(0, ...parsed.map((r) => r.weight))
  const span = max - min
  const zeroPct = span === 0 ? 0 : ((0 - min) / span) * 100

  const rows: AllocationRow[] = parsed.map((r) => {
    const negative = r.weight < 0
    const lengthPct = span === 0 ? 0 : (Math.abs(r.weight) / span) * 100
    // A negative bar runs from its own value up to zero; a positive one from
    // zero up to its value. Both are measured from the left of the track.
    const startPct = span === 0 ? 0 : negative ? ((r.weight - min) / span) * 100 : zeroPct
    return {
      key: r.key,
      label: ASSET_CLASS_LABEL[r.key],
      family: ASSET_FAMILY[r.key],
      weight: r.weight,
      text: weightText(r.weight),
      negative,
      startPct,
      lengthPct,
    }
  })

  return { rows, zeroPct, total, complete: Math.abs(total - 1) <= TOLERANCE }
}

/** `Classes total 97.7%, as reported` — or nothing when they total one. */
export function allocationNote(a: Allocation): string | undefined {
  if (a.rows.length === 0 || a.complete) return undefined
  return `Classes total ${(a.total * 100).toFixed(1)}%, as reported`
}
