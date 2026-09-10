import type { ReactNode } from 'react'
import { PlusIcon } from './icons'
import { SHEET } from './ui'

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
  total,
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
  /**
   * The records — DataRow elements, NOT a <ul>. The section renders the list
   * itself, because the list is now one white sheet with hairline dividers and
   * the total lives inside it as a footer band. A caller cannot get the sheet
   * wrong if it never builds one.
   *
   * Absent, falsy, or an EMPTY ARRAY shows the empty state. The array case
   * matters: `rows.map(...)` on no rows is `[]`, which is truthy, and the old
   * `if (!children)` would have rendered an empty sheet with nothing in it.
   */
  children?: ReactNode
  /**
   * Optional footer figure, e.g. the sum of the accounts listed.
   *
   * The caller computes it, deliberately: NOT every section can be summed. An
   * insurance section must never total its cover, because a lump sum and a
   * monthly benefit are different units and joining them is the rule the whole
   * coverSummary() helper exists to enforce. Leaving the arithmetic outside
   * this component keeps that decision where the units are known.
   *
   * `note` is for saying what the figure leaves out. A total that quietly
   * excludes rows is worse than no total at all.
   */
  total?: { label: string; value: string; note?: string }
}) {
  const hasRows = Array.isArray(children) ? children.length > 0 : Boolean(children)
  if (!hasRows) {
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
      {/* The sheet.

          One white surface holding every record, rows divided by hairlines.
          Chosen 6 Sep 2026 over per-row boxes after three rounds of shading
          the ground behind them failed to help: a list of bordered boxes inside
          a bordered card reads as one texture however the greys are set,
          because every box competes to be the object. One sheet IS the object;
          the rows are its contents. The shadow is the sheet lifting off the
          tabs' grey ground — the only elevation move in the list, and the
          reason the rows need none of their own. */}
      <div className={SHEET}>
        <ul className="divide-y divide-neutral-200/80">{children}</ul>
        {total ? (
          /* Inside the sheet, on a tinted band: the total belongs to the list it
             sums, and a band closes the sheet the way a rule under a column of
             figures does. Larger and bolder than any row — it is the number
             most likely to be read aloud. */
          <div className="flex items-baseline justify-between gap-3 border-t border-neutral-200 bg-neutral-50 px-3.5 py-2.5">
            <span className="min-w-0">
              <span className="text-xs font-semibold uppercase tracking-wider text-neutral-500">
                {total.label}
              </span>
              {total.note ? (
                <span className="block text-xs leading-snug text-neutral-400">{total.note}</span>
              ) : null}
            </span>
            <span className="shrink-0 text-[17px] font-bold tabular-nums text-neutral-900">
              {total.value}
            </span>
          </div>
        ) : null}
      </div>
    </div>
  )
}

/**
 * A record row inside a DataSection's sheet.
 *
 * Carries no border, background, shadow or radius of its own — the sheet has
 * them. Until 6 Sep 2026 each row was its own white box on a full-strength
 * border and a 1px shadow, added because rows were measuring 1.00:1 against the
 * card behind them. That was treating a hierarchy problem as a contrast
 * problem: three rounds of re-tinting the ground never moved it, because what
 * made the list flat was that title, figure and label all sat at the same
 * weight with nothing to anchor the eye.
 *
 * So the weight moved instead. The name is semibold, the figure is 15px
 * semibold — the thing a holdings list is scanned for is now the heaviest thing
 * on the row — and `leading` takes a tile that gives each record a spot of
 * colour and a place to land. Still wraps: in the narrow file-notes column the
 * meta drops below the text rather than truncating the byline.
 */
export function DataRow({
  leading,
  primary,
  secondary,
  meta,
  badge,
}: {
  /** A tile or glyph before the text, e.g. AccountTypeTile. Optional: a list
   *  with nothing meaningful to draw is better off without a decorative one. */
  leading?: ReactNode
  primary: string
  secondary?: string
  meta?: ReactNode
  /** Status mark shown beside the name. Left empty for the ordinary case, so a
   *  row only carries a badge when something is worth noticing. */
  badge?: ReactNode
}) {
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3.5 py-3">
      {leading}
      <span className="min-w-0 flex-1 basis-40">
        <span className="flex items-center gap-2">
          <span className="truncate text-sm font-semibold text-neutral-900">{primary}</span>
          {badge}
        </span>
        {secondary ? (
          <span className="block truncate text-xs text-neutral-500">{secondary}</span>
        ) : null}
      </span>
      {meta ? (
        /* Opposite the text, at the right edge, where a column of figures lines
           up and can be read downward.

           A `metaBelow` placement existed here for a few hours on 10 September,
           added so the file notes list could put a workflow name on its own
           line. It was removed the same day: the note row became a disclosure
           of its own and stopped using DataRow at all, which left the prop with
           no caller. An unused option with tests around it reads as a supported
           feature. */
        <span className="ml-auto shrink-0 text-[15px] font-semibold tabular-nums text-neutral-900">
          {meta}
        </span>
      ) : null}
    </li>
  )
}
