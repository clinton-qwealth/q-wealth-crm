'use client'

import { useEffect, useRef, type ReactNode } from 'react'
import { CloseIcon } from './icons'
import { PANEL_GUTTER } from './ui'

/**
 * The right-hand record drawer, in one place at last.
 *
 * ## Why this exists
 *
 * `field-box.tsx` already wrote the rule this component is obeying: a thing
 * "began as an editable section in the member record panel, was rebuilt by hand
 * for the workflow detail page's field box, and **a third copy would have been
 * the point at which the copies started to drift** — and the half that drifted
 * would be the half nobody was testing."
 *
 * That is exactly here, one component over. The member panel and the task panel
 * each hand-roll a native `<dialog class="qw-drawer">`, a backdrop-click
 * identity test, a `close` listener, an `aria-labelledby`, and a close button
 * whose 16px cross is inlined twice. The account drawer would have been the
 * third, and the policy drawer the fourth.
 *
 * `modal-centring.test.ts` and `inherited-alignment.test.ts` are not arguments
 * against extracting this — they are the receipt for it. Both are source-
 * scanning class tests, which is what you are reduced to when a shape lives in
 * several files and jsdom cannot see CSS. With one file, the class question
 * becomes an ordinary unit test and the scan becomes a CENSUS: `qw-drawer`
 * appears in exactly one file, which is a strictly stronger guard than checking
 * that N copies still agree.
 *
 * ## Why a native <dialog>, still
 *
 * The rationale is in `globals.css` and worth not re-deciding: the top layer,
 * an inert background, focus genuinely held inside, and Escape handled by the
 * browser. Reproducing that by hand means writing a focus trap, and a focus
 * trap with a bug is worse than none.
 */

/**
 * The two widths, written out rather than assembled.
 *
 * Tailwind scans source text, so a class built at runtime — `w-[${n}rem]` — is
 * never generated and silently does nothing. A closed set for the same reason
 * `Tabs` keeps one for its gutter.
 *
 * `record` is the member panel's: one record read at length, with two-column
 * field lists inside it. `panel` is the task panel's, a step narrower because
 * its content is a stream rather than a form.
 */
const WIDTH = {
  record: 'w-full sm:w-[34rem] lg:w-[45%] lg:min-w-[34rem] lg:max-w-[46rem]',
  panel: 'w-full sm:w-lg lg:w-[40%] lg:min-w-lg lg:max-w-2xl',
} as const

export function Drawer({
  open,
  onClose,
  labelledBy,
  width = 'record',
  children,
}: {
  /**
   * Declarative, not a ref handle.
   *
   * The owner already holds the selected record's id, and that id is the truth
   * about whether a drawer should be open. Exposing `show()`/`hide()` instead
   * would make the element's own state a second answer to the same question,
   * which is how a drawer ends up open with nothing in it.
   */
  open: boolean
  /**
   * Called for EVERY close — the button, Escape, a backdrop click.
   *
   * The last two bypass React entirely: the browser closes the element without
   * telling anyone, so an owner that only cleared its id in its own button
   * handler would keep the id after an Escape, and the next open would flash
   * the previous record before rendering the new one.
   */
  onClose: () => void
  /** The `id` of the heading inside `children`. */
  labelledBy: string
  width?: keyof typeof WIDTH
  children: ReactNode
}) {
  const ref = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    // `showModal()` on an already-open dialog throws InvalidStateError, and
    // `close()` on a closed one fires a spurious `close` event. The element's
    // own state is what decides whether the call is made — without this, an
    // unrelated re-render of the owner reopens and resets the drawer. jsdom's
    // stub raises neither, so only a real browser would have shown it.
    if (open && !el.open) el.showModal()
    if (!open && el.open) el.close()
  }, [open])

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const bubble = () => onClose()
    el.addEventListener('close', bubble)
    return () => el.removeEventListener('close', bubble)
  }, [onClose])

  return (
    <dialog
      ref={ref}
      aria-labelledby={labelledBy}
      onClick={(e) => {
        // A backdrop click lands on the dialog itself; a click inside lands on
        // the panel. Comparing the target is what tells them apart — a
        // `contains()` check would close the drawer on every click inside it.
        if (e.target === ref.current) ref.current?.close()
      }}
      className={`qw-drawer border-l border-neutral-200 bg-white p-0 shadow-2xl shadow-neutral-900/20 ${WIDTH[width]}`}
    >
      {/* A CLOSED DRAWER HOLDS NOTHING. A closed `<dialog>` keeps its contents
          in the document, so this line is what stops a list of twenty accounts
          putting twenty full records on the page — the defect the task panel
          was built to avoid and the member panel still has, one dialog per row.

          It also makes the body mount fresh on every open, which is what lets
          the initial-focus effect below be an ordinary mount effect rather than
          something watching `open`. */}
      {open ? <div className="flex h-full flex-col">{children}</div> : null}
    </dialog>
  )
}

