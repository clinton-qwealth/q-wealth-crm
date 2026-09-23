import Link from 'next/link'
import type { ReactNode } from 'react'
import { PlusIcon } from './icons'
import { QUIET_ACTION, SECTION_HEADING, SECTION_TOOLBAR, SHEET } from './ui'

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
      /* NOT `text-center` on this container. `text-align` is inherited, and
         `emptyAction` is caller-supplied — every caller passes a modal, whose
         <dialog> lives here in the DOM however the top layer paints it, so a
         centred container centred every label in the form. The paragraphs that
         actually want centring say so themselves. Found 16 Sep 2026. */
      <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-neutral-200 bg-neutral-50/60 px-6 py-10">
        <span className="flex h-9 w-9 items-center justify-center rounded-full bg-white text-neutral-400 ring-1 ring-neutral-200">
          <PlusIcon className="h-4 w-4" />
        </span>
        <p className="mt-3 text-center text-sm font-medium text-neutral-700">{empty.title}</p>
        <p className="mt-1 max-w-xs text-center text-xs leading-relaxed text-neutral-500">
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
      {/* `SECTION_TOOLBAR` is shared with the mix chart's invisible spacer, so
          the two columns of a TAB_SPLIT start their sheets on the same line.
          The row's height is set by `QUIET_ACTION`, not by the heading. */}
      <div
        data-slot="section-toolbar"
        className={`${SECTION_TOOLBAR} ${
          title || countLabel ? 'justify-between' : 'justify-end'
        }`}
      >
        {title ? (
          /* Same treatment as the Members heading in the left column, so the two
             read as the same kind of label. */
          /* `SECTION_HEADING` carries the `mb-2.5` this row does not need, so
             it is stripped here — the row's own gap positions the sheet. The
             mix chart beside this list renders the token whole and invisible to
             line its sheet up with this one. */
          <h3 className={SECTION_HEADING.replace('mb-2.5 ', '')}>{title}</h3>
        ) : null}
        {countLabel ? <p className="text-xs text-neutral-500">{countLabel}</p> : null}
        {action ?? (
          <a
            href={addHref}
            className={QUIET_ACTION}
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
          /* `data-slot` so "this section has no total" is assertable without
             matching text: the label is caller-supplied, so a text query would
             pass for the wrong reason if a caller ever labelled it anything but
             "Total". The investment accounts section stopped passing a total on
             10 September and its test leans on this. */
          <div
            data-slot="total"
            className="flex items-baseline justify-between gap-3 border-t border-neutral-200 bg-neutral-50 px-3.5 py-2.5"
          >
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
/* The ring is INSET. `SHEET` is `overflow-hidden`, so an outer ring on the
   first or last row is shaved by the sheet's own clip — the same reason the
   member rows carry one. Named once because a link and a button rendering the
   same row must be indistinguishable to look at. */
const TRIGGER_SURFACE =
  '-m-1 flex min-w-0 flex-1 basis-40 items-center gap-3 rounded-md p-1 text-left outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand/30'

export function DataRow({
  leading,
  select,
  primary,
  indicator,
  secondary,
  meta,
  trigger,
}: {
  /** A tile or glyph before the text, e.g. AccountTypeTile. Optional: a list
   *  with nothing meaningful to draw is better off without a decorative one. */
  leading?: ReactNode
  /**
   * A control that picks this row out of the list, e.g. a checkbox for a bulk
   * action. Rendered BEFORE and OUTSIDE the trigger button, which is the whole
   * point: `leading` sits inside it, and a checkbox nested in a button is
   * invalid markup whose click the button would swallow.
   *
   * Added 20 Sep 2026 for choosing several users at once on the Users tab.
   */
  select?: ReactNode
  primary: string
  /**
   * A small, FIXED-SIZE state mark sitting immediately after the name.
   *
   * Deliberately not a general badge slot. A `badge` prop lived here until
   * 11 September and was removed because a `whitespace-nowrap` pill of
   * unbounded width always beat the truncating name beside it — see the note
   * below. This is safe where that was not, and only because of its
   * constraints: the mark is `shrink-0` and the name keeps `min-w-0 truncate`,
   * so the name gives way and the mark cannot grow to take the row.
   *
   * Pass a light or a dot. Anything that renders text belongs in `meta`.
   */
  indicator?: ReactNode
  secondary?: string
  meta?: ReactNode
  /**
   * Makes the row's tile and text one button, for a list with a drawer to open.
   *
   * ONE prop, not two, so the click target and its accessible name cannot be
   * added separately and end up disagreeing. Supplied by the two lists that
   * have a record to show, absent everywhere else — so a row nobody can open
   * neither lights up under the pointer nor announces itself as a control.
   * Not speculative: two callers on the day it lands, none without them, which
   * is the bar the two removed props below set.
   *
   * `label` is the button's accessible NAME, given rather than derived. The
   * noun differs by list, and the row's own text — name, type, owners, value,
   * direction — would make a paragraph of it.
   *
   * `meta` stays OUTSIDE the button. A control inside a control is invalid, and
   * the accounts row already carries `AccountValue` on the right, which is
   * where a valuation picker is the obvious next thing to land.
   */
  /**
   * What opening the row does. A discriminated union rather than two props, so
   * the accessible name and the thing it opens cannot be given separately and
   * disagree.
   *
   * `href` renders a real link, which is what a row leading to its own ROUTE
   * has to be: a button loses middle-click, ⌘-click, the browser's own pending
   * indication and the address bar. `onClick` stays for the rows that open a
   * drawer beside the list, which is most of them.
   */
  trigger?: { label: string; onClick: () => void } | { label: string; href: string }
  /*
   * A `badge` prop sat here until 11 September, holding a status pill to the
   * right of the name. It was removed rather than left unused, the same call
   * made about `metaBelow` below: an option nothing passes, with tests around
   * it, reads as a supported feature.
   *
   * It had to go on its own merits too. The pill was `whitespace-nowrap` and
   * the name is `truncate`, so inside this flexible column the pill always won
   * and the account name was the thing that got cut — plainly wrong once the
   * list moved into the 65% column of a TAB_SPLIT. Status now rides on the
   * LEADING TILE, which is a fixed 36px square and cannot squeeze anything.
   */
}) {
  {/* One span, with nothing to compete for the width — see the note on the
      removed `badge` prop above. */}
  const text = (
    <span className="min-w-0 flex-1 basis-40">
      {/* The name truncates; the mark does not shrink. With the name in its own
          `min-w-0` span, the row gives up name characters under pressure and
          keeps the mark — the opposite of what the removed `badge` did. */}
      <span className="flex min-w-0 items-center gap-1.5">
        <span className="min-w-0 truncate text-sm font-semibold text-neutral-900">{primary}</span>
        {indicator ? <span className="shrink-0">{indicator}</span> : null}
      </span>
      {secondary ? (
        <span className="block truncate text-xs text-neutral-500">{secondary}</span>
      ) : null}
    </span>
  )

  return (
    <li
      /* The tint is on the ROW, not on the button, because the button covers
         only the left of it — a hover that lit the name and left the figure
         beside it dead would read as two rows. Conditioned on `trigger` so a
         row that opens nothing does not pretend otherwise. */
      className={`flex flex-wrap items-center gap-x-3 gap-y-1 px-3.5 py-3${
        trigger ? ' transition-colors hover:bg-neutral-50' : ''
      }`}
    >
      {select ? <span className="shrink-0">{select}</span> : null}
      {trigger && 'href' in trigger ? (
        <Link
          href={trigger.href}
          aria-label={trigger.label}
          className={TRIGGER_SURFACE}
        >
          {leading}
          {text}
        </Link>
      ) : trigger ? (
        <button
          type="button"
          onClick={trigger.onClick}
          aria-label={trigger.label}
          className={TRIGGER_SURFACE}
        >
          {leading}
          {text}
        </button>
      ) : (
        <>
          {leading}
          {text}
        </>
      )}
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
