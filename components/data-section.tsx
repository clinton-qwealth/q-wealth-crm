import type { ReactNode } from 'react'
import { PlusIcon } from './icons'

/**
 * The container pattern for a tab panel that holds records.
 *
 * The add action sits in the same conceptual place in both states, but its
 * prominence inverts:
 *
 *   empty      — the empty state *is* the call to action. Centred, says what
 *                belongs here, primary button. There is nothing to compete with.
 *   populated  — the action retreats to a quiet toolbar at the top right, so it
 *                stays in a fixed spot while the records own the space.
 *
 * Deliberately not a button underneath the list: that moves as the list grows
 * and eventually falls below the fold, so the action gets harder to find exactly
 * as the section gets busier.
 *
 * Only one add affordance is ever shown, so there is never a question of which
 * one to press.
 */
export function DataSection({
  addLabel,
  addHref = '#',
  title,
  countLabel,
  action,
  emptyAction,
  empty,
  children,
}: {
  /** e.g. "Add account" — used on both the toolbar link and the empty button. */
  addLabel: string
  addHref?: string
  /** Section heading, e.g. "Investment Accounts". Shares the toolbar row with the
   *  add action rather than sitting on a line of its own, so the header costs one
   *  row instead of two and the action stays level with what it adds to. */
  title?: string
  /** Optional, e.g. "3 accounts". Gives the toolbar a left side; without it the
   *  add link sits alone on the right rather than drifting left. */
  countLabel?: string
  /** Replaces the default toolbar link, e.g. with a dialog trigger. */
  action?: ReactNode
  /** Replaces the default empty-state button. Usually the same control as
   *  `action`, styled prominently rather than quietly. */
  emptyAction?: ReactNode
  /** Required, not optional: any section can be emptied back to zero, so every
   *  one needs a defined empty state rather than collapsing to nothing. */
  empty: { title: string; description: string }
  /** The records. When absent — including when a caller passes a falsy list —
   *  the empty state is shown instead. */
  children?: ReactNode
}) {
  if (!children) {
    return (
      <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-neutral-200 bg-neutral-50/60 px-6 py-10 text-center">
        <span className="flex h-9 w-9 items-center justify-center rounded-full bg-white text-neutral-400 ring-1 ring-neutral-200">
          <PlusIcon className="h-4 w-4" />
        </span>
        <p className="mt-3 text-sm font-medium text-neutral-700">{empty.title}</p>
        <p className="mt-1 max-w-xs text-xs leading-relaxed text-neutral-500">
          {empty.description}
        </p>
        <div className="mt-4">
          {emptyAction ?? (
            <a
              href={addHref}
              className="inline-flex items-center gap-1.5 rounded-md bg-brand px-3 py-1.5 text-sm font-medium text-white outline-none transition-colors hover:bg-brand-600 focus-visible:ring-2 focus-visible:ring-brand/40"
            >
              <PlusIcon className="h-4 w-4" />
              {addLabel}
            </a>
          )}
        </div>
      </div>
    )
  }

  return (
    <div>
      <div
        className={`mb-2.5 flex items-center gap-3 ${
          title || countLabel ? 'justify-between' : 'justify-end'
        }`}
      >
        {title ? (
          /* Same treatment as the Members heading in the left column, so the two
             read as the same kind of label. */
          <h3 className="truncate text-xs font-semibold uppercase tracking-wider text-neutral-500">
            {title}
          </h3>
        ) : null}
        {countLabel ? <p className="text-xs text-neutral-500">{countLabel}</p> : null}
        {action ?? (
          <a
            href={addHref}
            className="inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-1 text-xs font-medium text-brand outline-none transition-colors hover:bg-brand-50 hover:text-brand-700 focus-visible:ring-2 focus-visible:ring-brand/30"
          >
            <PlusIcon className="h-3.5 w-3.5" />
            {addLabel}
          </a>
        )}
      </div>
      {children}
    </div>
  )
}

/** A record row inside a DataSection. White on the panel, like the member rows. */
export function DataRow({
  primary,
  secondary,
  meta,
  badge,
}: {
  primary: string
  secondary?: string
  meta?: ReactNode
  /** Status mark shown beside the name. Left empty for the ordinary case, so a
   *  row only carries a badge when something is worth noticing. */
  badge?: ReactNode
}) {
  return (
    <li className="flex items-baseline justify-between gap-3 rounded-md border border-neutral-200/70 bg-white px-3 py-2">
      <span className="min-w-0">
        <span className="flex items-center gap-2">
          <span className="truncate text-sm text-neutral-800">{primary}</span>
          {badge}
        </span>
        {secondary ? (
          <span className="block truncate text-xs text-neutral-400">{secondary}</span>
        ) : null}
      </span>
      {meta ? (
        <span className="shrink-0 text-xs tabular-nums text-neutral-600">{meta}</span>
      ) : null}
    </li>
  )
}
