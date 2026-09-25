'use client'

import Link from 'next/link'
import type { ComponentType, MouseEvent } from 'react'
import { GroupIcon, PulseIcon, WorkflowIcon } from '@/components/icons'
import { SHEET_SURFACE } from '@/components/ui'
import { useServerState } from '@/components/use-server-state'
import { ADMIN_SECTIONS, type AdminSectionId } from '@/lib/admin-sections'

/**
 * The Administration page's menu: one link per section, the current one marked.
 *
 * ## The mark moves on the CLICK, not on the load
 *
 * This is a client component for one reason, added 25 September 2026: the
 * selection has to move immediately.
 *
 * It was a server component, told which section it was on through a prop. That
 * prop only changes when the new server render arrives, so the mark sat on the
 * old item for the whole round trip and the menu felt dead for a beat after
 * every click. The top bar does not have this problem because it computes the
 * mark from `usePathname()`, which updates at COMMIT — and, for a page-segment
 * change, `app/(shell)/loading.tsx` makes commit happen on the first frame.
 *
 * **That boundary does not help here.** A loading boundary is scoped to its
 * segment's child slot, and every section is the same `/admin` page segment
 * with a different query string, so nothing re-suspends and nothing commits
 * early. `usePathname()` would not move either — the whole navigation lands in
 * one go when the RSC payload arrives.
 *
 * So the mark is local state seeded from the server, through the house hook:
 * the click sets it, and `useServerState` re-seeds when the server catches up
 * and says the same thing. If a navigation is abandoned, the next server value
 * puts the mark back where it belongs.
 *
 * `top-nav-links.tsx` argues AGAINST exactly this, and is right to — for
 * itself. Its objection is that an optimistic fill claims you are on a page
 * you are not, and has to snap back on a modifier click. The first half does
 * not apply here: these are not different pages, they are one page's sections,
 * and the section is the thing being chosen. The second half does apply, and
 * is handled — `isModified` below leaves the mark alone for the clicks that
 * open a new tab or window rather than navigating this one.
 *
 * ## Bare on the ground, and "here" is a sheet
 *
 * The first version sat inside a `Card`, and read as a record of three rows
 * beside a record of tabs — two boxes of the same weight, one of which was
 * only chrome. Since 25 September the menu sits directly on the page ground
 * and the CURRENT item is the one white surface: `SHEET_SURFACE`, the same
 * lift every list here gives its sheet, so the item you are on reads as the
 * front of the working area rather than as a highlighted row in a box. The
 * others are text on the ground and whiten under the pointer.
 *
 * The 2px brand bar on the left edge stays — the tabs' "here" idiom, turned
 * on its side — and with the glyph going brand, that is three signals, one
 * of which is not colour (the lift) and one of which is not visual at all
 * (`aria-current`).
 *
 * ## The hover tint is OPAQUE, and the transition is the house one
 *
 * Both were different for a few hours on 25 September and both were wrong in
 * the same way: they were the only things on the page compositing against the
 * fixed `PageGround` layer under a `backdrop-filter` header.
 *
 * The tint was `bg-white/70`. Every other hover in this app is opaque — the
 * top bar's is `bg-neutral-100` — and a translucent one has to be re-blended
 * with the artwork behind it on every repaint, which the blurred header at
 * `z-40` already forces the compositor to track. It is now `bg-white`, which
 * also reads better: hovering an item previews it rising into the sheet it
 * becomes when you are on it.
 *
 * The transition named `box-shadow` explicitly, so the active item's sheet
 * shadow animated too. `transition-colors` is what every neighbour here uses,
 * it covers `color`, `background-color` and `stroke` — which is the glyph —
 * and it leaves the shadow alone. **Do not put `box-shadow` back without
 * checking the cursor**: Clinton reported that hovering an item showed the
 * hand while the pointer moved and dropped to the arrow the moment it stopped,
 * and a static reproduction built from the compiled CSS ruled the stylesheet
 * out — the computed cursor here is `pointer` and the hit test lands inside
 * the anchor — which left repaint as the cause and these two as the suspects.
 *
 * ## Icons live here, not in the list
 *
 * `ADMIN_SECTIONS` is a `lib/` module with no JSX, so a test can import it
 * without a renderer. The glyph for each id is looked up here instead, and the
 * `Record` type means a new section cannot be added to the list without a
 * glyph being chosen for it — TypeScript refuses the omission.
 *
 * On a narrow screen the left column stacks above the working area, so the
 * list runs sideways there and only becomes a column at `lg`, where it has a
 * column to be in.
 */
const ICONS: Record<AdminSectionId, ComponentType<{ className?: string }>> = {
  users: GroupIcon,
  workflows: WorkflowIcon,
  observability: PulseIcon,
}

/**
 * A click that opens somewhere else — a new tab, a new window, a download —
 * rather than navigating this page. The mark must not move for these: the
 * section you are looking at has not changed.
 *
 * A middle click raises `auxclick` rather than `click` in current browsers, so
 * the button test is belt to the modifiers' braces rather than the main guard.
 */
function isModified(e: MouseEvent<HTMLAnchorElement>): boolean {
  return e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0
}

export function AdminNav({ current }: { current: AdminSectionId }) {
  const [selected, setSelected] = useServerState(current)

  return (
    <nav aria-label="Administration sections">
      {/* `-m-1 p-1` gives the current item's shadow room inside the sideways
          scroller on small screens, where `overflow-x-auto` would otherwise
          clip it top and bottom. */}
      <ul className="no-scrollbar -m-1 flex gap-1 overflow-x-auto p-1 lg:flex-col lg:overflow-visible">
        {ADMIN_SECTIONS.map((section) => {
          const Icon = ICONS[section.id]
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
