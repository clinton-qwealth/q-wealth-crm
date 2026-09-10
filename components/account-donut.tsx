'use client'

import { useState } from 'react'
import { Cell, Pie, PieChart } from 'recharts'
import { accountMix, sharePct, type MixAccount } from '@/lib/account-mix'
import { accountMoney, SECTION_HEADING, SHEET } from './ui'

/**
 * How a group's investment value is split across its accounts.
 *
 * **A trial, asked for on 10 September**, in the right half of the Accounts
 * tab — the space the two-column split reserved. The rows on the left answer
 * "what is each account worth"; this answers "which account is most of the
 * money", which a column of figures makes you compute in your head.
 *
 * ## Recharts, and why it is not Chart.js
 *
 * Asked for after weighing both. The deciding difference is what they draw
 * onto: **Recharts renders SVG, Chart.js renders to `<canvas>`.** In this
 * repository that is not a stylistic choice —
 *
 * * jsdom implements no canvas at all (`getContext('2d')` returns null and
 *   warns), so a canvas chart is **invisible to every test**. A donut that
 *   fails silently — arcs that draw but sum to the wrong thing — is exactly
 *   the shape of defect only a test catches.
 * * A canvas has no DOM nodes, so there is no per-segment element to hover, to
 *   name, or to give a `<title>`. Accessibility becomes one opaque rectangle.
 *
 * SVG keeps all of it. The cost of the library is real and recorded: it is the
 * site's **second** single-feature dependency after TipTap, it pulls 35
 * packages, and it forces this component to be a Client Component — the donut
 * now ships to the browser and hydrates, where the hand-rolled version was
 * rendered on the server. That was accepted for animation and hover, which the
 * library gives for free and which are the reason it is here. It also honours
 * `prefers-reduced-motion` on its own account, which is one less thing here.
 *
 * ## What it refuses to do
 *
 * **It cannot show an account with no recorded value, and it says so.** Nothing
 * writes a valuation after an account's opening one, so at the time of writing
 * two of the five real accounts have never had one. A donut of "the group's
 * accounts" that silently dropped them would be the same defect the wealth
 * summary was designed around: a figure that looks complete, gets repeated in a
 * client conversation, and is wrong.
 *
 * **The centre holds the account count, not the total.** The total was
 * deliberately taken off this tab on 10 September, and Total investments is
 * already in the page header.
 *
 * **The legend shows shares, not amounts.** Every amount is already in the row
 * immediately to the left; the share is what this view adds.
 *
 * The arithmetic behind all of that lives in `lib/account-mix.ts`, pure and
 * tested without a renderer — because Recharts owns the arc geometry now, so it
 * is no longer inspectable in the DOM the way `stroke-dasharray` was.
 */
export type DonutAccount = MixAccount

/**
 * The palette, as tokens — violets, blues and pinks, in the order segments are
 * drawn. Categorical rather than a single-hue ramp; the reasoning and the one
 * hard rule (no colour that already means something on this page) are in
 * `globals.css` beside the values.
 */
const RAMP = [
  'var(--mix-1)',
  'var(--mix-2)',
  'var(--mix-3)',
  'var(--mix-4)',
  'var(--mix-5)',
  'var(--mix-6)',
] as const

/**
 * The chart's LOGICAL size — a viewBox, not a rendered width.
 *
 * Recharts' inner `<svg>` carries `viewBox` plus `width:100%;height:100%`
 * (verified), so it scales to whatever box it is given. Only the
 * `.recharts-wrapper` div it sits in is fixed at these pixels, and the class
 * below overrides that to fill its container — which is how the ring gets to be
 * fluid without `ResponsiveContainer`, whose parent-measuring renders **nothing**
 * in jsdom and would blind every test in this file.
 *
 * 240 rather than 128: asked for larger on 10 September, and the reserved column
 * went from 45% to 35% of a wider centre in the same session, so it now has
 * roughly 174px of content width at 1440 and ~101px at 1024. Fluid covers both;
 * the cap stops it becoming a dinner plate if the column ever widens.
 */
