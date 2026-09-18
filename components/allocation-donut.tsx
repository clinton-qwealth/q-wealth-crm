'use client'

import { memo, useMemo } from 'react'
import { Cell, Pie, PieChart } from 'recharts'
import {
  allocation,
  FAMILY_INK,
  weightText,
  type AllocationInput,
  type AllocationRow,
  type AssetClass,
  type AssetFamily,
} from '@/lib/allocation'

/**
 * The account's asset allocation as a ring — the investment ring's sibling.
 *
 * ## Why this exists beside `allocation-bars` rather than instead of it
 *
 * Asked for on 17 September, and the reason a bar list was built first still
 * holds: **a pie cannot draw a negative slice**, and a live HUB24 account
 * carries −2.28% in one class. So the two are not alternatives. The ring draws
 * the positive classes for shape at a glance, and the bars beneath it draw every
 * class including the negative one, with its sign and its own side of a zero
 * rule. Nothing is lost, and the reader is never asked to take the ring's word
 * for the whole picture.
 *
 * ## The same object as the group page's ring, since 18 September
 *
 * Asked to follow the group page's chart styling, so this takes the investment
 * ring's geometry unchanged — band, gap, cap roundness, draw-in, start at
 * twelve — and its hover: point at a class and its arc comes forward while the
 * rest recede. The constants are the same numbers for the same reasons, and
 * those reasons are written on `account-donut.tsx` rather than repeated here.
 *
 * What differs is deliberate. **The legend is by FAMILY, not by class.** The
 * class rows sit directly beneath in `allocation-bars`, and a legend repeating
 * them would say it all twice — the objection that took the total off the
 * accounts list. What nothing else on the tab says is what the colours MEAN:
 * that three orange arcs are all shares. So the legend names the four families
 * and sums each, which is the growth-against-defensive reading an adviser
 * actually wants and which the class rows make you add up in your head.
 *
 * **Its centre is empty**, where the investment ring counts accounts. A count
 * of asset classes answers no question anybody has; the hole is a hole.
 *
 * ## The hover is keyed by class, and carried by the panel
 *
 * The ring draws only positive classes and the bars beneath draw all of them,
 * so their indices do not line up — but the class key is the same on both. The
 * Overview panel holds the pointed-at class and passes it to both charts; the
 * stylesheet does the rest, keyed on `data-class`. See `globals.css`.
 *
 * ## What it omits, and where it says so
 *
 * A ring of positive parts is normalised to a full circle by construction, so
 * with a negative class excluded the positives sum to more than one — 102.3% on
 * the real account. The line beneath names any class it left out, and the bars
 * beneath that draw it to scale.
 *
 * ## The empty ring
 *
 * The ghost ring the group page draws, for the same three-way rule: solid grey
 * is "built, and empty"; dashed would say not built and a pulse would promise
 * something is arriving. The sentence beneath it says which kind of nothing
 * this is — no provider at all, a provider that has not reported, or an
 * allocation that is entirely below zero, which a ring cannot represent.
 */

/** The chart's logical size — a viewBox, not rendered pixels. */
const SIZE = 240

/** Forces Recharts' wrapper to fill its container. See `account-donut`. */
const FLUID = '[&_.recharts-wrapper]:!h-full [&_.recharts-wrapper]:!w-full'

/** The box the ring and its ghost share, the investment ring's `RING_BOX`. */
const RING_BOX = 'aspect-square w-full max-w-[10rem]'

/* The investment ring's geometry, number for number. */
const INNER_RADIUS = 0.6
const OUTER_RADIUS = 0.94
const GAP_DEGREES = 4
const BAND = ((OUTER_RADIUS - INNER_RADIUS) * SIZE) / 2
const CAP_ROUNDNESS = 0.15

/** In the order the ramp runs, which is growth first. */
const FAMILIES: AssetFamily[] = ['shares', 'fixed_interest', 'property', 'cash']

const FAMILY_LABEL: Record<AssetFamily, string> = {
  shares: 'Shares',
  fixed_interest: 'Fixed interest',
  property: 'Property',
  cash: 'Cash',
}

