import Link from 'next/link'
import type { ComponentType } from 'react'
import { GroupIcon, PulseIcon, WorkflowIcon } from '@/components/icons'
import { ADMIN_SECTIONS, type AdminSectionId } from '@/lib/admin-sections'

/**
 * The Administration page's menu: one link per section, the current one marked.
 *
 * ## A server component, on purpose
 *
 * `TopNavLinks` has to be a client component because it works out where you
 * are from `usePathname()`. This one is told: the page reads `?section=` on the
 * server and passes the answer down, so there is no client boundary here and
 * nothing to hydrate. That is also why there is no pending mark — the hook it
 * would need lives on the client. If a click ever looks ignored after a server
 * action invalidates the prefetch cache, that is the piece to add, the way
 * `top-nav-links.tsx` does it.
 *
 * ## "Here" is a bar, not a fill
 *
 * The top bar fills the current item with the brand colour, a known contrast
 * exception that its own header defends. Down the side of a page, the same
 * fill would be the loudest thing on the screen and would sit where the eye
 * expects the primary action. So this uses the other idiom already in the
 * vocabulary — the tabs' 2px brand bar — turned on its side and put on the
 * left edge, with a grey ground and a heavier weight as the two signals that
 * are not colour. `aria-current` says the same thing to a screen reader.
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

export function AdminNav({ current }: { current: AdminSectionId }) {
  return (
    <nav aria-label="Administration sections">
      <ul className="no-scrollbar flex gap-1 overflow-x-auto lg:flex-col lg:overflow-visible">
        {ADMIN_SECTIONS.map((section) => {
          const Icon = ICONS[section.id]
          const active = section.id === current
          return (
            <li key={section.id} className="shrink-0 lg:shrink">
              <Link
                href={section.href}
                /* `aria-current`, and NOT a visually-hidden "(current)". The
                   e2e suite finds these links by accessible name, and extra
                   text inside the link would change the name. */
                aria-current={active ? 'page' : undefined}
                className={[
                  /* `relative` anchors the bar's absolute position. */
                  'relative flex items-center gap-2.5 rounded-md py-2 pl-3 pr-3 text-sm outline-none transition-colors',
                  'focus-visible:ring-2 focus-visible:ring-brand/30',
                  /* Mutually exclusive, as in the top bar: a grey hover on the
                     current item would make the highlight disappear under the
                     pointer, exactly when somebody reaches for it. */
                  active
                    ? 'bg-neutral-100 font-medium text-neutral-900'
                    : 'text-neutral-600 hover:bg-neutral-50 hover:text-neutral-900',
                ].join(' ')}
              >
                <span
                  aria-hidden="true"
                  className={[
                    'pointer-events-none absolute inset-y-2 left-0 w-0.5 rounded-full bg-brand',
                    active ? 'opacity-100' : 'opacity-0',
                  ].join(' ')}
                />
                <Icon className={`h-4 w-4 shrink-0 ${active ? 'text-brand' : 'text-neutral-400'}`} />
                <span className="whitespace-nowrap">{section.label}</span>
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
