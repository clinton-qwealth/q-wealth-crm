'use client'

import { memo, useCallback, useMemo, useState } from 'react'
import { Cell, Pie, PieChart } from 'recharts'
import { accountMix, sharePct, type AccountMix, type MixAccount } from '@/lib/account-mix'
import { accountMoney, SECTION_HEADING, SHEET } from './ui'

/**
 * How a group's investment value is split across its accounts.
 *
 * **A trial, asked for on 10 September**, in the right half of the Accounts
 * tab — the space the two-column split reserved.
 *
 * One arc per account in a single indigo ramp, chosen on sight from six
 * treatments drawn at real size — see `lib/account-mix.ts` for what was
 * weighed, including the by-type version that was built and set aside. The rows
 * on the left answer "what is each account worth"; this answers "which account
 * is most of the money", which a column of figures makes you compute in your
 * head.
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
 * The ramp, darkest first — so the largest share is the heaviest arc and the
 * ring reads in order before the legend is consulted.
 *
 * Four tones, because a single hue on white runs out at four: the fourth is a
 * neutral carrying the grouped tail, since no fourth indigo both clears the
 * 3:1 floor and reads as distinct from the third. Values and full reasoning are
 * in `globals.css`.
 */
const RAMP = ['var(--mix-1)', 'var(--mix-2)', 'var(--mix-3)', 'var(--mix-4)'] as const

const toneFor = (i: number) => RAMP[Math.min(i, RAMP.length - 1)]

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
/**
 * **One tempo for the whole hover**, shared by the arc that pops and the legend
 * row that shades, because pointing at either one moves both and a mismatch
 * between them is visible.
 *
 * 300ms and an ease-out curve, up from Tailwind's unstated 150ms default. The
 * transition was there from the start, and the built stylesheet proves it
 * (`transition-property: fill-opacity,transform`) — but 150ms across a 5%
 * scale is under the threshold where the eye reads a glide rather than a snap,
 * and it was reported as no transition at all. Ease-out puts most of the
 * movement in the first half, so the response still feels immediate while the
 * settle is visible.
 *
 * NOT longer than this: the pointer sweeps down the legend, and a highlight
 * that is still catching up with the row you left reads as lag.
 */
const HOVER_EASE = 'duration-300 ease-out'


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
/**
 * The box both the ring and its ghost sit in.
 *
 * One constant because they were two copies of `max-w-[220px]` and had already
 * been changed independently once. Fluid, so it fills a narrow column and
 * shrinks with it; capped so it does not become a dinner plate.
 *
 * **10rem (160px)**, and the arithmetic is worth writing down because the cap
 * is the only thing that bites: the reserved column carries about **174px** of
 * content at 1440, so a cap above that does nothing and the ring simply fills
 * the column. It began at 220px — i.e. rendering at 174 — was asked to be
 * smaller and went to 9rem/144px, which was a 17% cut and read as too small.
 * 160px is about 8% inside the column, which is what "a little smaller" meant.
 *
 * Below `lg` the cap stops mattering again: the column carries only ~101px of
 * content at 1024, and the ring is fluid, so it shrinks with it.
 */
const RING_BOX = 'aspect-square w-full max-w-[10rem]'

const INNER_RADIUS = 0.6
const OUTER_RADIUS = 0.94

/**
 * The gap between arcs, in degrees — 11°, which is the 3%-of-circumference gap
 * the comparison ring used.
 *
 * Charged once per arc on a closed ring, so four arcs spend 44° of the 360 on
 * gaps. That is visible and deliberate; it is what the chosen treatment looked
 * like.
 */
const GAP_DEGREES = 11

export function AccountDonut({ accounts }: { accounts: DonutAccount[] }) {
  /*
   * `missing` is deliberately not read.
   *
   * The line under the chart — "2 accounts with no recorded value are not
   * shown" — was removed on instruction, 10 September. What that costs is
   * small and worth writing down: the centre count says how many accounts the
   * ring represents, and the list beside it prints "No value recorded" against
   * each account it cannot draw, so an omission is still visible on screen —
   * it is simply no longer summarised here. The wealth summary's own tooltip
   * carries the same caveat for the figures in the page header.
   *
   * `accountMix` still computes and tests it, because a calculator describing
   * its input completely is not the same as a component carrying an unused
   * prop, and this is the first thing to reach for if the count discrepancy
   * ever wants explaining again.
   */
  /*
   * Memoised because its identity, not just its contents, is load-bearing:
   * `slices` is the ring's `data`, and a fresh array on every render is one of
   * the two things that used to remount every arc. See `Ring` below.
   */
  const mix = useMemo(() => accountMix(accounts), [accounts])
  const { slices } = mix

  /**
   * Which segment the pointer is on, shared by the ring and the legend so
   * hovering either highlights both. `null` is "nothing hovered", which is not
   * the same as index 0 — hence a nullable number rather than a -1 sentinel.
   */
  const [active, setActive] = useState<number | null>(null)

  /* Stable, so `Ring`'s memo comparison passes on a hover. */
  const onActivate = useCallback((i: number | null) => setActive(i), [])

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
    <Frame active={active}>
      <div className="flex flex-col items-center gap-3 px-3.5 py-4">
        <Ring mix={mix} onActivate={onActivate} />

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
                /* Colour only, so no `motion-reduce` guard: a shade change is
                   not motion, and a reader who asked for no motion still wants
                   to see which row they are on. */
                className={`flex items-center gap-2 rounded px-1 py-1 text-xs transition-colors ${HOVER_EASE} ${
                  active === i ? 'bg-neutral-100' : ''
                }`}
              >
                <span
                  aria-hidden="true"
                  className="size-2.5 shrink-0 rounded-sm"
                  style={{ background: toneFor(i) }}
                />
                <span className="min-w-0 flex-1 truncate text-neutral-700">{s.label}</span>
                <span className="shrink-0 font-medium tabular-nums text-neutral-900">
                  {sharePct(s.share)}
                </span>
              </div>
            </li>
          ))}
        </ul>

      </div>
    </Frame>
  )
}


