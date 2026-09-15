'use client'

import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { useRouter } from 'next/navigation'
import { BuildingIcon, GroupIcon, SearchIcon, WorkflowIcon } from './icons'
import { EMPTY_RESULTS, MIN_QUERY, type SearchHit, type SearchResults } from '@/lib/search'

/**
 * Navbar search: a quiet control that opens a modal.
 *
 * ## Why the field in the bar is a BUTTON, not an input
 *
 * It used to be a real input that searched nothing — it widened on focus, had a
 * working ⌘K, and had no query, no results and no backend behind it. Rebuilt on
 * 14 September against a modal, and the thing in the bar became a button
 * because it is one: pressing it opens a dialog, which is what a button does.
 * An input that moves focus somewhere else the moment you type into it is a
 * trap for anybody using a screen reader, and it makes two places to hold the
 * same query.
 *
 * The ⌘K badge is a real shortcut, and now opens the modal rather than focusing
 * a field. The modifier label depends on the platform, which the server cannot
 * know — which is what `useSyncExternalStore`'s server snapshot is for: server
 * and first client render both use '⌘', then React re-reads on the client. Same
 * result as correcting state in an effect, without the extra render pass, and
 * still no hydration mismatch.
 */
const subscribeToNothing = () => () => {}
const readModifier = () => (/Mac|iPhone|iPad|iPod/.test(navigator.userAgent) ? '⌘' : 'Ctrl ')
const readModifierOnServer = () => '⌘'

/**
 * A result's mark: what kind of thing this is, at a glance, before the words.
 *
 * The same shape rule the record rows follow — **people are circles, things
 * are squares** — at 28px rather than the rows' 32–36px, because a results
 * list is dense and the mark is an anchor for the eye rather than the row's
 * subject. All neutral: in this app colour on a tile encodes a KIND of holding,
 * and a search list has no holdings in it. The glyph carries the difference,
 * and the section heading above has already said it in words.
 */
function ResultMark({ kind, title }: { kind: keyof SearchResults; title: string }) {
  if (kind === 'people') {
    const initials = title
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0]!.toUpperCase())
      .join('')
    return (
      <span
        aria-hidden="true"
        className="flex size-7 shrink-0 items-center justify-center rounded-full bg-neutral-100 text-[10px] font-semibold tracking-wide text-neutral-600 ring-1 ring-neutral-200/70"
      >
        {initials || '·'}
      </span>
    )
  }
  const Glyph = kind === 'workflows' ? WorkflowIcon : kind === 'providers' ? BuildingIcon : GroupIcon
  return (
    <span
      aria-hidden="true"
      className="flex size-7 shrink-0 items-center justify-center rounded-md bg-neutral-100 text-neutral-500 ring-1 ring-neutral-200/70"
    >
      <Glyph className="size-4" />
    </span>
  )
}

/**
 * The title with the matched run set heavier, so the eye lands on WHY this row
 * is here. A search for "test" returning "Testsmith Household" and "Testing
 * Entity Pty Ltd" reads as a list of names until the shared four letters are
 * marked; then it reads as an answer.
 *
 * `<mark>` for its meaning rather than its default yellow, which is overridden:
 * a highlighter stripe is the browser's idea of found text, not this app's.
 * Only the first occurrence, because a second mark in one short title is
 * noise rather than information.
 */
function Highlight({ text, query }: { text: string; query: string }) {
  const q = query.trim()
  if (!q) return <>{text}</>
  const at = text.toLowerCase().indexOf(q.toLowerCase())
  if (at < 0) return <>{text}</>
  return (
    <>
      {text.slice(0, at)}
      <mark className="rounded-sm bg-transparent font-semibold text-neutral-900">
        {text.slice(at, at + q.length)}
      </mark>
      {text.slice(at + q.length)}
    </>
  )
}