export function AllocationDonut({
  rows,
  hasProvider = true,
  onActivate,
}: {
  rows: AllocationInput[] | null | undefined
  /** Decides what the empty state can honestly say. */
  hasProvider?: boolean
  /** Called with the class under the pointer, or null as it leaves. The
   *  pointed-at class itself is carried by the panel, not here — see the
   *  docblock. */
  onActivate?: (key: AssetClass | null) => void
}) {
  /* Memoised for `account-donut`'s recorded reason: Recharts keys its sector
     subtree on an animation id it regenerates whenever the data changes by
     reference, so a fresh array every render remounts every arc. */
  const a = useMemo(() => allocation(rows), [rows])
  const drawn = useMemo(() => a.rows.filter((r) => !r.negative), [a])
  const omitted = useMemo(() => a.rows.filter((r) => r.negative), [a])

  if (drawn.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3">
        <GhostRing />
        <p data-slot="alloc-ring-empty" className="text-center text-xs leading-relaxed text-neutral-500">
          {a.rows.length > 0
            ? /* Something was reported, and all of it subtracts. Saying "not
                 reported" would be false. */
              'Every reported class is below zero, so there is no ring to draw.'
            : hasProvider
              ? 'No allocation has been reported for this account yet.'
              : 'This account is recorded by hand, so no provider reports its allocation.'}
        </p>
      </div>
    )
  }

  /* The legend's lines: each family's positive weight, summed. */
  const families = FAMILIES.map((f) => ({
    family: f,
    label:
      f === 'cash' && drawn.some((r) => r.key === 'other')
        ? /* `other` lives in the cash family. When it is present and positive
             the family line owes the reader the word, or "Cash 12.3%" would be
             a figure the Cash row beneath does not show. */
          'Cash and other'
        : FAMILY_LABEL[f],
    weight: drawn.filter((r) => r.family === f).reduce((s, r) => s + r.weight, 0),
  })).filter((f) => f.weight > 0)

  return (
    <div className="flex flex-col items-center gap-3">
      <Ring drawn={drawn} onActivate={onActivate} />

      <ul data-slot="alloc-legend" className="flex w-full flex-col gap-0.5">
        {families.map((f) => (
          <li
            key={f.family}
            data-family={f.family}
            /* The same row the investment ring's legend draws, minus the
               hover: a family is several classes, and the highlight is per
               class. Pointing at a class row beneath is where the hover lives. */
            className="flex items-center gap-2 rounded px-1 py-1 text-xs"
          >
            <span aria-hidden="true" className="size-2.5 shrink-0 rounded-sm" style={{ background: FAMILY_INK[f.family] }} />
            <span className="min-w-0 flex-1 truncate text-neutral-700">{f.label}</span>
            <span className="shrink-0 font-medium tabular-nums text-neutral-900">{weightText(f.weight)}</span>
          </li>
        ))}
      </ul>

      {omitted.length ? (
        /* The ring's one omission, stated. The bars beneath draw these to
           scale, so this is a signpost rather than the only disclosure — but a
           reader who takes in the ring and stops should not be left with a
           circle that looks like the whole account. */
        <p data-slot="donut-omitted" className="w-full text-xs leading-relaxed text-neutral-500">
          {omitted.map((r) => `${r.label} is ${r.text}`).join(', ')} and{' '}
          {omitted.length === 1 ? 'is' : 'are'} not in the ring.
        </p>
      ) : null}
    </div>
  )
}

/**
 * The ring, memoised for the reason `account-donut`'s `Ring` is: any re-render
 * of the Pie regenerates its animation id, which is a React key, which
 * remounts every arc — and a CSS transition cannot run on a node that was only
 * just inserted. `drawn` is memoised above and `onActivate` is stable, so a
 * hover re-renders the panel around this and not this.
 */
const Ring = memo(function Ring({
  drawn,
  onActivate,
}: {
  drawn: AllocationRow[]
  onActivate?: (key: AssetClass | null) => void
}) {
  const label = `Asset allocation: ${drawn.map((r) => `${r.label} ${r.text}`).join(', ')}`
  return (
    <div data-slot="allocation-ring" role="img" aria-label={label} className={`relative ${RING_BOX} ${FLUID}`}>
      {/* Zero margin stated rather than inherited: Recharts defaults to 5,
          which would make the ghost's radii 4% out. */}
      <PieChart width={SIZE} height={SIZE} margin={{ top: 0, right: 0, bottom: 0, left: 0 }}>
        <Pie
          data={drawn}
          dataKey="weight"
          nameKey="label"
          cx="50%"
          cy="50%"
          innerRadius={`${INNER_RADIUS * 100}%`}
          outerRadius={`${OUTER_RADIUS * 100}%`}
          paddingAngle={GAP_DEGREES}
          cornerRadius={BAND * CAP_ROUNDNESS}
          stroke="none"
          startAngle={90}
          endAngle={-270}
          /* `"auto"`, not `true`: the only value under which Recharts consults
             `prefers-reduced-motion`. Stated rather than left to default so the
             decision is visible. */
          isAnimationActive="auto"
          animationDuration={650}
          animationBegin={0}
          onMouseEnter={(_, index: number) => onActivate?.(drawn[index]?.key ?? null)}
          onMouseLeave={() => onActivate?.(null)}
        >
          {drawn.map((r) => (
            /* Every prop static — see the note on `Ring`. `data-class` is what
               the stylesheet matches against the panel's `data-active`. */
            <Cell key={r.key} data-slot="alloc-segment" data-class={r.key} fill={FAMILY_INK[r.family]} />
          ))}
        </Pie>
      </PieChart>
    </div>
  )
})

/** The ring's silhouette, from the same two radii, so it cannot drift. */
function GhostRing() {
  const half = SIZE / 2
  return (
    <div aria-hidden="true" className={RING_BOX}>
      <svg viewBox={`0 0 ${SIZE} ${SIZE}`} className="h-full w-full">
        <circle
          cx={half}
          cy={half}
          r={((INNER_RADIUS + OUTER_RADIUS) / 2) * half}
          fill="none"
          strokeWidth={(OUTER_RADIUS - INNER_RADIUS) * half}
          className="stroke-neutral-200"
          data-slot="alloc-ghost-ring"
        />
      </svg>
    </div>
  )
}
