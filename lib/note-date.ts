/**
 * A note's date, rendered in the reader's timezone.
 *
 * DELIBERATELY NOT the formatDate() used for a date of birth, and the
 * difference is not cosmetic. A date of birth is a calendar date with no
 * timezone, so that helper splits the string and never touches Date — putting
 * it through `new Date()` renders the previous day west of Greenwich.
 *
 * `occurred_at` — and a workflow's started_at / completed_at — are timestamptz:
 * instants. The calendar date one falls on genuinely depends on where you are
 * standing, and the adviser's own timezone is the right answer. Splitting the
 * string here would show the UTC date, which in Sydney is the previous day for
 * the first ten hours of every morning.
 *
 * Same-looking problem, opposite fix.
 *
 * A plain module with no 'use client', on purpose: it is called from the
 * workflow detail page, a Server Component, and a function exported from a
 * client module cannot be called on the server — the browser refused the
 * page the first time, after every unit test had passed.
 */
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

export function formatNoteDate(iso: string) {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  /* getDate/getMonth/getFullYear read the LOCAL calendar parts of the instant,
     which is the conversion this needs. The month name is then taken from a
     fixed list rather than from toLocaleDateString: `month: 'short'` renders
     "Jul" in a browser and "July" under Node's ICU in the test runner, and a
     date format that changes with the runtime is one nobody can assert on. */
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`
}

/**
 * A calendar date, rendered as it was written: "30 Sep 2026".
 *
 * The OTHER half of the pair, and the whole reason both live in one module.
 * A `date` column — a workflow's due_at, a person's date_of_birth — is a day,
 * not a moment. Putting one through `new Date()` parses it as UTC midnight, so
 * anywhere west of Greenwich it renders the day BEFORE. So this splits the
 * string and never constructs a Date. formatNoteDate above must do the exact
 * opposite for the exact opposite reason; keeping them adjacent means nobody
 * can reach for one without seeing the other.
 *
 * Same output shape as formatNoteDate on purpose: on the workflow detail page a
 * created instant and a due date sit side by side in one row, and two
 * different-looking date formats there would read as two different kinds of
 * thing. The member panel's date of birth stays DD-MM-YYYY — an identity
 * document's format, read digit by digit rather than as prose.
 */
export function formatCalendarDate(iso: string) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso)
  if (!m) return iso
  const month = MONTHS[Number(m[2]) - 1]
  // A month outside 1-12 is not a date this can render; hand back the raw value
  // rather than "30 undefined 2026".
  if (!month) return iso
  return `${Number(m[3])} ${month} ${m[1]}`
}
