'use client'

import Link from 'next/link'
import type { ComponentType, MouseEvent } from 'react'
import { SHEET_SURFACE } from '@/components/ui'
import { useServerState } from '@/components/use-server-state'

/**
 * The left-column menu a sectioned page hangs its territories on — one link
 * per section, the current one marked. Built for the Administration page on
 * 24–25 September 2026; extracted the moment `/groups` became the second page
 * to want it, because the admin version's look had already been through three
 * rounds of review and a copy would have started drifting from day one, the
 * way the add buttons did.
 *
 * The PAGE owns what the sections are (`lib/admin-sections.ts`,
 * `lib/group-sections.ts`) and which glyph each takes; this component owns how
 * a menu of them looks and behaves. Keep it that way — a section list with JSX
 * in it can no longer be imported by `no-dead-links`.
 *
 * ## The mark moves on the CLICK, not on the load
 *
 * This is a client component for one reason: the selection has to move
 * immediately. It began as a server component told its section through a prop —
 * which only changes when the new render arrives, so the mark sat on the old
 * item for the whole round trip and the menu felt dead after every click. The
 * top bar does not have this problem because `usePathname()` updates at
 * commit, and `app/(shell)/loading.tsx` makes commit happen on the first
 * frame — but every section here is the SAME page segment with a different
 * query string, so nothing re-suspends, nothing commits early, and the mark
 * has to be moved locally.
 *
 * So it is local state seeded from the server through the house hook: the
 * click sets it, and `useServerState` re-seeds when the server catches up. If
 * a navigation is abandoned, the next server value puts the mark back.
 *
 * `top-nav-links.tsx` argues AGAINST optimistic marks, and is right — for
 * itself. Its first objection, claiming to be on a page you are not, does not
 * apply to one page's sections; its second, the modifier click that opens a
 * new tab, does, and `isModified` below handles it.
 *
 * ## Bare on the ground, and "here" is a sheet
 *
 * The first version sat inside a `Card`, and read as a record of rows beside a
 * record of tabs — two boxes of the same weight, one of which was only chrome.
 * The menu sits directly on the page ground, and the CURRENT item is the one
 * white surface: `SHEET_SURFACE`, the same lift every list gives its sheet, so
 * the item you are on reads as the front of the working area rather than as a
 * highlighted row in a box. The 2px brand bar is the tabs' "here" idiom turned
 * on its side; with the glyph going brand that is three signals, one not
 * colour (the lift) and one not visual at all (`aria-current`).
 *
 * ## The hover tint is OPAQUE, and the transition is the house one
 *
 * Both were briefly otherwise and both were wrong the same way: the only
 * things on the page compositing against the fixed `PageGround` under a
 * `backdrop-filter` header. The tint was `bg-white/70` — every other hover
 * here is opaque, and a translucent one is re-blended with the artwork on
 * every repaint. The transition named `box-shadow`, animating the sheet's
 * shadow. **Do not put either back without checking the cursor**: Clinton
 * reported the hand dropping to the arrow whenever the pointer stopped, a
 * static repro ruled the stylesheet out, and repaint was what remained.
 *
 * On a narrow screen the column stacks above the working area, so the list
 * runs sideways and only becomes a column at `lg`, where it has a column to
 * be in.
 */
export type SectionNavItem = {
  id: string
  label: string
  href: string
  icon: ComponentType<{ className?: string }>
}

function isModified(e: MouseEvent<HTMLAnchorElement>): boolean {
  return e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0
}

export function SectionNav({
  label,
  items,
  current,
}: {
  /** The nav landmark's accessible name, e.g. "Administration sections". */
  label: string
  items: SectionNavItem[]
  current: string
}) {
  const [selected, setSelected] = useServerState(current)

  return (
    <nav aria-label={label}>
      {/* `-m-1 p-1` gives the current item's shadow room inside the sideways
          scroller on small screens, where `overflow-x-auto` would otherwise
          clip it top and bottom. */}
      <ul className="no-scrollbar -m-1 flex gap-1 overflow-x-auto p-1 lg:flex-col lg:overflow-visible">
        {items.map((section) => {
          const Icon = section.icon
          const active = section.id === selected
          return (
            <li key={section.id} className="shrink-0 lg:shrink">
              <Link
                href={section.href}
                onClick={(e) => {
                  if (!isModified(e)) setSelected(section.id)
                }}
                /* `aria-current`, and NOT a visually-hidden "(current)". The
                   e2e suite finds these links by accessible name, and extra
                   text inside the link would change the name. */
                aria-current={active ? 'page' : undefined}
                className={[
                  /* `relative` anchors the bar's absolute position. */
                  'relative flex items-center gap-2.5 rounded-lg py-2 pl-3.5 pr-3 text-sm outline-none',
                  'transition-colors focus-visible:ring-2 focus-visible:ring-brand/30',
                  /* Mutually exclusive, as in the top bar: a hover tint on the
                     current item would dull the sheet under the pointer,
                     exactly when somebody reaches for it. */
                  active
                    ? `font-medium text-neutral-900 ${SHEET_SURFACE}`
                    : 'text-neutral-600 hover:bg-white hover:text-neutral-900',
                ].join(' ')}
              >
                <span
                  aria-hidden="true"
                  className={[
                    /* Inside the sheet's border rather than on it, so the bar
                       reads as a mark on the item and not as a coloured edge. */
                    'pointer-events-none absolute inset-y-2.5 left-0.75 w-0.5 rounded-full bg-brand',
                    'transition-opacity duration-150 motion-reduce:transition-none',
                    active ? 'opacity-100' : 'opacity-0',
                  ].join(' ')}
                />
                <Icon className={`h-4 w-4 shrink-0 transition-colors ${active ? 'text-brand' : 'text-neutral-400'}`} />
                <span>{section.label}</span>
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