/** The sections, in order, with the heading each one wears. */
const SECTIONS: [key: keyof SearchResults, label: string][] = [
  ['households', 'Households'],
  ['entities', 'Entities'],
  ['providers', 'Service providers'],
  ['people', 'People'],
  ['workflows', 'Workflows'],
]

export function SearchCommand() {
  const [open, setOpen] = useState(false)
  const modifier = useSyncExternalStore(subscribeToNothing, readModifier, readModifierOnServer)

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key.toLowerCase() === 'k' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        setOpen(true)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        className="relative flex h-8 w-44 items-center gap-2 rounded-md border border-neutral-200 bg-neutral-50 pl-2.5 pr-2 text-left text-sm text-neutral-400 outline-none transition-colors hover:border-neutral-300 hover:bg-white focus-visible:border-brand-300 focus-visible:bg-white focus-visible:ring-2 focus-visible:ring-brand/15 sm:w-64"
      >
        <SearchIcon />
        <span className="flex-1 truncate">Search or ask</span>
        <kbd
          aria-hidden
          className="pointer-events-none hidden select-none rounded border border-neutral-200 bg-white px-1.5 py-0.5 font-sans text-[10px] font-medium leading-none tracking-wide text-neutral-400 sm:block"
        >
          {modifier}K
        </kbd>
      </button>

      {open ? <SearchDialog onClose={() => setOpen(false)} /> : null}
    </>
  )
}

/**
 * The modal.
 *
 * Mounted only while open, so the field is empty every time it is reached and
 * there is no stale result list behind a closed dialog — the member panel's
 * lesson, which this project has now been caught by four times: a closed
 * `<dialog>` still has its contents in the document.
 */