const SIZE = 240

/**
 * Forces Recharts' wrapper to fill its container.
 *
 * The wrapper gets an inline `width: 240px` from the props, and an inline style
 * is only beaten by `!important` — which is exactly what Tailwind's `!` prefix
 * emits. Verified as a CSS specificity question rather than in jsdom, where no
 * stylesheet is loaded.
 */
const FLUID = '[&_.recharts-wrapper]:!h-full [&_.recharts-wrapper]:!w-full'

/**
 * The ring's band, as fractions of half the viewBox.
 *
 * Named because the **ghost ring** below has to match the real one exactly, and
 * two sets of literals would drift the moment either is nudged. The PieChart
 * below sets `margin` to zero explicitly for the same reason: Recharts' default
 * margin is 5, which makes its percentage radii resolve against 115 rather than
 * 120 and leaves the ghost's arithmetic quietly 4% out. Measured both ways.
 */
const INNER_RADIUS = 0.6
const OUTER_RADIUS = 0.94

export function AccountDonut({ accounts }: { accounts: DonutAccount[] }) {
  const { slices, total, missing, counted } = accountMix(accounts)

  /**
   * Which segment the pointer is on, shared by the ring and the legend so
   * hovering either highlights both. `null` is "nothing hovered", which is not
   * the same as index 0 — hence a nullable number rather than a -1 sentinel.
   */
  const [active, setActive] = useState<number | null>(null)

  if (!slices.length) {
    return (
      <Frame>
        <div className="flex flex-col items-center gap-3 px-3.5 py-4">
          <GhostRing />
          <p className="text-xs leading-relaxed text-neutral-500">
            {accounts.length === 0
              ? 'Once this group holds investment accounts, their mix by value shows here.'
              : `No value has been recorded against ${
                  accounts.length === 1 ? 'this account' : 'any of these accounts'
                } yet, so there is no mix to show.`}
          </p>
        </div>
      </Frame>
    )
  }

  return (
    <Frame>
      <div className="flex flex-col items-center gap-3 px-3.5 py-4">
        <div
          role="img"
          aria-label={ariaLabel(slices.map((s) => `${s.label} ${sharePct(s.share)}`), total)}
          className={`relative aspect-square w-full max-w-[220px] ${FLUID}`}
        >
          {/* Zero margin, stated rather than inherited: Recharts defaults to 5,
              and the ghost ring's radii are computed from SIZE. */}
          <PieChart width={SIZE} height={SIZE} margin={{ top: 0, right: 0, bottom: 0, left: 0 }}>
            <Pie
              data={slices}
              dataKey="value"
              nameKey="label"
              cx="50%"
              cy="50%"
              /* Percentages, not pixels, so the ring's proportions hold at
                 every column width rather than the band getting fatter as the
                 chart shrinks. 60/94 leaves the rounded ends room to sit inside
                 the viewBox instead of being clipped by it. */
              innerRadius={`${INNER_RADIUS * 100}%`}
              outerRadius={`${OUTER_RADIUS * 100}%`}
              /*
               * The gap between segments, asked for on 10 September. Recharts'
               * own, so it scales with each arc rather than being subtracted
               * from it — which is what used to threaten to eat a sliver whole.
               *
               * Written first as `slices.length > 1 ? 3 : 0`, to spare a lone
               * segment a notch in what should be a closed ring. A mutation
               * showed that conditional was **dead**: for a single sector
               * Recharts emits a byte-identical path whether the padding is 0
               * or 3, because a full annulus has no neighbour to be separated
               * from. Removed rather than kept, on the same reasoning as the
               * zero-total guard in `account-mix.ts` — a branch that cannot
               * change anything reads as a live rule.
               */
              paddingAngle={3}
              /* Rounded ends, also asked for. A number is in viewBox units, so
                 it scales with SIZE like everything else here. */
              cornerRadius={7}
              stroke="none"
              /* Starts at twelve o'clock and fills clockwise, so the largest
                 share is where a reader looks first. */
              startAngle={90}
              endAngle={-270}
              /*
               * `"auto"`, NOT `true`, and the difference is the whole point.
               *
               * Recharts consults `prefers-reduced-motion` only for `"auto"` —
               * `JavascriptAnimate` resolves `isActiveProp === 'auto' ? !isSsr
               * && !prefersReducedMotion : isActiveProp`, so a bare
               * `isAnimationActive` (which is `true`) animates for a reader who
               * asked not to be animated at. This was written as `true` first
               * and caught by a test.
               *
               * `"auto"` is also Pie's own default, so this is stating the
               * default rather than changing it — deliberately, because the
               * value carries a decision that a missing prop would hide. With
               * it, the library reads the query SSR-safely and subscribes to
               * changes, which is more than a hand-rolled read here did.
               */
              isAnimationActive="auto"
              animationDuration={650}
              onMouseEnter={(_, index: number) => setActive(index)}
              onMouseLeave={() => setActive(null)}
            >
              {slices.map((s, i) => (
                <Cell
                  key={s.key}
                  fill={RAMP[i] ?? RAMP[RAMP.length - 1]}
                  /* Dim the rest rather than move the hovered one: a segment
                     that pops outward changes the ring's silhouette, and the
                     thing being compared here is angle, not position. */
                  fillOpacity={active === null || active === i ? 1 : 0.4}
                  /* `Cell` merges a className onto the sector — verified — so
                     the fade is CSS and `motion-reduce:` reaches it, the same
                     idiom the loading skeleton and the modals use. That is why
                     no JavaScript here reads the preference at all. */
                  className="transition-[fill-opacity] duration-150 motion-reduce:transition-none"
                  /* Hoverable, and named for anything reading the tree. */
                  data-slot="segment"
                  data-label={s.label}
                />
              ))}
            </Pie>
          </PieChart>

          {/* The count, centred over the ring. Absolutely positioned rather
              than an SVG <text>: Recharts owns the svg's contents, and a label
              inside it would be re-created on every animation frame. */}
          <span
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center leading-none"
          >
            <span className="text-2xl font-semibold text-neutral-900">{counted}</span>
            <span className="mt-0.5 text-[11px] text-neutral-500">
              {counted === 1 ? 'account' : 'accounts'}
            </span>
          </span>
        </div>

        <ul className="flex w-full flex-col gap-0.5">
          {slices.map((s, i) => (
            <li key={s.key}>
              {/* The legend is the other half of the hover: pointing at a row
                  highlights its segment, and vice versa. A div rather than a
                  button — there is nothing to activate, only to point at. */}
              <div
                data-slot="legend-row"
                data-active={active === i ? 'true' : 'false'}
                onMouseEnter={() => setActive(i)}
                onMouseLeave={() => setActive(null)}
                className={`flex items-center gap-2 rounded px-1 py-1 text-xs transition-colors ${
                  active === i ? 'bg-neutral-100' : ''
                }`}
              >
                <span
                  aria-hidden="true"
                  className="size-2.5 shrink-0 rounded-sm"
                  style={{ background: RAMP[i] ?? RAMP[RAMP.length - 1] }}
                />
                <span className="min-w-0 flex-1 truncate text-neutral-700">{s.label}</span>
                <span className="shrink-0 font-medium tabular-nums text-neutral-900">
                  {sharePct(s.share)}
                </span>
              </div>
            </li>
          ))}
        </ul>

        {missing > 0 ? (
          /* The same rule the removed footer total carried: a chart that leaves
             rows out says how many, every time. */
          <p className="w-full text-[11px] leading-snug text-neutral-400">
            {missing === 1
              ? '1 account with no recorded value is not shown.'
              : `${missing} accounts with no recorded value are not shown.`}
          </p>
        ) : null}
      </div>
    </Frame>
  )
}

