'use client'

import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import { signOut } from '@/app/actions'
import { ACCOUNT_MENU_ITEMS, ADMIN_MENU_ITEM } from '@/lib/nav'
import { fullName, initialsOf } from '@/lib/staff-name'
import type { ComponentType } from 'react'
import { Avatar } from './avatar'
import { KeyIcon, SignOutIcon, SlidersIcon, UserIcon } from './icons'

/* `group`, so the glyph can follow the label's hover colour. */
const ITEM_CLASS =
  'group flex w-full items-center gap-2.5 px-3 py-1.5 text-left text-sm outline-none transition-colors focus-visible:bg-brand-50 focus-visible:text-brand-700'

/* Quiet by default and darkening with the row: the glyph is a cue beside the
   word, not a second label competing with it. */
const ITEM_ICON = 'h-4 w-4 shrink-0 text-neutral-400 transition-colors group-hover:text-neutral-600'

/**
 * A glyph per destination, keyed by href so the list in `lib/nav.ts` stays
 * free of JSX and importable by tests. The `Record` over the union of hrefs
 * means a destination added there without a glyph here is a type error, not
 * a bare row in the menu.
 */
const ICONS: Record<
  (typeof ACCOUNT_MENU_ITEMS)[number]['href'] | typeof ADMIN_MENU_ITEM.href,
  ComponentType<{ className?: string }>
> = {
  '/profile': UserIcon,
  '/preferences': SlidersIcon,
  '/admin': KeyIcon,
}

/**
 * Avatar button with a dropdown.
 *
 * Closes on outside click and on Escape, and returns focus to the trigger so
 * keyboard users are not stranded at the end of the document. Arrow keys move
 * between items — including Sign out, which is a submit button rather than a
 * link, so the focus list is typed as HTMLElement rather than anchors.
 */
export function ProfileMenu({
  firstName,
  lastName,
  email,
  isAdmin = false,
  staffId,
  avatarPath = null,
}: {
  firstName?: string
  lastName?: string
  email?: string
  /** One fact crosses the client boundary, not the permission matrix. */
  isAdmin?: boolean
  /** With both, the trigger shows the person's photo instead of their initials. */
  staffId?: string
  avatarPath?: string | null
}) {
  const links = isAdmin ? [...ACCOUNT_MENU_ITEMS, ADMIN_MENU_ITEM] : [...ACCOUNT_MENU_ITEMS]
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const itemRefs = useRef<(HTMLElement | null)[]>([])
  /* One rule, shared with the Avatar tile — this component used to carry a
     private copy of it that took the first letter of the first TWO words. */
  const name = firstName || lastName ? fullName({ first_name: firstName ?? '', last_name: lastName ?? '' }) : undefined
  const initials = name ? initialsOf({ first_name: firstName ?? '', last_name: lastName ?? '' }) : null

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
        const items = itemRefs.current.filter(Boolean) as HTMLElement[]
        const i = items.indexOf(document.activeElement as HTMLElement)
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
        {staffId && avatarPath && name ? (
          <Avatar
            staffId={staffId}
            firstName={firstName ?? ''}
            lastName={lastName ?? ''}
            avatarPath={avatarPath}
            size="sm"
            className={open ? 'ring-brand-300' : 'hover:ring-brand-200'}
          />
        ) : initials ? (
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
              {email ? <p className="truncate text-xs text-neutral-500">{email}</p> : null}
            </div>
          ) : null}

          <div className="py-1">
            {links.map((item, i) => {
              const Icon = ICONS[item.href]
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  role="menuitem"
                  ref={(el) => {
                    itemRefs.current[i] = el
                  }}
                  onClick={() => setOpen(false)}
                  className={`${ITEM_CLASS} text-neutral-700 hover:bg-neutral-50 hover:text-neutral-900`}
                >
                  <Icon className={ITEM_ICON} />
                  {item.label}
                </Link>
              )
            })}
          </div>

          {/* Separated: leaving is a different kind of act from navigating. */}
          <div className="border-t border-neutral-100 py-1">
            <form action={signOut}>
              <button
                type="submit"
                role="menuitem"
                ref={(el) => {
                  itemRefs.current[links.length] = el
                }}
                className={`${ITEM_CLASS} text-neutral-700 hover:bg-neutral-50 hover:text-neutral-900`}
              >
                <SignOutIcon className={ITEM_ICON} />
                Sign out
              </button>
            </form>
          </div>
        </div>
      ) : null}
    </div>
  )
}
