import type { ReactNode } from 'react'

/**
 * Wireframe primitives.
 *
 * Content sits over pale chart artwork, so surfaces are opaque white with a hair
 * border rather than translucent — text legibility wins over showing the texture
 * through the panel. The brand orange appears only on primary actions, focus
 * rings and small state marks; everything structural is neutral.
 */

export function PageHeading({
  eyebrow,
  title,
  description,
  meta,
  actions,
}: {
  eyebrow?: string
  title: string
  description?: string
  /** Status marks sitting under the title. Kept separate from `description`,
   *  which renders a paragraph — pills inside a <p> would be wrong markup. */
  meta?: ReactNode
  actions?: ReactNode
}) {
  return (
    <div className="col-span-full flex flex-wrap items-end justify-between gap-3">
      <div>
        {eyebrow ? (
          <p className="text-[11px] font-semibold uppercase tracking-widest text-brand">
            {eyebrow}
          </p>
        ) : null}
        <h1 className="mt-1 text-xl font-semibold tracking-tight text-neutral-900">
          {title}
        </h1>
        {meta ? <div className="mt-2 flex flex-wrap items-center gap-1.5">{meta}</div> : null}
        {description ? (
          <p className="mt-1 max-w-prose text-sm text-neutral-500">{description}</p>
        ) : null}
      </div>
      {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
    </div>
  )
}

export function Card({
  children,
  className = '',
  title,
  action,
}: {
  children: ReactNode
  className?: string
  title?: string
  action?: ReactNode
}) {
  return (
    <section
      className={`rounded-lg border border-neutral-200 bg-white p-4 shadow-[0_1px_2px_0_rgb(0_0_0/0.04)] ${className}`}
    >
      {title || action ? (
        <div className="mb-3 flex items-center justify-between gap-3">
          {title ? (
            <h2 className="text-xs font-semibold uppercase tracking-wider text-neutral-500">
              {title}
            </h2>
          ) : null}
          {action}
        </div>
      ) : null}
      {children}
    </section>
  )
}

export function StatTile({
  label,
  value,
  hint,
  className = '',
}: {
  label: string
  value: string
  hint?: string
  className?: string
}) {
  return (
    <div
      className={`rounded-lg border border-neutral-200 bg-white p-4 shadow-[0_1px_2px_0_rgb(0_0_0/0.04)] ${className}`}
    >
      <p className="text-xs font-medium text-neutral-500">{label}</p>
      <p className="mt-1.5 text-2xl font-semibold tabular-nums tracking-tight text-neutral-900">
        {value}
      </p>
      {hint ? <p className="mt-1 text-xs text-neutral-400">{hint}</p> : null}
    </div>
  )
}

const BUTTON_BASE =
  'inline-flex items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium outline-none transition-colors disabled:opacity-50 focus-visible:ring-2'

export function Button({
  children,
  variant = 'primary',
  type = 'button',
  className = '',
}: {
  children: ReactNode
  variant?: 'primary' | 'secondary' | 'quiet'
  type?: 'button' | 'submit'
  className?: string
}) {
  const styles = {
    primary: 'bg-brand text-white hover:bg-brand-600 focus-visible:ring-brand/40',
    secondary:
      'border border-neutral-300 bg-white text-neutral-800 hover:bg-neutral-50 focus-visible:ring-brand/30',
    quiet: 'text-neutral-600 hover:bg-neutral-100 hover:text-neutral-900 focus-visible:ring-brand/30',
  }[variant]

  return (
    <button type={type} className={`${BUTTON_BASE} ${styles} ${className}`}>
      {children}
    </button>
  )
}

export type PillTone = 'brand' | 'success' | 'warning' | 'danger' | 'neutral'

const PILL_TONES: Record<PillTone, string> = {
  // Brand marks something as *ours* — an identity or a label, not a state.
  brand: 'bg-brand-100 text-brand-700 ring-brand-200 font-semibold',
  // Green marks a state that is live, on or granted.
  success: 'bg-emerald-50 text-emerald-700 ring-emerald-200 font-semibold',
  // Amber marks a state that is paused or needs attention — not wrong, not live.
  warning: 'bg-amber-50 text-amber-800 ring-amber-200 font-semibold',
  // Red is the mirror of success: a value moving the wrong way. Same weights, so
  // an up mark and a down mark read as one pair rather than two designs.
  danger: 'bg-red-50 text-red-700 ring-red-200 font-semibold',
  neutral: 'bg-neutral-100 text-neutral-500 ring-neutral-200 font-medium',
}

/**
 * Small state mark.
 *
 * `on` carries the meaning: a positive, live state is green, anything else is
 * neutral. Keeping that rule inside the component rather than at each call site
 * means a new status cannot quietly pick the wrong colour, and the two colours
 * stay distinguishable — green says "this is on", brand says "this is ours".
 *
 * Pass `tone` explicitly only to override, e.g. `tone="brand"` for a label like
 * an access-profile name, which is an identity rather than a state.
 */
export function Pill({
  on = false,
  tone,
  children,
}: {
  on?: boolean
  tone?: PillTone
  children: ReactNode
}) {
  const resolved = tone ?? (on ? 'success' : 'neutral')
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] ring-1 ${PILL_TONES[resolved]}`}
    >
      {children}
    </span>
  )
}

/* Exported so a section total is formatted by the same rule as the rows it
   sums — a total that renders cents differently from its own list reads as a
   different kind of number. */
export const accountMoney = new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD' })

/**
 * An account's latest value with a direction mark: green up, red down.
 *
 * The comparison is against the average of the valuations in the 30 days before
 * the latest one, not against the previous day. Values arrive daily, and one
 * day's movement is noise — the average says where the account has been running.
 *
 * No mark is drawn when there is no baseline (a new account has nothing to
 * compare against) or when the value sits exactly on the average. An arrow in
 * those cases would assert a direction the data does not show.
 */
export function AccountValue({
  value,
  changeAmount,
  changePct,
  baselineValue,
  baselinePoints,
}: {
  value: string | number | null
  changeAmount?: string | number | null
  changePct?: string | number | null
  baselineValue?: string | number | null
  baselinePoints?: number | null
}) {
  if (value == null) {
    /*
     * Says so, rather than rendering nothing.
     *
     * A blank right-hand side reads as a rendering fault, not as an absence of
     * data — and now that the section total states how many accounts it leaves
     * out, the rows it means should account for themselves. Two of the five
     * real accounts are in this state, because nothing writes a valuation after
     * the opening one.
     *
     * Deliberately quiet — smaller, lighter and not tabular — because this is
     * the absence of a figure and must not be mistaken for one at a glance. The
     * row's own styling makes values large and dark, so all three are overridden
     * here.
     */
    return (
      <span className="inline-flex items-center gap-1.5">
        <span className="text-xs font-normal text-neutral-400">No value recorded</span>
        {/* The same spacer the valued rows carry, so this sits on the column's
            right edge instead of 18px adrift of every amount above it. */}
        <span className="block size-[18px] shrink-0" aria-hidden="true" />
      </span>
    )
  }

  const change = changeAmount == null ? null : Number(changeAmount)
  const up = change != null && change > 0
  const down = change != null && change < 0

  // Kept on the title rather than on the row: the arrow answers "which way" at a
  // glance, and the figures behind it are there when someone wants them.
  const detail =
    change === null || baselineValue == null
      ? undefined
      : [
          `${up ? 'Up' : down ? 'Down' : 'Level at'} ${accountMoney.format(Math.abs(change))}`,
          changePct == null ? null : `(${Math.abs(Number(changePct))}%)`,
          `against the 30-day average of ${accountMoney.format(Number(baselineValue))}`,
          baselinePoints ? `from ${baselinePoints} valuations` : null,
        ]
          .filter(Boolean)
          .join(' ')

  return (
    <span className="inline-flex items-center gap-1.5" title={detail}>
      <span className="tabular-nums">{accountMoney.format(Number(value))}</span>
      {up || down ? (
        /* Circular rather than a full pill: the contents are a single glyph, so
           the horizontal padding a pill carries for text would leave it adrift.
           Tones come straight from PILL_TONES so this stays in step with the
           status pills instead of drifting into its own greens and reds. */
        <span
          className={`inline-flex size-[18px] shrink-0 items-center justify-center rounded-full ring-1 ${
            up ? PILL_TONES.success : PILL_TONES.danger
          }`}
        >
          <svg viewBox="0 0 8 8" aria-hidden="true" className="size-[7px]">
            <path
              d={up ? 'M4 0.5 L8 7.5 L0 7.5 Z' : 'M4 7.5 L0 0.5 L8 0.5 Z'}
              fill="currentColor"
            />
          </svg>
          {/* The colour carries the meaning, so it needs a text equivalent. */}
          <span className="sr-only">{up ? 'increasing' : 'decreasing'}</span>
        </span>
      ) : (
        /* Holds the badge's width open so every amount in the column shares one
           right edge, whether or not a direction can be shown. An empty circle
           would read as a state of its own; empty space reads as nothing. */
        <span className="block size-[18px] shrink-0" aria-hidden="true" />
      )}
    </span>
  )
}

const coverMoney = new Intl.NumberFormat('en-AU', {
  style: 'currency',
  currency: 'AUD',
  maximumFractionDigits: 0,
})

/**
 * A policy's cover, as one readable figure.
 *
 * Lump sums and income streams are never added together: $750,000 of life cover
 * plus $6,500 a month is not $756,500. A policy holding both shows both, joined
 * rather than summed — which is why the database keeps the two totals in
 * separate columns rather than leaving it to each caller to remember.
 *
 * Returns null when there is nothing to show, so the caller renders no figure
 * rather than a misleading zero.
 */
export function coverSummary(
  lumpSum: string | number | null | undefined,
  monthly: string | number | null | undefined,
) {
  const parts: string[] = []
  if (lumpSum != null && Number(lumpSum) > 0) parts.push(coverMoney.format(Number(lumpSum)))
  if (monthly != null && Number(monthly) > 0) {
    parts.push(`${coverMoney.format(Number(monthly))}/mo`)
  }
  return parts.length ? parts.join(' + ') : null
}
