'use client'

import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import { UserIcon } from './icons'

const ITEMS = [
  { href: '/profile', label: 'Profile' },
  { href: '/preferences', label: 'Preferences' },
]

function initialsOf(name?: string) {
  if (!name) return null
  const parts = name.trim().split(/\s+/).slice(0, 2)
  return parts.map((p) => p[0]?.toUpperCase()).join('') || null
}

/**
 * Avatar button with a dropdown.
 *
 * Closes on outside click and on Escape, and returns focus to the trigger so
 * keyboard users are not stranded at the end of the document. Arrow keys move
 * between items; the first item takes focus when the menu is opened from the
 * keyboard.
 */
export function ProfileMenu({ name, email }: { name?: string; email?: string }) {
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const itemRefs = useRef<(HTMLAnchorElement | null)[]>([])
  const initials = initialsOf(name)

  useEffect(() => {
    if (!open) return

    function onPointerDown(e: MouseEvent) {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false)
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault()
        setOpen(false)
        triggerRef.current?.focus()
      }
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault()
        const items = itemRefs.current.filter(Boolean) as HTMLAnchorElement[]
        const i = items.indexOf(document.activeElement as HTMLAnchorElement)
        const next =
          e.key === 'ArrowDown'
            ? items[(i + 1) % items.length]
            : items[(i - 1 + items.length) % items.length]
        next?.focus()
      }
    }

    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  return (
    <div ref={containerRef} className="relative">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault()
            setOpen(true)
            requestAnimationFrame(() => itemRefs.current[0]?.focus())
          }
        }}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={name ? `Account menu for ${name}` : 'Account menu'}
        className="flex h-8 w-8 items-center justify-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-brand/30"
      >
        {initials ? (
          <span
            className={[
              'flex h-7 w-7 items-center justify-center rounded-full text-[11px] font-semibold transition-colors',
              open
                ? 'bg-brand-200 text-brand-700 ring-1 ring-brand-300'
                : 'bg-brand-100 text-brand-700 ring-1 ring-brand-200 hover:bg-brand-200',
            ].join(' ')}
          >
            {initials}
          </span>
        ) : (
          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-neutral-100 text-neutral-500 ring-1 ring-neutral-200 hover:bg-neutral-200">
            <UserIcon className="h-[18px] w-[18px]" />
          </span>
        )}
      </button>

      {open ? (
        <div
          role="menu"
          aria-label="Account"
          className="absolute right-0 top-full z-50 mt-1.5 w-56 overflow-hidden rounded-lg border border-neutral-200 bg-white py-1 shadow-lg shadow-neutral-900/5"
        >
          {name || email ? (
            <div className="border-b border-neutral-100 px-3 pb-2 pt-1.5">
              {name ? (
                <p className="truncate text-sm font-medium text-neutral-900">{name}</p>
              ) : null}
              {email ? (
                <p className="truncate text-xs text-neutral-500">{email}</p>
              ) : null}
            </div>
          ) : null}

          <div className="py-1">
            {ITEMS.map((item, i) => (
              <Link
                key={item.href}
                href={item.href}
                role="menuitem"
                ref={(el) => {
                  itemRefs.current[i] = el
                }}
                onClick={() => setOpen(false)}
                className="block px-3 py-1.5 text-sm text-neutral-700 outline-none transition-colors hover:bg-neutral-50 hover:text-neutral-900 focus-visible:bg-brand-50 focus-visible:text-brand-700"
              >
                {item.label}
              </Link>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  )
}
