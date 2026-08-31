'use client'

import { useEffect, useRef, useState } from 'react'
import { SearchIcon } from './icons'

/**
 * Navbar search. Sits narrow and quiet until focused, then widens.
 *
 * The ⌘K badge is a real shortcut, not decoration: pressing it anywhere on the
 * page focuses the field, and Escape releases it. The modifier label starts as
 * '⌘' so the server and first client render agree, then corrects to 'Ctrl' after
 * mount on non-Apple platforms — avoiding a hydration mismatch rather than
 * suppressing one.
 */
export function SearchCommand() {
  const inputRef = useRef<HTMLInputElement>(null)
  const [focused, setFocused] = useState(false)
  const [modifier, setModifier] = useState('⌘')

  useEffect(() => {
    const isApple = /Mac|iPhone|iPad|iPod/.test(navigator.userAgent)
    if (!isApple) setModifier('Ctrl ')
  }, [])

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