/**
 * The donut's silhouette in light grey, for when there is nothing to draw.
 *
 * Asked for on 10 September — "similar to a shadow or placeholder" — so the
 * column shows the shape of the thing that belongs there instead of a sentence
 * floating in white space.
 *
 * ## It is a THIRD state, and must not be mistaken for either of the others
 *
 * This app already has two grey stand-ins, and both mean something specific:
 *
 * | Mark | Means | Where |
 * | --- | --- | --- |
 * | **Dashed** border | planned, **not built** | `Placeholder`, `ReservedColumn`, the Tools tab's inactive tiles |
 * | **Pulsing** grey bars | **arriving**, wait a moment | `PageSkeleton` behind every `loading.tsx` |
 * | Solid flat grey (this) | **built, and empty** | here |
 *
 * So it is deliberately **not dashed** — the chart exists and works — and
 * deliberately **does not pulse.** A pulse says content is on its way, and
 * nothing is on its way: there is no valuation to load. Animating this would be
 * the same lie as a skeleton that never resolves, which is exactly why
 * `PageSkeleton` carries no `aria-busy`.
 *
 * ## A solid ring, not ghost segments
 *
 * A segmented ghost was the more decorative option and was rejected: gaps imply
 * a number of accounts, and the number here is unknown — or worse, known to be
 * zero. The unbroken band is the object's outline and claims nothing about what
 * will fill it.
 *
 * Decorative, so `aria-hidden`: the sentence beneath carries the meaning, and
 * `neutral-200` on white is about 1.2:1, far under any text floor. That is the
 * same argument the loading skeleton's bars make.
 */
