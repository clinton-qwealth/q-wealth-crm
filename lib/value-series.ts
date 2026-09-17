/**
 * An account's recent value, as a chart can draw it.
 *
 * Pure arithmetic, no JSX, for the reason `allocation.ts` gives one file over:
 * the decisions worth testing here are about dates and gaps, and a render test
 * that has to find a `<rect>` to check them is a test about Recharts.
 *
 * ## The two decisions
 *
 * **The calendar is filled, and the gaps are real.** A bar chart spaces its
 * bars evenly, so feeding it only the days that have a valuation would draw
 * Friday and Monday side by side and silently claim they are adjacent. The
 * feeds run daily and skip weekends, so that is not a hypothetical: a month of
 * real data has eight or nine holes in it. Every day in the window therefore
 * gets a point, and a day with no valuation gets `null`, which Recharts draws
 * as nothing at all.
 *
 * **The window is the server's, not today's.** `value_series` arrives already
 * bounded to the thirty days ending at the account's OWN latest valuation —
 * see the migration — and this module never widens or re-anchors it. An
 * account last valued in August charts August. That is the same rule the trend
 * arrow beside it uses, and a chart on a different window would invite the
 * comparison that is wrong.
 */

/** A row as `value_series` delivers it: a date string and a numeric string. */
export type ValuePoint = {
  as_at: string
  value: string | number
}

export type SeriesPoint = {
  /** `YYYY-MM-DD`, every day in the window, in order. */
  day: string
  /** The value recorded that day, or null where none was. */
  value: number | null
  /** "16 Sep" — the axis label. Only some points carry one; see `ticks`. */
  label: string
}

export type ValueSeries = {
  points: SeriesPoint[]
  /** The days that actually carry a figure. `points.length` is the calendar. */
  recorded: number
  /** The lowest and highest recorded values, for the axis domain. */
  low: number
  high: number
  /** The days to label, so a month of bars does not carry thirty-one dates. */
  ticks: string[]
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/**
 * "16 Sep", from `YYYY-MM-DD`, without constructing a Date.
 *
 * The same rule and the same reason as `formatCalendarDate`: a `date` column is
 * a day, not a moment, and `new Date('2026-09-16')` is UTC midnight, which
 * renders as the 15th anywhere west of Greenwich. Sydney is east of it, so this
 * would look correct here and be wrong for a colleague travelling — which is
 * exactly the class of bug that gets shipped.
 */
export function dayLabel(day: string) {
  const [, m, d] = day.split('-')
  return `${Number(d)} ${MONTHS[Number(m) - 1] ?? '?'}`
}

/** One day later, on the calendar, from `YYYY-MM-DD`. */
function nextDay(day: string) {
  const [y, m, d] = day.split('-').map(Number)
  /* Date.UTC and back, rather than a local Date: this is pure calendar
     arithmetic and must not shift with the reader's timezone. Round-tripping
     through UTC is safe precisely because nothing here is a moment. */
  const t = new Date(Date.UTC(y, m - 1, d + 1))
  return t.toISOString().slice(0, 10)
}

/** Whether `a` is on or before `b`, as `YYYY-MM-DD` strings compare. */
const onOrBefore = (a: string, b: string) => a <= b

/**
 * The window as a chart needs it, or an empty series when there is nothing.
 *
 * The rows arrive ordered by the view (`jsonb_agg … order by v.as_at`), and
 * that order is not re-established here: re-sorting would hide a view that had
 * stopped ordering, and the view is where the guarantee belongs.
 */
export function valueSeries(rows: ValuePoint[] | null | undefined): ValueSeries {
  const clean = (rows ?? [])
    .map((r) => ({ day: String(r.as_at ?? '').slice(0, 10), value: Number(r.value) }))
    .filter((r) => /^\d{4}-\d{2}-\d{2}$/.test(r.day) && Number.isFinite(r.value))

  if (clean.length === 0) {
    return { points: [], recorded: 0, low: 0, high: 0, ticks: [] }
  }

  const byDay = new Map(clean.map((r) => [r.day, r.value]))
  const first = clean[0].day
  const last = clean[clean.length - 1].day

  const points: SeriesPoint[] = []
  /* A guard on the loop, not because the data should ever need one, but
     because an unbounded while over string dates is one malformed row away
     from never ending. The window is 31 days by construction; 400 is a
     ceiling that cannot be reached by correct data. */
  for (let day = first, n = 0; onOrBefore(day, last) && n < 400; day = nextDay(day), n += 1) {
    points.push({ day, value: byDay.get(day) ?? null, label: dayLabel(day) })
  }

  const values = clean.map((r) => r.value)

  /*
   * THREE TICKS AT MOST: the first day, the last, and the middle one. Thirty-one
   * dates under a 400px chart overlap into a grey smear, and Recharts' own
   * auto-skipping picks whichever happen to fit rather than the ones that mean
   * something. The ends are what a reader checks — "from when, to when" — and
   * the middle is what tells them the spacing is even.
   */
  const ticks =
    points.length <= 2
      ? points.map((p) => p.day)
      : [points[0].day, points[Math.floor((points.length - 1) / 2)].day, points[points.length - 1].day]

  return {
    points,
    recorded: clean.length,
    low: Math.min(...values),
    high: Math.max(...values),
    ticks,
  }
}

/**
 * What the chart says about itself underneath, or nothing.
 *
 * A bar per day is only honest if the reader knows how many days actually
 * carry one. Two of the five accounts in production have a single valuation,
 * and a lone bar with no note reads as a chart that failed rather than a
 * history that has not accumulated yet.
 */
export function seriesNote(s: ValueSeries): string | undefined {
  if (s.recorded === 0) return undefined
  if (s.recorded === 1) return 'One valuation recorded. A daily feed fills this in over a month.'
  if (s.recorded < s.points.length) {
    const missing = s.points.length - s.recorded
    return `${s.recorded} valuations over ${s.points.length} days; ${missing} ${
      missing === 1 ? 'day has' : 'days have'
    } none.`
  }
  return `${s.recorded} valuations, one for every day shown.`
}
