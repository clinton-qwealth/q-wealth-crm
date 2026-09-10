'use client'

import Link, { useLinkStatus } from 'next/link'
import { usePathname } from 'next/navigation'
import { NAV_ITEMS, isCurrentNavItem } from '@/lib/nav'

/**
 * The mark that says "this click is in flight", before the navigation commits.
 *
 * The brand fill moves when `usePathname()` changes, and that happens at
 * COMMIT — which, now that every page has a loading boundary, is usually the
 * first frame after the click. But not always: after any server action the
 * prefetch cache is invalidated and the next click has to fetch the loading
 * segment through the proxy first, and in development nothing is prefetched at
 * all. In that window the click would otherwise look ignored.
 *
 * `useLinkStatus()` reports pending for exactly that window: set inside the
 * navigation's transition, cleared when it commits — the same instant the fill
 * moves, so the two hand over cleanly.
 *
 * **Why not move the fill early.** An optimistic fill would claim you are
 * already somewhere you are not, and would have to snap back on a failed or
 * modifier-click navigation. So this is the tabs component's own "here" idiom
 * instead — a 2px brand bar — always rendered and toggled by opacity, so it can
 * never shift layout. `aria-hidden` and empty, so the link's accessible name
 * stays exactly its label: the e2e suite looks these up by name. On the current
 * item it is brand on brand and invisible, which is right — that click goes
 * nowhere.
 *
 * Must be a descendant of the Link it reports on; that is the hook's contract.
 */
function PendingMark() {
  const { pending } = useLinkStatus()
  return (
    <span
      aria-hidden="true"
      className={[
        'pointer-events-none absolute inset-x-2.5 bottom-0.5 h-0.5 rounded-full bg-brand',
        'transition-opacity duration-150 motion-reduce:transition-none',
        pending ? 'opacity-100' : 'opacity-0',
      ].join(' ')}
    />
  )
}

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
 * **The fill is `bg-brand` — the 500 step, `#e85524` — chosen deliberately,
 * and it is below the contrast floor.** White on it measures **3.65:1**, and a
 * 14px regular label needs 4.5:1 for WCAG AA. This shipped at `brand-600`
 * (4.86:1) first and was changed back on 10 September because the darker step
 * read as a different colour rather than as the brand.
 *
 * **So this is a known, accepted exception, not an oversight — do not
 * "correct" it without asking.** Two things about it are worth knowing if it
 * is ever revisited: no font weight fixes it, because WCAG's 3:1 large-text
 * allowance needs 18.66px bold or 24px and this label is neither; and the
 * app's primary buttons already put white on this same step, so the nav is
 * consistent with them rather than newly wrong.
 *
 * `hover:bg-brand-600` follows the primary button's own pairing
 * (`bg-brand` → `hover:bg-brand-600`), so the item darkens on hover in the
 * direction everything else in the app does.
 *
 * **A second caveat, unchanged:** `bg-brand` IS the primary-action colour — the
 * Send button, the Add task button — so a filled nav item reads a little like
 * the main thing to click, which is backwards for the page you are already on.
 * `aria-current` is what tells a screen reader what the colour is doing. If it
 * ever reads wrong, the alternative already in this app's vocabulary is the
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
              /* `relative` anchors the pending mark's absolute position. */
              'relative rounded-md px-2.5 py-1.5 text-sm outline-none transition-colors',
              'focus-visible:ring-2 focus-visible:ring-brand/30',
              /* The two branches are mutually exclusive rather than additive.
                 Leaving the grey hover on the current item would turn it grey
                 under the pointer — the highlight disappearing exactly when
                 somebody reaches for it. `font-medium` is a second signal that
                 is not colour, since the fill is otherwise the only one. */
              current
                ? 'bg-brand font-medium text-white hover:bg-brand-600'
                : 'text-neutral-600 hover:bg-neutral-100 hover:text-neutral-900',
            ].join(' ')}
          >
            {item.label}
            <PendingMark />
          </Link>
        )
      })}
    </nav>
  )
}
