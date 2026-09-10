'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { NAV_ITEMS, isCurrentNavItem } from '@/lib/nav'

/**
 * The top bar's destinations, with the current one filled.
 *
 * **Split out of TopNav so only this is a client component.** There is no
 * server-side pathname in the App Router, and the shell layout is an `async`
 * server component that cannot become a client one, so knowing where you are
 * needs a client boundary — but only here. The header's mark, the Help icon
 * and the bar itself stay server-rendered. `profile-menu.tsx` and
 * `search-command.tsx` are the same arrangement: `'use client'` leaves inside a
 * server header.
 *
 * **The fill is `brand-600`, not `brand`.** White on `--brand-500` measures
 * 3.65:1, and the label is 14px regular, which needs 4.5:1. The 600 step
 * measures 4.86:1. It is the same orange one step down, and it clears the
 * floor rather than sitting just under it.
 *
 * **A caveat recorded rather than hidden:** `bg-brand` is this app's
 * primary-action colour — the Send button, the Add task button — so a filled
 * nav item reads a little like the main thing to click, which is backwards for
 * the page you are already on. The treatment was asked for; the 600 step and
 * `aria-current` are what make it legible and legible to a screen reader. If
 * it ever reads wrong, the alternative already in the app's vocabulary is the
 * tabs' 2px brand underline.
 */
export function TopNavLinks() {
  const pathname = usePathname()

  return (
    <nav aria-label="Main" className="hidden items-center gap-1 sm:flex">
      {NAV_ITEMS.map((item) => {
        const current = isCurrentNavItem(pathname, item.href)
        return (
          <Link
            key={item.href}
            href={item.href}
            /* `aria-current`, and NOT a visually-hidden "(current page)". The
               e2e suite finds these links by accessible name, and extra text
               inside the link would change the name and break it. This says
               the same thing to a screen reader and nothing to the name. */
            aria-current={current ? 'page' : undefined}
            className={[
              'rounded-md px-2.5 py-1.5 text-sm outline-none transition-colors',
              'focus-visible:ring-2 focus-visible:ring-brand/30',
              /* The two branches are mutually exclusive rather than additive.
                 Leaving the grey hover on the current item would turn it grey
                 under the pointer — the highlight disappearing exactly when
                 somebody reaches for it. `font-medium` is a second signal that
                 is not colour, since the fill is otherwise the only one. */
              current
                ? 'bg-brand-600 font-medium text-white hover:bg-brand-700'
                : 'text-neutral-600 hover:bg-neutral-100 hover:text-neutral-900',
            ].join(' ')}
          >
            {item.label}
          </Link>
        )
      })}
    </nav>
  )
}