/**
 * The ring itself, and the one component in this file that must not re-render.
 *
 * ## Why it is memoised, and why nothing inside depends on the hover
 *
 * Recharts keys its whole sector subtree on an animation id, and that id is
 * regenerated whenever the Pie's resolved props object changes by reference —
 * `useAnimationId` compares with `===`, and `AnimatedItems` passes the id as a
 * React `key`. A new key is a remount, so ANY re-render of the Pie replaces
 * every arc with a fresh DOM node.
 *
 * That is fatal to a CSS transition, which needs the same element to move from
 * one computed value to another: a newly inserted node simply starts at its
 * final value. It is why the hover read as instant even though the stylesheet
 * carried a correct `transition-property: fill-opacity,transform`. Proved by
 * comparing node identity across a hover, which is now a test.
 *
 * So the hover is expressed two removes away from here:
 *
 * | Piece | Where |
 * | --- | --- |
 * | Which arc is pointed at | `data-active` on the frame |
 * | Which arc is which | a static `data-index` on each Cell |
 * | The dim, the pop and the tempo | `globals.css` |
 *
 * The frame re-renders on a hover; this does not, because `mix` is memoised
 * and `onActivate` is a stable callback, so the arcs survive and the browser
 * animates them. Add a prop here that changes with the hover and the remount
 * comes straight back.
 */
const Ring = memo(function Ring({
  mix,
  onActivate,
}: {
  mix: AccountMix
  onActivate: (i: number | null) => void
}) {
  const { slices, total, counted } = mix
  return (
      <div
        role="img"
        aria-label={ariaLabel(
          slices.map((s) => `${s.label} ${sharePct(s.share)}`),
          total,
        )}
        className={`relative ${RING_BOX} ${FLUID}`}
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
             * The gap and the roundness, matched to the comparison page the
             * palette was chosen from — both were asked for as seen there,
             * so both are derived rather than eyeballed.
             *
             * That ring was hand-drawn as a dashed circle with
             * `stroke-linecap="round"`, which puts a semicircular cap on each
             * end: the cap radius is exactly HALF THE BAND. Recharts reaches
             * the same shape through `cornerRadius`, so it is half the band
             * here too — 20.4 in viewBox units — rather than the arbitrary 7
             * it started at. That ring's gap was 3% of the circumference,
             * which is 10.8°, so `paddingAngle` is 11.
             *
             * No conditional for a lone segment: a mutation showed Recharts
             * emits a byte-identical path for a single sector whether the
             * padding is 0 or not, because a full annulus has no neighbour to
             * be separated from.
             */
            paddingAngle={GAP_DEGREES}
            cornerRadius={((OUTER_RADIUS - INNER_RADIUS) * SIZE) / 4}
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
            /* Recharts' own default is a 400ms delay before the draw begins.
               That was invisible while the ring mounted with the page; now
               that it mounts when the Accounts tab is first opened, it is
               400ms of empty column after a click. Start at once. */
            animationBegin={0}
            onMouseEnter={(_, index: number) => onActivate(index)}
            onMouseLeave={() => onActivate(null)}
          >
            {slices.map((s, i) => (
              <Cell
                key={s.key}
                fill={toneFor(i)}
                /*
                 * **Every prop here is static.** Nothing on a `Cell` may depend
                 * on which arc is hovered — see the note on `Ring` above for
                 * what happens if it does.
                 *
                 * `data-index` is what the stylesheet matches on, and it is the
                 * arc's own position, not recharts' `data-recharts-item-index`,
                 * which is internal and would tie the CSS to a library detail.
                 */
                data-index={i}
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
  )
})

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
 * `neutral-200` on white is about 1.2:1 — far under any text floor, which is
 * the same argument the loading skeleton's bars make. It inverted to
 * `white/[0.08]` while the sheet was briefly dark and came back with it.
 */
function GhostRing() {
  const half = SIZE / 2
  return (
    <div aria-hidden="true" className={RING_BOX}>
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
function Frame({ active, children }: { active?: number | null; children: React.ReactNode }) {
  return (
    /*
     * `data-active` is the hover, and it is carried HERE rather than on each
     * arc on purpose — see `Ring`. Absent when nothing is pointed at, because
     * the stylesheet keys the dim off the attribute merely existing, and an
     * empty string would still match.
     */
    <div data-slot="mix-chart" data-active={active == null ? undefined : String(active)}>
      <div aria-hidden="true" className={`${SECTION_HEADING} invisible`}>
        &nbsp;
      </div>
      {/* The site's own sheet. A dark ground was tried on 10 September and
          reverted the same day — the third dark surface this page has rejected.
          `SHEET_SHADOW` stays factored out in `ui.tsx` from that attempt, which
          is no loss: the elevation is now named once instead of being a string
          inside another string. */}
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
