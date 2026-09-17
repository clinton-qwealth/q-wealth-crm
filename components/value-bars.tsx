'use client'

import { useMemo } from 'react'
import { Bar, BarChart, Cell, ReferenceLine, XAxis, YAxis } from 'recharts'
import { accountMoney } from './ui'
import { dayLabel, seriesNote, valueSeries, type ValuePoint } from '@/lib/value-series'

/**
 * An account's value over the thirty days up to its latest valuation.
 *
 * ## Zero-based, and that is not negotiable
 *
 * A bar's grammar is "length is quantity, measured from nothing". Truncating
 * the axis to make a stable account look dramatic is the oldest misleading
 * chart there is, and this codebase has already refused its cousin twice — the
 * +25% that would have been printed under a client's total wealth, and the
 * 45% that is debt over assets rather than the shape of the sheet.
 *
 * The cost is real and worth stating: an account that moved 0.3% in a month
 * draws thirty bars of near-identical height. **That is what happened.** The
 * precision lives beside the chart, not in it — the figure above carries its
 * own trend arrow with the exact amount and percentage on its tooltip, and the
 * note beneath says how many days actually carry a valuation. If the movement
 * rather than the level is ever the point, the honest answer is a line chart
 * on a free axis, not a bar chart on a cropped one.
 *
 * ## Why not ResponsiveContainer
 *
 * It measures its parent and renders **nothing** in jsdom, which would blind
 * every test here. The same technique as `account-donut`: a fixed logical size
 * that Recharts turns into a viewBox, and a class that forces its wrapper to
 * fill the container. Verified there, reused rather than rediscovered.
 */

/** The chart's logical size — a viewBox, not rendered pixels. See `FLUID`. */
const WIDTH = 480
const HEIGHT = 140

/** Forces Recharts' wrapper to fill its container. Copied from `account-donut`. */
const FLUID = '[&_.recharts-wrapper]:!h-full [&_.recharts-wrapper]:!w-full'

/**
 * Indigo, the same `--mix-1` the investment ring's darkest arc takes.
 *
 * Deliberately the chart family rather than a new one: this bar chart and the
 * allocation donut sit in one tab, and two charts in two unrelated hues read as
 * two systems. Brand orange stays an action, green stays a live state.
 */
const INK = 'var(--mix-1)'

/**
 * A day below zero takes the neutral, for the reason `allocation-bars` gives:
 * a difference that survives greyscale, carried alongside the side of the zero
 * rule rather than by colour alone. neutral-600, the same step, measured
 * against the same white ground in `mix-palette.test.ts`.
 */
const BELOW = '#525252'

export function ValueBars({
  rows,
  height = 'h-32',
}: {
  rows: ValuePoint[] | null | undefined
  /** The drawn height. A closed set, because Tailwind scans source text. */
  height?: 'h-24' | 'h-32' | 'h-40'
}) {
  /* Memoised for the reason `account-donut` records: Recharts regenerates its
     animation id whenever `data` changes by reference, and hands it to React as
     a key — so a fresh array on every render remounts every bar. */
  const series = useMemo(() => valueSeries(rows), [rows])
  const note = seriesNote(series)

  if (series.recorded === 0) {
    /*
     * Built and empty — SOLID GREY, per the documented three-way rule: dashed
     * means not built, pulsing means arriving, solid means built with nothing
     * in it. The page is server-rendered, so nothing is on its way.
     */
    return (
      <div data-slot="value-ghost">
        <div aria-hidden="true" className={`flex ${height} items-end gap-1`}>
          {[40, 55, 35, 60, 45, 70, 50].map((h, i) => (
            <div key={i} className="flex-1 rounded-t bg-neutral-100" style={{ height: `${h}%` }} />
          ))}
        </div>
        <p className="mt-3 text-xs leading-relaxed text-neutral-500">
          No valuation has been recorded for this account yet, so there is nothing to chart.
        </p>
      </div>
    )
  }

  const hasNegative = series.low < 0
  /* Zero-based, both ways. `low` is only below zero when a day is, and the top
     is the high rather than a rounded number: a bar that touches the ceiling is
     the maximum, which is one less thing to explain. */
  const domain: [number, number] = [Math.min(0, series.low), Math.max(0, series.high)]

  const first = series.points.find((p) => p.value !== null)
  const last = [...series.points].reverse().find((p) => p.value !== null)

  /* One text equivalent for the whole picture — the treatment the balance bar,
     the donut and the allocation bars all take. Ends, extremes and coverage,
     which is everything the shape carries. */
  const label = [
    'Account value by day',
    first && last
      ? `from ${accountMoney.format(first.value!)} on ${dayLabel(first.day)} to ${accountMoney.format(
          last.value!,
        )} on ${dayLabel(last.day)}`
      : null,
    series.low === series.high
      ? null
      : `low ${accountMoney.format(series.low)}, high ${accountMoney.format(series.high)}`,
  ]
    .filter(Boolean)
    .join(', ')

  return (
    <div>
      <div data-slot="value-chart" role="img" aria-label={label} className={`w-full ${height} ${FLUID}`}>
        <BarChart
          width={WIDTH}
          height={HEIGHT}
          data={series.points}
          margin={{ top: 4, right: 0, bottom: 0, left: 0 }}
          barCategoryGap="12%"
        >
          <YAxis hide domain={domain} />
          {/* Dates, not indices, and only the three `valueSeries` chose — a
              month of labels under a 400px chart is a grey smear, and
              Recharts' own skipping picks whichever happen to fit rather than
              the ones a reader checks. */}
          <XAxis
            dataKey="day"
            ticks={series.ticks}
            tickFormatter={dayLabel}
            axisLine={false}
            tickLine={false}
            interval={0}
            tick={{ fontSize: 11, fill: '#737373' }}
          />
          {hasNegative ? (
            /* Drawn only when something is actually below it. A rule at the
               foot of an all-positive chart is a line with no meaning — the
               same call `allocation-bars` makes about its zero rule. */
            <ReferenceLine y={0} stroke="#737373" strokeWidth={1} />
          ) : null}
          <Bar dataKey="value" radius={[2, 2, 0, 0]} isAnimationActive={false}>
            {series.points.map((p) => (
              <Cell
                key={p.day}
                data-day={p.day}
                data-side={p.value !== null && p.value < 0 ? 'negative' : 'positive'}
                fill={p.value !== null && p.value < 0 ? BELOW : INK}
              />
            ))}
          </Bar>
        </BarChart>
      </div>

      {note ? (
        <p data-slot="series-note" className="mt-2 text-xs text-neutral-500">
          {note}
        </p>
      ) : null}
    </div>
  )
}
