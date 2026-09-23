import { Card } from '@/components/ui'

/**
 * What a share link that does not open anything looks like.
 *
 * `notFound()` renders the nearest `not-found.tsx` INSIDE the layouts above it,
 * and without this file that nearest one is Next's built-in, which renders
 * outside `app/shared/layout.tsx` entirely — an unstyled black-on-white
 * "404 | This page could not be found" with no bar and no ground. That is the
 * page an outside reader sees when a link is old or mistyped, and it looks
 * like the site is broken rather than like the link is spent.
 *
 * It is also what made the "offers no way into the application" test vacuous:
 * with no chrome rendering at all, asserting that the chrome contains no
 * protected links passed for free. The test now asserts the bar IS here first.
 *
 * ## It says one thing for every reason
 *
 * Never issued, revoked, expired, and "that token is for a different report"
 * arrive here identically and leave with the same sentence. Telling the holder
 * of a wrong link which kind of wrong it is turns the page into an oracle for
 * guessing tokens — which is the whole of the security model here, since the
 * link is the only credential. The wording below deliberately covers mistyping
 * and expiry together without saying which happened.
 */
export default function SharedNotFound() {
  return (
    <Card className="col-span-full lg:col-span-6" padding="roomy">
      <h1 className="text-lg font-semibold tracking-tight text-neutral-900">
        This link doesn’t open anything
      </h1>
      <p className="mt-2 max-w-prose text-sm leading-relaxed text-neutral-600">
        Check you have the whole link — they are long, and mail clients sometimes
        break them across lines. If it was shared with you a while ago, ask
        whoever sent it for a new one.
      </p>
    </Card>
  )
}
