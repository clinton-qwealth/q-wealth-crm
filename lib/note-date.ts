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
