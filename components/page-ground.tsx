/**
 * The page ground: pale chart artwork behind everything, fixed so it does not
 * scroll with the content.
 *
 * A fixed, cover-positioned layer rather than `bg-fixed` on a container.
 * `background-attachment: fixed` is unreliable on iOS Safari and interacts
 * badly with the backdrop-filter on the navbar; a fixed element behind the
 * content gives the same effect predictably.
 *
 * `bg-blend-multiply` is what makes the colour beneath the image matter.
 * investing.png is an OPAQUE WHITE image with faint grey marks, so on its own
 * it painted the page white and the `bg-neutral-100` under it was never seen —
 * white cards on a white page, which is why the layout read flat however the
 * cards were styled. Multiplying lets the white take the ground colour and the
 * marks darken it slightly, so the page is a real desk for the cards to sit on.
 * Measured after the change: the ground samples at #f5f5f5, not #ffffff.
 *
 * ## THE CONTAINER ABOVE THIS MUST NOT HAVE A BACKGROUND COLOUR
 *
 * This is a `-z-10` child, and a negative-z-index child paints after the
 * STACKING CONTEXT ROOT's background but before its parent's. So if the div
 * that holds this one has a background of its own — and creates no stacking
 * context, which a plain flex container does not — that background paints
 * straight over the artwork. The symptom is not an error: the image is in the
 * markup, the request for it succeeds, and the page is simply white. It cost a
 * day in September 2026 before anyone looked at the paint order.
 *
 * jsdom cannot see this, so no unit test will catch it. Load the page.
 *
 * Extracted from the authenticated shell 24 Sep 2026, when the public report
 * became the second screen to need it. `components/auth-shell.tsx` carries a
 * THIRD copy, deliberately not converted: it omits `bg-blend-multiply`, so its
 * ground is whiter, and unifying it would visibly restyle the login, MFA and
 * request-access screens. That is a decision to take on its own.
 */
export function PageGround() {
  return (
    <div
      aria-hidden
      className="pointer-events-none fixed inset-0 -z-10 bg-neutral-100 bg-[url('/investing.png')] bg-cover bg-center bg-no-repeat bg-blend-multiply"
    />
  )
}
