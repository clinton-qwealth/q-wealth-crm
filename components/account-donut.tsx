'use client'

import { useState } from 'react'
import { Cell, Pie, PieChart } from 'recharts'
import { accountMix, sharePct, type MixAccount } from '@/lib/account-mix'
import { accountMoney, SHEET } from './ui'

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

/** The ramp, as tokens. See the note in `globals.css` for why role-named. */
const RAMP = [
  'var(--mix-1)',
  'var(--mix-2)',
  'var(--mix-3)',
  'var(--mix-4)',
  'var(--mix-5)',
  'var(--mix-6)',
] as const

const SIZE = 128

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
        <p className="px-3.5 py-4 text-xs leading-relaxed text-neutral-500">
          {accounts.length === 0
            ? 'Once this group holds investment accounts, their mix by value shows here.'
            : `No value has been recorded against ${
                accounts.length === 1 ? 'this account' : 'any of these accounts'
              } yet, so there is no mix to show.`}
        </p>
      </Frame>
    )
  }

  return (
    <Frame>
      <div className="flex flex-col items-center gap-3 px-3.5 py-4">
        <div
          role="img"
          aria-label={ariaLabel(slices.map((s) => `${s.label} ${sharePct(s.share)}`), total)}
          className="relative"
          style={{ width: SIZE, height: SIZE }}
        >
          {/* A fixed size rather than ResponsiveContainer: the ring is a
              128px square in a fluid column, and ResponsiveContainer measures
              its parent — which in jsdom has no layout, so it would render at
              zero and every test below would assert against nothing. */}
          <PieChart width={SIZE} height={SIZE}>
            <Pie
              data={slices}
              dataKey="value"
              nameKey="label"
              cx="50%"
              cy="50%"
              innerRadius={40}
              outerRadius={62}
              /* The separator between segments. Recharts' own, so it scales
                 with each arc instead of being subtracted from it — which is
                 what used to threaten to eat a sliver whole. */
              paddingAngle={slices.length > 1 ? 2 : 0}
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
            <span className="text-[15px] font-semibold text-neutral-900">{counted}</span>
            <span className="mt-0.5 text-[10px] text-neutral-500">
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

/** The heading and sheet, so the chart reads as one more object in the ledger. */
function Frame({ children }: { children: React.ReactNode }) {
  return (
    <div>
      {/* Same treatment as the section headings beside it. */}
      <h3 className="mb-2.5 truncate text-xs font-semibold uppercase tracking-wider text-neutral-500">
        Mix by value
      </h3>
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
