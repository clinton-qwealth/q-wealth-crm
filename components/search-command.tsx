'use client'

import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { useRouter } from 'next/navigation'
import { SearchIcon } from './icons'
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
        <span className="flex-1 truncate">Search</span>
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
      className="w-full max-w-[40rem] rounded-xl border border-neutral-200 bg-white p-0 shadow-2xl shadow-neutral-900/20 backdrop:bg-neutral-900/30 sm:mt-[12vh]"
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
          placeholder="Search groups, people and workflows"
          aria-label="Search groups, people and workflows"
          className="h-12 flex-1 bg-transparent text-sm text-neutral-900 outline-none placeholder:text-neutral-400"
        />
        <kbd className="select-none rounded border border-neutral-200 bg-neutral-50 px-1.5 py-0.5 font-sans text-[10px] font-medium leading-none tracking-wide text-neutral-400">
          esc
        </kbd>
      </div>

      <div className="max-h-[60vh] overflow-y-auto px-2 py-2">
        {query.trim().length < MIN_QUERY ? (
          <p className="px-2 py-6 text-center text-sm text-neutral-400">
            {tooShort ? `Keep typing — ${MIN_QUERY} characters or more.` : 'Start typing to search.'}
          </p>
        ) : hits.length === 0 ? (
          <p className="px-2 py-6 text-center text-sm text-neutral-400">
            {searching ? 'Searching…' : `Nothing found for “${query.trim()}”.`}
          </p>
        ) : (
          SECTIONS.map(([key, label]) => {
            const rows = results[key]
            if (!rows.length) return null
            return (
              <section key={key} data-slot="search-section" data-section={key} className="mb-1.5">
                <h2 className="px-2 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wider text-neutral-500">
                  {label}
                </h2>
                <ul>
                  {rows.map((hit) => {
                    const index = hits.indexOf(hit)
                    return (
                      <li key={`${key}-${hit.id}`}>
                        <button
                          type="button"
                          data-slot="search-hit"
                          data-active={index === active ? 'true' : 'false'}
                          onMouseEnter={() => setActive(index)}
                          onClick={() => go(hit)}
                          disabled={!hit.href}
                          className={`flex w-full items-baseline gap-3 rounded-md px-2 py-2 text-left outline-none disabled:cursor-default ${
                            index === active ? 'bg-brand-50' : ''
                          }`}
                        >
                          <span className="min-w-0 flex-1 truncate text-sm text-neutral-900">
                            {hit.title}
                          </span>
                          {hit.detail ? (
                            <span className="shrink-0 text-xs text-neutral-500">{hit.detail}</span>
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

        {/* Named as unbuilt rather than left out, in the dashed treatment this
            app uses everywhere for a thing that is planned: the Tools tab's
            inactive tiles, the reserved column, the Read more on a file note.
            Leaving it out entirely would make the section look decided. */}
        <div
          data-slot="search-knowledgebase"
          className="mx-2 mt-2 rounded-md border border-dashed border-neutral-200 bg-neutral-50/60 px-3 py-2.5 text-xs text-neutral-500"
        >
          <span className="font-medium text-neutral-600">Knowledgebase</span> — not built yet, so
          nothing here is searched.
        </div>
      </div>
    </dialog>
  )
}
