import Link from 'next/link'
import { Fragment } from 'react'

/**
 * The compact header a register page opens with: a breadcrumb line, and the
 * page's h1 under it.
 *
 * Asked for on 26 September 2026, shaped on a Confluence page header —
 * "Spaces / Q Wealth Technology" over "General Tech Operations". The
 * full-width `PageHeading` block was removed from these pages a day earlier
 * for crowding the work down the screen; this is the small version that earns
 * its two lines: the trail says where the register sits, the title IS the h1
 * (visible again — the `sr-only` one this replaces was an interim), and both
 * live in the middle column where the content they describe is.
 *
 * A crumb without an `href` is the level you are on, rendered as text — a
 * link to the page you are reading is a control that does nothing.
 */
export function RegisterHeader({
  trail,
  title,
}: {
  trail: { label: string; href?: string }[]
  title: string
}) {
  return (
    <header className="mb-4">
      <nav aria-label="Breadcrumb" className="flex items-center gap-1.5 text-xs text-neutral-500">
        {trail.map((crumb, i) => (
          <Fragment key={crumb.label}>
            {i > 0 ? (
              <span aria-hidden="true" className="select-none text-neutral-300">
                /
              </span>
            ) : null}
            {crumb.href ? (
              <Link
                href={crumb.href}
                className="rounded outline-none transition-colors hover:text-neutral-800 focus-visible:ring-2 focus-visible:ring-brand/30"
              >
                {crumb.label}
              </Link>
            ) : (
              <span aria-current="location">{crumb.label}</span>
            )}
          </Fragment>
        ))}
      </nav>
      <h1 className="mt-1 text-xl font-semibold tracking-tight text-neutral-900">{title}</h1>
    </header>
  )
}
