'use client'

import { useMemo } from 'react'
import { Bar, BarChart, Cell, ReferenceLine, Tooltip, XAxis, YAxis } from 'recharts'
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
 * ## The colours, since 18 September
 *
 * The history is drawn in the palette's darkest step and **the latest day in
 * brand orange** — one emphasised endpoint, which is the figure the trend arrow
 * above it describes and the last thing the reader's eye should land on. Thirty
 * orange bars would have shouted and said nothing; one says "here, now".
 *
 * A day below zero takes a plain neutral and no step of the ramp, for the
 * reason the allocation bars give: a difference that survives greyscale,
 * carried alongside the side of the zero rule rather than by colour alone. If
 * the latest day is itself below zero, the sign wins — its position already
 * says it is the latest.
 *
 * ## The hover, since 18 September
 *
 * Asked for. Pointing at a day does three things, all of which the ring beside
 * this chart already taught the reader: the other bars recede and the pointed-at
 * one comes forward, a soft column marks the day's full height so a bar two
 * pixels tall is as easy to land on as the tallest, and a small sheet prints the
 * date and the figure. On a day with no valuation the sheet says so — which is
 * the one place the chart can state that a gap is a real gap and not a
 * rendering fault.
 *
 * Recharts' `Tooltip` drives the active index and marks the hovered bar with
 * its own class; the recede and the come-forward are two rules in
 * `globals.css` keyed on that class, for the reason the ring's are there. The
 * bars NOT under the pointer keep their nodes, so the recede glides; the one
 * under it is re-rendered as the library's active layer, a new node, so it
 * arrives at full opacity at once — which is the right way round. A test
 * pins both halves of that.
 *
 * ## Why not ResponsiveContainer
 *
 * It measures its parent and renders **nothing** in jsdom, which would blind
 * every test here. The same technique as `account-donut`: a fixed logical size
 * that Recharts turns into a viewBox, and a class that forces its wrapper to
 * fill the container. Verified there, reused rather than rediscovered.
 *
 * The box is `aspect-[2/1]` rather than a fixed height, and the viewBox is the
 * same 2:1. Recharts' SVG scales with `preserveAspectRatio` at its default
 * "meet", so a wide viewBox in a fixed-height box letterboxes the moment the
 * column is narrower than the chart is wide — which is exactly the half-width
 * column this now sits in. Matching the two ratios means the chart fills
 * whatever width it is given and takes exactly the height it needs.
 */

/** The chart's logical size — a viewBox, not rendered pixels. 2:1, matching `BOX`. */
const WIDTH = 320
const HEIGHT = 160

/** Forces Recharts' wrapper to fill its container. Copied from `account-donut`. */
const FLUID = '[&_.recharts-wrapper]:!h-full [&_.recharts-wrapper]:!w-full'

/** The same ratio as the viewBox, so nothing letterboxes. */
const BOX = 'aspect-[2/1] w-full'

/**
 * The history: the ramp's darkest step. Not `--mix-4`, which the allocation
 * beside this chart gives to cash — a reader would tie the two together.
 */
const INK = 'var(--mix-5)'

/** The latest day: brand orange, the ramp's first step. One bar, on purpose. */
const LATEST = 'var(--mix-1)'

/**
 * A day below zero. neutral-500 — a plain grey with no place on the warm ramp,
 * so it cannot be mistaken for any step of it, and 4.6:1 on the white sheet.
 * `mix-palette.test.ts` reads this value out of this file and measures it.
 */
const BELOW = '#737373'

/** Axis labels: neutral-500, the same tone every caption on the page takes. */
const TICK = '#737373'

/** The hovered day's column: neutral-100, the same fill the class bars' track
 *  and the legend's hover row take, so "this one" is one tone across the tab. */
const COLUMN = '#f5f5f5'

/**
 * What the hover prints. Recharts hands the payload of the pointed-at category;
 * a day with no valuation has a null value, and this says so rather than
 * printing nothing — the gap is a fact about the feed, not a fault.
 */
function DayTip({ active, payload, label }: { active?: boolean; payload?: { value?: number | null }[]; label?: string }) {
  if (!active || !label) return null
  const value = payload?.[0]?.value
  return (
    <div
      data-slot="value-tip"
      className="rounded-md border border-neutral-200 bg-white px-2.5 py-1.5 text-xs shadow-[0_1px_2px_rgb(0_0_0/0.05),0_6px_16px_-10px_rgb(0_0_0/0.15)]"
    >
      <div className="text-neutral-500">{dayLabel(label)}</div>
      <div className="font-semibold tabular-nums text-neutral-900">
        {value == null ? <span className="font-normal text-neutral-400">No valuation recorded</span> : accountMoney.format(value)}
      </div>
    </div>
  )
}

export function ValueBars({ rows }: { rows: ValuePoint[] | null | undefined }) {
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
        <div aria-hidden="true" className={`flex ${BOX} items-end gap-1`}>
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
  /* Always the final point: `valueSeries` bounds the calendar to end on the
     last recorded day. Found by value rather than by position so the rule is
     stated here, not merely relied upon. */
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
      <div data-slot="value-chart" role="img" aria-label={label} className={`${BOX} ${FLUID}`}>
        <BarChart
          width={WIDTH}
          height={HEIGHT}
          data={series.points}
          margin={{ top: 4, right: 0, bottom: 0, left: 0 }}
          barCategoryGap="12%"
        >
          <YAxis hide domain={domain} />
          {/* Dates, not indices, and only the three `valueSeries` chose — a
              month of labels under a 250px chart is a grey smear, and
              Recharts' own skipping picks whichever happen to fit rather than
              the ones a reader checks. 12 in a 320-wide viewBox renders at
              about 10px in the drawer's half column, which is the floor. */}
          <XAxis
            dataKey="day"
            ticks={series.ticks}
            tickFormatter={dayLabel}
            axisLine={false}
            tickLine={false}
            interval={0}
            tick={{ fontSize: 12, fill: TICK }}
          />
          {hasNegative ? (
            /* Drawn only when something is actually below it. A rule at the
               foot of an all-positive chart is a line with no meaning — the
               same call `allocation-bars` makes about its zero rule. */
            <ReferenceLine y={0} stroke={TICK} strokeWidth={1} />
          ) : null}
          {/* The column and the sheet. `shared` is stated: with one series it
              changes nothing, and a second series added later would otherwise
              flip the tooltip to per-bar hit-testing, which on 7px bars is a
              tooltip you cannot reach. No animation on the sheet — it follows
              the pointer, and a glide there reads as lag. */}
          <Tooltip
            cursor={{ fill: COLUMN }}
            content={<DayTip />}
            isAnimationActive={false}
            shared
            /* Recharts' default wrapper is `pointer-events: none` already;
               the offset keeps the sheet clear of the pointer. */
            offset={12}
          />
          <Bar
            dataKey="value"
            radius={[2, 2, 0, 0]}
            isAnimationActive={false}
            /* `true` renders the hovered bar again on top with Recharts' own
               `recharts-active-bar` class and the SAME fill — the recede on the
               others and the come-forward on this one are the stylesheet's. */
            activeBar
          >
            {series.points.map((p) => {
              const negative = p.value !== null && p.value < 0
              const latest = last !== undefined && p.day === last.day
              return (
                <Cell
                  key={p.day}
                  data-day={p.day}
                  data-side={negative ? 'negative' : 'positive'}
                  data-latest={latest ? 'true' : undefined}
                  fill={negative ? BELOW : latest ? LATEST : INK}
                />
              )
            })}
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
