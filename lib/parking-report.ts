import { monthKey } from './note-date'

/**
 * The shared parking report: its row, its filters, and the pure functions the
 * table is built from.
 *
 * Split out of the component for the reason `lib/workflow-board.ts` gives: the
 * narrowing is the part worth testing, and it is testable without rendering
 * anything. The component below it holds state and markup and no logic.
 *
 * ## Why the filtering happens here and not in the database
 *
 * `parking_report(token)` is SECURITY DEFINER and, as well as returning the
 * rows, it does this:
 *
 *     update public.report_shares
 *        set last_viewed_at = now(), view_count = view_count + 1
 *
 * So every call is counted as a view. Filters driven through the URL would
 * re-run the function on each change, and choosing a month and then a person
 * would record three views of a page somebody opened once — quietly ruining
 * the only usage signal a shared link has. The whole report arrives in one
 * call and is small by construction (receipts arrive one SMS at a time), so
 * the rows are narrowed in the browser and the database is asked once.
 *
 * It matches the house pattern anyway: every filter in this application is
 * local state over rows already fetched. `components/audit-trail.tsx` states
 * the cost of that — a filtered view is not shareable — and here that cost is
 * smaller than usual, because the URL of this page is a secret credential and
 * is not something to be spreading through browser history in variations.
 */
export type ParkingRow = {
  /** NOT NULL in the database — no "unattributed" bucket is needed. */
  person_name: string
  /** Nullable. A receipt can arrive with an unparseable date. */
  payment_date: string | null
  /**
   * The day the receipt was texted in, as `YYYY-MM-DD`.
   *
   * A CALENDAR DATE, not an instant, and never null. `parking_receipts.created_at`
   * is a timestamptz; the RPC converts it once, in `Australia/Sydney`, and hands
   * over a date. That is deliberate — see the migration. Doing it here instead
   * would render the server's UTC day during SSR and the reader's Sydney day
   * after hydration, which React reports as a mismatch and a person sees as a
   * date that changes while they look at it.
   */
  submitted_on: string
  ticket: string
  /** Nullable, and counted as zero in a total. */
  amount_cents: number | null
}

/** `null` means "not applied" — never `''`, which is only the <select> spelling. */
export type ParkingFilters = {
  month: string | null
  person: string | null
}

export const NO_FILTERS: ParkingFilters = { month: null, person: null }

/**
 * The bucket for a receipt whose date could not be read.
 *
 * `payment_date` is nullable, so without this a dateless row would be visible
 * under "All months" and unreachable under every specific month — present in
 * the total, absent from the table, which reads as an arithmetic bug. It is a
 * sentinel rather than a real key so it can never collide with a `YYYY-MM`.
 * The option only appears when such a row exists, so in the normal case nobody
 * ever sees it. Same shape as UNASSIGNED in `lib/workflow-board.ts`.
 */
export const NO_DATE = '__no_date__'

const monthOf = (r: ParkingRow) => monthKey(r.payment_date) ?? NO_DATE

export function applyFilters(rows: ParkingRow[], f: ParkingFilters): ParkingRow[] {
  return rows.filter(
    (r) =>
      (f.month === null || monthOf(r) === f.month) &&
      (f.person === null || r.person_name === f.person),
  )
}

/**
 * What each select may offer, given what the other has already narrowed to.
 *
 * Month is upstream of person, matching how the report is read: pick a month,
 * then narrow to one person within it. So the people offered are the people
 * with a receipt in the chosen month — an option that yields an empty table is
 * a dead end, not a choice, which is the rule `filterOptions` in
 * `lib/workflow-board.ts` is written around.
 *
 * Months are NOT narrowed by the chosen person, deliberately: that is what
 * makes month the upstream of the two. Every month is always offered, so the
 * reader can always move between months without first clearing the person.
 *
 * Months sort newest first, to agree with the table — which the RPC returns
 * `order by payment_date desc`. They are `YYYY-MM` strings, so that is a plain
 * reverse string sort and needs no date arithmetic. NO_DATE sorts last.
 */
export function filterOptions(rows: ParkingRow[], f: ParkingFilters) {
  const uniq = <T,>(xs: T[]) => [...new Set(xs)]
  const inMonth = applyFilters(rows, { ...NO_FILTERS, month: f.month })
  return {
    months: uniq(rows.map(monthOf)).sort((a, b) =>
      a === NO_DATE ? 1 : b === NO_DATE ? -1 : b.localeCompare(a),
    ),
    people: uniq(inMonth.map((r) => r.person_name)).sort((a, b) => a.localeCompare(b)),
  }
}

/**
 * Drop a person the new month does not contain.
 *
 * Without this, choosing September and then a person who only has August
 * receipts leaves a table that is empty while both selects still read as though
 * they are showing something. The board takes the same care for the same
 * reason. Month is never reconciled away, because nothing upstream can strand
 * it.
 */
export function reconcileFilters(rows: ParkingRow[], f: ParkingFilters): ParkingFilters {
  const { people } = filterOptions(rows, f)
  return { month: f.month, person: f.person !== null && people.includes(f.person) ? f.person : null }
}

/**
 * The total of what is on screen.
 *
 * Takes the rows it is given, so it cannot disagree with the table: a total
 * that still reads the whole report while the table shows one month is a wrong
 * number on a page somebody is paying from. A null amount counts as zero — the
 * receipt is real even when its figure could not be read.
 */
export function totalCents(rows: ParkingRow[]): number {
  return rows.reduce((sum, r) => sum + (r.amount_cents ?? 0), 0)
}

/** Cents to dollars, built from the integer. Separators written by hand so the
 *  figures do not change shape with the server's locale. */
export function money(cents: number | null): string {
  if (cents === null) return '—'
  const negative = cents < 0
  const abs = Math.abs(cents)
  const dollars = String(Math.floor(abs / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  return `${negative ? '-$' : '$'}${dollars}.${String(abs % 100).padStart(2, '0')}`
}
