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

export type PillTone = 'brand' | 'success' | 'warning' | 'neutral'

const PILL_TONES: Record<PillTone, string> = {
  // Brand marks something as *ours* — an identity or a label, not a state.
  brand: 'bg-brand-100 text-brand-700 ring-brand-200 font-semibold',
  // Green marks a state that is live, on or granted.
  success: 'bg-emerald-50 text-emerald-700 ring-emerald-200 font-semibold',
  // Amber marks a state that is paused or needs attention — not wrong, not live.
  warning: 'bg-amber-50 text-amber-800 ring-amber-200 font-semibold',
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

const accountMoney = new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD' })

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
  if (value == null) return null

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
    <span className="inline-flex items-center gap-1" title={detail}>
      <span className="tabular-nums">{accountMoney.format(Number(value))}</span>
      {up || down ? (
        <>
          <svg
            viewBox="0 0 8 8"
            aria-hidden="true"
            className={`size-2 ${up ? 'text-emerald-600' : 'text-red-600'}`}
          >
            <path
              d={up ? 'M4 0.5 L8 7.5 L0 7.5 Z' : 'M4 7.5 L0 0.5 L8 0.5 Z'}
              fill="currentColor"
            />
          </svg>
          {/* The colour carries the meaning, so it needs a text equivalent. */}
          <span className="sr-only">{up ? 'increasing' : 'decreasing'}</span>
        </>
      ) : null}
    </span>
  )
}
