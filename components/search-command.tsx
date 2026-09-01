'use client'

import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { SearchIcon } from './icons'

/**
 * Navbar search. Sits narrow and quiet until focused, then widens.
 *
 * The ⌘K badge is a real shortcut, not decoration: pressing it anywhere on the
 * page focuses the field, and Escape releases it.
 *
 * The modifier label depends on the platform, which the server cannot know. That
 * is precisely what useSyncExternalStore's server snapshot is for: server and
 * first client render both use '⌘', then React re-reads on the client. Same
 * result as correcting state in an effect, without the extra render pass — and
 * still no hydration mismatch.
 */
/* The platform never changes for the life of the page, so there is nothing to
   subscribe to — but useSyncExternalStore requires a subscribe function, and it
   must keep a stable identity or React resubscribes every render. */
const subscribeToNothing = () => () => {}
const readModifier = () => (/Mac|iPhone|iPad|iPod/.test(navigator.userAgent) ? '⌘' : 'Ctrl ')
const readModifierOnServer = () => '⌘'

export function SearchCommand() {
  const inputRef = useRef<HTMLInputElement>(null)
  const [focused, setFocused] = useState(false)
  const modifier = useSyncExternalStore(subscribeToNothing, readModifier, readModifierOnServer)

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key.toLowerCase() === 'k' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        inputRef.current?.focus()
        inputRef.current?.select()
      }
      if (e.key === 'Escape' && document.activeElement === inputRef.current) {
        inputRef.current?.blur()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  return (
    <div
      className={[
        'relative transition-[width] duration-200 ease-out',
        focused ? 'w-full sm:w-96' : 'w-44 sm:w-64',
      ].join(' ')}
    >
      <span
        className={[
          'pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 transition-colors',
          focused ? 'text-brand' : 'text-neutral-400',
        ].join(' ')}
      >
        <SearchIcon />
      </span>

      <input
        ref={inputRef}
        type="search"
        aria-label="Search clients, groups and notes"
        placeholder={focused ? 'Search clients, groups and notes…' : 'Search'}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        className="h-8 w-full rounded-md border border-neutral-200 bg-neutral-50 pl-8 pr-14 text-sm text-neutral-900 placeholder:text-neutral-400 outline-none transition-colors focus:border-brand-300 focus:bg-white focus:ring-2 focus:ring-brand/15 [&::-webkit-search-cancel-button]:hidden"
      />

      <kbd
        aria-hidden
        className={[
          'pointer-events-none absolute right-2 top-1/2 hidden -translate-y-1/2 select-none',
          'rounded border border-neutral-200 bg-white px-1.5 py-0.5',
          'font-sans text-[10px] font-medium leading-none tracking-wide sm:block',
          focused ? 'text-neutral-300' : 'text-neutral-400',
        ].join(' ')}
      >
        {focused ? 'esc' : `${modifier}K`}
      </kbd>
    </div>
  )
}
