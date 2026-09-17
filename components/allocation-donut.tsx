'use client'

import { useMemo } from 'react'
import { Cell, Pie, PieChart } from 'recharts'
import { allocation, type AllocationInput, type AssetFamily } from '@/lib/allocation'

/**
 * The account's asset allocation as a ring, above the bars that carry the facts.
 *
 * ## Why this exists beside `allocation-bars` rather than instead of it
 *
 * Asked for on 17 September, and the reason a bar list was built first still
 * holds: **a pie cannot draw a negative slice**, and a live HUB24 account
 * carries −2.28% in one class. So the two are not alternatives. The ring draws
 * the positive classes for shape at a glance — growth against defensive, which
 * is the question an adviser actually asks — and the bars beneath draw every
 * class including the negative one, with its sign and its own side of a zero
 * rule. Nothing is lost, and the reader is never asked to take the ring's word
 * for the whole picture.
 *
 * **It carries no legend.** The bars directly beneath already name every class
 * and print its percentage, and a legend here would say all of it a second
 * time — the same objection that took the total row off the accounts list and
 * the money out of the investment ring's centre.
 *
 * **Its centre is empty**, where the investment mix ring counts accounts. A
 * count of asset classes answers no question anybody has; the hole is a hole.
 *
 * ## What it omits, and where it says so
 *
 * A ring of positive parts is normalised to a full circle by construction, so
 * with a negative class excluded the positives sum to more than one — 102.3% on
 * the real account. The ring is therefore a picture of proportion among what is
 * held, not of the reported total. The line beneath names any class it left
 * out, and the bars beneath that draw it to scale.
 *
 * Renders NOTHING when there is no positive weight to draw: no allocation at
 * all is the bars' own ghost to show, and an all-negative allocation is a
 * degenerate case a ring would misrepresent rather than illuminate.
 */

/** The chart's logical size — a viewBox, not rendered pixels. See `FLUID`. */
const SIZE = 240

/** Forces Recharts' wrapper to fill its container. The `account-donut` technique:
 *  `ResponsiveContainer` measures its parent and renders nothing in jsdom. */
const FLUID = '[&_.recharts-wrapper]:!h-full [&_.recharts-wrapper]:!w-full'

const BOX = 'aspect-square w-full max-w-[9rem]'

/**
 * The same four family inks the bars use, from the same tokens.
 *
 * Not a second palette: the ring and the bars are one picture split in two, and
 * a class drawn indigo above and grey below would read as two different things.
 * `mix-palette.test.ts` measures these against both grounds.
 */
const FAMILY_INK: Record<AssetFamily, string> = {
  shares: 'var(--mix-1)',
  fixed_interest: 'var(--mix-2)',
  property: 'var(--mix-3)',
  cash: 'var(--mix-4)',
}

/* Matching the bars' band: thick enough to read a family's colour, open enough
   to stay a ring rather than a pie. The same fractions the investment mix ring
   settled on, so the two charts are visibly the same object. */
const INNER = 0.62
const OUTER = 0.94

export function AllocationDonut({ rows }: { rows: AllocationInput[] | null | undefined }) {
  /* Memoised for `account-donut`'s recorded reason: Recharts keys its sector
     subtree on an animation id it regenerates whenever the data changes by
     reference, so a fresh array every render remounts every arc. */
  const a = useMemo(() => allocation(rows), [rows])
  const drawn = useMemo(() => a.rows.filter((r) => !r.negative), [a])
  const omitted = useMemo(() => a.rows.filter((r) => r.negative), [a])

  if (drawn.length === 0) return null

  const label = `Asset allocation: ${drawn.map((r) => `${r.label} ${r.text}`).join(', ')}`

  return (
    <div className="flex flex-col items-center">
      <div data-slot="allocation-ring" role="img" aria-label={label} className={`relative ${BOX} ${FLUID}`}>
        {/* Zero margin stated rather than inherited: Recharts defaults to 5. */}
        <PieChart width={SIZE} height={SIZE} margin={{ top: 0, right: 0, bottom: 0, left: 0 }}>
          <Pie
            data={drawn}
            dataKey="weight"
            nameKey="label"
            cx="50%"
            cy="50%"
            innerRadius={(SIZE / 2) * INNER}
            outerRadius={(SIZE / 2) * OUTER}
            paddingAngle={2}
            startAngle={90}
            endAngle={-270}
            isAnimationActive={false}
            stroke="none"
          >
            {drawn.map((r) => (
              <Cell key={r.key} data-class={r.key} fill={FAMILY_INK[r.family]} />
            ))}
          </Pie>
        </PieChart>
      </div>

      {omitted.length ? (
        /* The ring's one omission, stated. The bars beneath draw these to
           scale, so this is a signpost rather than the only disclosure — but a
           reader who takes in the ring and stops should not be left with a
           circle that looks like the whole account. */
        <p data-slot="donut-omitted" className="mt-2 text-center text-xs text-neutral-500">
          {omitted.map((r) => `${r.label} is ${r.text}`).join(', ')} and{' '}
          {omitted.length === 1 ? 'is' : 'are'} not in the ring.
        </p>
      ) : null}
    </div>
  )
}