function GhostRing() {
  const half = SIZE / 2
  return (
    <div aria-hidden="true" className="aspect-square w-full max-w-[220px]">
      <svg viewBox={`0 0 ${SIZE} ${SIZE}`} className="h-full w-full">
        {/* Stroked circle rather than two arcs: the band is a stroke width, so
            it is derived from the same two constants the real ring uses and
            cannot drift from it. */}
        <circle
          cx={half}
          cy={half}
          r={((INNER_RADIUS + OUTER_RADIUS) / 2) * half}
          fill="none"
          strokeWidth={(OUTER_RADIUS - INNER_RADIUS) * half}
          className="stroke-neutral-200"
          data-slot="ghost-ring"
        />
      </svg>
    </div>
  )
}

/**
 * The sheet, so the chart reads as one more object in the ledger — and the
 * blank box above it that lines the sheet up with the records beside it.
 *
 * **The "Mix by value" heading was removed on 10 September**, at which point the
 * chart's sheet rose to where the records list's HEADING sits and the two
 * stopped being level. So the heading's box is still rendered, `invisible` and
 * `aria-hidden`: `visibility: hidden` keeps a box in the layout where `hidden`
 * would remove it, and rendering the shared `SECTION_HEADING` token rather than
 * a measured `h-4 mb-2.5` means the two can never drift when that token's size
 * or margin changes.
 *
 * A `div`, not an `h3`: an invisible heading would still sit in the document
 * outline, which is a claim about structure this no longer makes.
 */
function Frame({ children }: { children: React.ReactNode }) {
  return (
    <div data-slot="mix-chart">
      <div aria-hidden="true" className={`${SECTION_HEADING} invisible`}>
        &nbsp;
      </div>
      <div className={SHEET}>{children}</div>
    </div>
  )
}

/**
 * The chart's text equivalent. Colour carries the mapping on screen, so the
 * whole ring needs saying in words — a hover tooltip is not a substitute.
 */
function ariaLabel(parts: string[], total: number) {
  return `Investment mix by value, ${accountMoney.format(total)} in total: ${parts.join(', ')}`
}