/**
 * The drawer's header: an eyebrow saying where the record is, the record's own
 * name, whatever pills describe its state, and the close button.
 *
 * The eyebrow's job is the one the task panel's comment explains: the drawer
 * covers the page behind it, so the one context worth repeating is the context
 * you cannot see while reading.
 */
export function DrawerHeader({
  id,
  eyebrow,
  title,
  pills,
  actions,
  onClose,
}: {
  /** Must match the `labelledBy` given to `Drawer`. */
  id: string
  eyebrow?: string
  title: string
  pills?: ReactNode
  /** Anything that belongs beside the close button, e.g. a Mark done. */
  actions?: ReactNode
  onClose: () => void
}) {
  const heading = useRef<HTMLHeadingElement>(null)

  /*
   * Initial focus, which neither hand-rolled drawer manages.
   *
   * Today the first tabbable thing in an open drawer is the close button, so a
   * screen reader announces "Close panel" and the reader has no idea what
   * opened. Moving focus to the heading announces the record instead, and Tab
   * from there reaches the close button next.
   *
   * A plain mount effect, because `Drawer` renders nothing while closed — the
   * header mounts on every open and unmounts on every close.
   */
  useEffect(() => {
    heading.current?.focus()
  }, [])

  return (
    <header className={`flex shrink-0 items-start justify-between gap-3 ${PANEL_GUTTER} pb-5 pt-8`}>
      <div className="min-w-0">
        {eyebrow ? (
          <p
            className="truncate text-[11px] font-semibold uppercase tracking-widest text-brand"
            title={eyebrow}
          >
            {eyebrow}
          </p>
        ) : null}
        <h2
          id={id}
          ref={heading}
          /* Focusable by the app, not by Tab — the reading order below it is
             unchanged. No focus ring: the house ring is `focus-visible`, and a
             heading focused programmatically is not a focus-visible event. */
          tabIndex={-1}
          className="mt-1 text-2xl font-semibold tracking-tight text-neutral-900 outline-none"
        >
          {title}
        </h2>
        {pills ? <div className="mt-2 flex flex-wrap items-center gap-1.5">{pills}</div> : null}
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        {actions}
        <button
          type="button"
          onClick={onClose}
          aria-label="Close panel"
          className="-mr-1 shrink-0 rounded-md p-1.5 text-neutral-400 outline-none transition-colors hover:bg-neutral-100 hover:text-neutral-700 focus-visible:ring-2 focus-visible:ring-brand/30"
        >
          <CloseIcon className="h-4 w-4" />
        </button>
      </div>
    </header>
  )
}

/** The scrolling body beneath a `DrawerHeader`. */
export function DrawerBody({ children }: { children: ReactNode }) {
  return (
    <div className={`flex-1 space-y-5 overflow-y-auto ${PANEL_GUTTER} pb-8`}>{children}</div>
  )
}
