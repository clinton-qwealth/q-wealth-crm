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
 *
 * ## It shares the CARD TEXT's left edge, not the card border's
 *
 * Clinton read the first cut as "a little too far left", and he was right in
 * a measurable way: the header sat flush with the card's BORDER, while every
 * line inside the card — the toolbar, the field labels, the rows' names —
 * starts 16px further right, behind the card's `p-4`. A heading one step left
 * of every line under it reads as a misregistration, not a hierarchy. So the
 * header carries `px-4` to stand on the same text edge as the content it
 * captions — the group profile card's "one left edge" rule, applied a level
 * up. (`PageHeading` stays flush with the grid on the pages that use it; those
 * headers caption a whole page, not one card's contents.)
 *
 * ## A logo may stand where the name would
 *
 * Asked 26 Sep for providers: a record with a mark wears the mark. The h1 is
 * STILL the h1 — the image sits inside it and `title` becomes its alt, so the
 * page's accessible name is identical either way and `getByRole('heading',
 * { name })` cannot tell the difference. That is the whole design: the logo is
 * a rendering of the name, never a replacement for having one.
 */
export function RegisterHeader({
  trail,
  title,
  logo,
}: {
  trail: { label: string; href?: string }[]
  title: string
  /** An image URL that stands in for the title's TEXT. `title` still names the
   *  page — it becomes the image's alt. */
  logo?: string
}) {
  return (
    <header className="mb-4 px-4">
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
      <h1 className="mt-1 text-xl font-semibold tracking-tight text-neutral-900">
        {logo ? (
          /* Plain img: the provider route 302s to a signed URL, which
             next/image cannot optimise through. Height fixed to the header's
             scale, width its own — logos are wide, tall, square. */
          // eslint-disable-next-line @next/next/no-img-element
          <img src={logo} alt={title} className="h-12 w-auto max-w-64 object-contain" />
        ) : (
          title
        )}
      </h1>
    </header>
  )
}
