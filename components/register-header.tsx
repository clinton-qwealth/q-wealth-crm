import Link from 'next/link'
import { Fragment, type ReactNode } from 'react'

/** The root every trail starts from, written once. */
export const ROOT_CRUMB = { label: 'Q Wealth CRM', href: '/' } as const

/**
 * The compact header a register page opens with: a breadcrumb line, and the
 * page's h1 under it.
 *
 * Asked for on 26 September 2026, shaped on a Confluence page header —
 * "Spaces / Q Wealth Technology" over "General Tech Operations" — and later
 * the same day promoted to THE header for every page in the shell: the trail
 * replaces `PageHeading`'s brand-orange eyebrow (a breadcrumb says where you
 * are AND takes you back up, where an eyebrow only decorated), and the
 * compact title stops the chrome outgrowing the work. `PageHeading` survives
 * in exactly one page: the public parking report, which deliberately does not
 * tell its reader there is a CRM to have breadcrumbs into. The back-links the
 * old headers carried ("← All templates", "← All policies") are gone — the
 * trail IS the way back, and two ways back is one too many.
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
  description,
  meta,
  actions,
  summary,
}: {
  trail: { label: string; href?: string }[]
  title: string
  /** An image URL that stands in for the title's TEXT. `title` still names the
   *  page — it becomes the image's alt. */
  logo?: string
  description?: string
  /** Status marks under the title — pills, not a paragraph. */
  meta?: ReactNode
  /** Controls sharing the heading's row, e.g. Start a workflow. */
  actions?: ReactNode
  /** Headline figures beside the title — the group page's wealth strip. The
   *  5/7 split is `PageHeading`'s own, kept so that page's cards still start
   *  where they were asked to. */
  summary?: ReactNode
}) {
  const heading = (
    <div className="min-w-0">
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
      {meta ? <div className="mt-1.5 flex flex-wrap items-center gap-1.5">{meta}</div> : null}
      {description ? <p className="mt-1 max-w-prose text-sm text-neutral-500">{description}</p> : null}
    </div>
  )

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
      {summary ? (
        <div className="grid grid-cols-1 items-center gap-4 lg:grid-cols-12 lg:gap-6">
          <div className="flex flex-wrap items-end justify-between gap-3 lg:col-span-5">
            {heading}
            {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
          </div>
          <div className="lg:col-span-7">{summary}</div>
        </div>
      ) : (
        <div className="flex flex-wrap items-end justify-between gap-3">
          {heading}
          {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
        </div>
      )}
    </header>
  )
}