function SearchDialog({ onClose }: { onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null)
  const router = useRouter()
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResults>(EMPTY_RESULTS)
  const [searching, setSearching] = useState(false)
  const [active, setActive] = useState(0)

  /* Flattened once per render, so the arrow keys walk one list rather than
     knowing about sections, and Enter opens whatever is under the cursor. */
  const hits: SearchHit[] = SECTIONS.flatMap(([key]) => results[key])
  const tooShort = query.trim().length > 0 && query.trim().length < MIN_QUERY

  useEffect(() => {
    ref.current?.showModal()
  }, [])

  /*
   * Debounced, and the previous request is ABANDONED rather than merely
   * ignored. Without the abort, a slow early keystroke can land after a fast
   * later one and overwrite newer results with older — the race that makes a
   * search-as-you-type box flicker between answers.
   */
  useEffect(() => {
    const q = query.trim()
    if (q.length < MIN_QUERY) {
      setResults(EMPTY_RESULTS)
      setSearching(false)
      return
    }

    const controller = new AbortController()
    setSearching(true)
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`, {
          signal: controller.signal,
        })
        const body = await res.json()
        setResults((body.results as SearchResults) ?? EMPTY_RESULTS)
        setActive(0)
      } catch {
        /* An abort is the ordinary case here, not a fault: the next keystroke
           superseded this request. Nothing to show and nothing to say. */
      } finally {
        if (!controller.signal.aborted) setSearching(false)
      }
    }, 150)

    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [query])

  const go = (hit: SearchHit) => {
    if (!hit.href) return
    onClose()
    router.push(hit.href)
  }

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(e) => {
        // Clicking the backdrop lands on the dialog itself.
        if (e.target === ref.current) onClose()
      }}
      aria-label="Search"
      /*
       * `qw-modal`, a horizontal centre, and one width — what every modal here
       * takes, each one load-bearing.
       *
       * **`mx-auto` is what centres it, and leaving the margins off is why this
       * opened against the left edge.** A browser's own stylesheet centres a
       * modal dialog with `margin: auto`, but Tailwind's preflight resets every
       * element's margin to zero, so the dialog falls back to its
       * `inset-inline-start: 0` and sits hard left. Nothing in the component
       * looks wrong; the centring was being removed by a stylesheet that never
       * mentions dialogs.
       *
       * **Vertically it sits high rather than dead centre**, which is the one
       * way it departs from the app's other modals — and deliberately. This is
       * reached by typing, the list under it grows as results arrive, and a
       * box that centres itself would slide down the screen as it filled. A
       * fixed distance from the top keeps the field still while the answers
       * change beneath it. The form dialogs stay centred: they are opened by a
       * deliberate click and their height does not move.
       *
       * `mb-auto` is not decoration either — without it the bottom margin is
       * preflight's zero, and the dialog stretches to the foot of the window
       * instead of taking the height of what is in it.
       *
       * `w-[min(40rem, …)]` rather than `w-full max-w-[40rem]`: one declaration
       * that is already the used width, so there is no state in which the
       * element is full-bleed while a max-width reins it back in.
       *
       * `qw-modal` brings the fade-and-rise the other modals share, including
       * the backdrop — it needs `@starting-style` and `allow-discrete`, which
       * can only be written in the stylesheet.
       */
      className="qw-modal mx-auto mb-auto mt-[10vh] w-[min(40rem,calc(100vw-2rem))] rounded-xl border border-neutral-200 bg-white p-0 shadow-2xl shadow-neutral-900/10"
    >
      <div className="flex items-center gap-2.5 border-b border-neutral-200 px-4">
        <span className="text-neutral-400">
          <SearchIcon />
        </span>
        <input
          autoFocus
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault()
              setActive((i) => (hits.length ? (i + 1) % hits.length : 0))
            }
            if (e.key === 'ArrowUp') {
              e.preventDefault()
              setActive((i) => (hits.length ? (i - 1 + hits.length) % hits.length : 0))
            }
            if (e.key === 'Enter' && hits[active]) {
              e.preventDefault()
              go(hits[active])
            }
          }}
          /*
           * The same words as the control that opened it, and the accessible
           * name matches them exactly. A label that differs from the visible
           * text is a trap for anybody driving this by voice: they say what
           * they can see, and nothing answers to it.
           *
           * What is actually searched is said in the empty state below, which
           * is on screen at precisely the moment somebody needs to know.
           */
          placeholder="Search or ask"
          aria-label="Search or ask"
          className="h-12 flex-1 bg-transparent text-sm text-neutral-900 outline-none placeholder:text-neutral-400"
        />
      </div>

      <div className="max-h-[60vh] overflow-y-auto px-2 py-2">
        {query.trim().length < MIN_QUERY ? (
          <p className="px-2 py-8 text-center text-sm text-neutral-400">
            {tooShort
              ? `Keep typing — ${MIN_QUERY} characters or more.`
              : 'Search groups, people and workflows.'}
          </p>
        ) : hits.length === 0 ? (
          <p className="px-2 py-8 text-center text-sm text-neutral-400">
            {searching ? 'Searching…' : `Nothing found for “${query.trim()}”.`}
          </p>
        ) : (
          SECTIONS.map(([key, label]) => {
            const rows = results[key]
            if (!rows.length) return null
            return (
              <section key={key} data-slot="search-section" data-section={key} className="mb-2">
                {/* The heading carries its count, so a section that is full
                    reads as "5 of more" rather than "these are all". */}
                <h2 className="flex items-baseline justify-between px-2 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wider text-neutral-500">
                  <span>{label}</span>
                  <span className="font-medium tabular-nums text-neutral-400">{rows.length}</span>
                </h2>
                <ul>
                  {rows.map((hit) => {
                    const index = hits.indexOf(hit)
                    const isActive = index === active
                    return (
                      <li key={`${key}-${hit.id}`}>
                        <button
                          type="button"
                          data-slot="search-hit"
                          data-active={isActive ? 'true' : 'false'}
                          onMouseEnter={() => setActive(index)}
                          onClick={() => go(hit)}
                          disabled={!hit.href}
                          /* The active row is the brand tint at the weight the
                             member rows already use for hover, so a keyboard
                             cursor and a mouse hover read as the same thing. A
                             row that cannot be followed stays flat and quiet. */
                          className={`group flex w-full items-center gap-3 rounded-md px-2 py-1.5 text-left outline-none transition-colors disabled:cursor-default ${
                            isActive && hit.href ? 'bg-brand-50/70' : ''
                          }`}
                        >
                          <ResultMark kind={key} title={hit.title} />
                          <span className="min-w-0 flex-1">
                            <span
                              data-slot="search-hit-title"
                              className={`block truncate text-sm ${
                                hit.href ? 'text-neutral-900' : 'text-neutral-500'
                              }`}
                            >
                              <Highlight text={hit.title} query={query} />
                            </span>
                            {hit.detail ? (
                              <span className="block truncate text-xs text-neutral-500">
                                {hit.detail}
                              </span>
                            ) : null}
                          </span>
                          {/* The affordance appears on the row the cursor is on
                              and nowhere else, which is the only way a list of
                              buttons says "this one, on Enter" without a label
                              on every row. */}
                          {isActive && hit.href ? (
                            <kbd
                              aria-hidden="true"
                              className="shrink-0 select-none rounded border border-neutral-200 bg-white px-1.5 py-0.5 font-sans text-[10px] font-medium leading-none text-neutral-500"
                            >
                              ↵
                            </kbd>
                          ) : null}
                          {!hit.href ? (
                            <span className="shrink-0 text-[11px] text-neutral-400">No page yet</span>
                          ) : null}
                        </button>
                      </li>
                    )
                  })}
                </ul>
              </section>
            )
          })
        )}

        {/* Drawn as one more SECTION rather than a note under the list, so the
            eye that has learned the headings above meets it the same way. The
            row inside is dashed, which in this app means "planned, not built":
            the Tools and Actions tab's inactive buttons, the reserved column, the Read more
            on a file note. Leaving it out entirely would make the list look
            complete and the section look decided. */}
        <section data-slot="search-knowledgebase" className="mb-1 mt-1">
          <h2 className="px-2 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wider text-neutral-500">
            Knowledgebase
          </h2>
          <div className="mx-2 flex items-center gap-3 rounded-md border border-dashed border-neutral-200 bg-neutral-50/60 px-2 py-1.5">
            <span
              aria-hidden="true"
              className="flex size-7 shrink-0 items-center justify-center rounded-md border border-dashed border-neutral-300 text-neutral-300"
            >
              <SearchIcon />
            </span>
            <span className="text-xs text-neutral-500">Not built yet, so nothing here is searched.</span>
          </div>
        </section>
      </div>

      {/* What the keys do, said once at the foot. The `kbd` badge is this
          app's own idiom for a shortcut — the bar's ⌘K, the field's esc — so
          the three here read as the same family rather than as help text. */}
      <div className="flex items-center gap-4 border-t border-neutral-200 px-4 py-2 text-[11px] text-neutral-400">
        <span className="flex items-center gap-1">
          <kbd className="rounded border border-neutral-200 bg-neutral-50 px-1 py-0.5 font-sans font-medium leading-none">↑</kbd>
          <kbd className="rounded border border-neutral-200 bg-neutral-50 px-1 py-0.5 font-sans font-medium leading-none">↓</kbd>
          <span className="ml-1">to move</span>
        </span>
        <span className="flex items-center gap-1">
          <kbd className="rounded border border-neutral-200 bg-neutral-50 px-1 py-0.5 font-sans font-medium leading-none">↵</kbd>
          <span className="ml-1">to open</span>
        </span>
        <span className="ml-auto flex items-center gap-1">
          <kbd className="rounded border border-neutral-200 bg-neutral-50 px-1 py-0.5 font-sans font-medium leading-none">esc</kbd>
          <span className="ml-1">to close</span>
        </span>
      </div>
    </dialog>
  )
}
