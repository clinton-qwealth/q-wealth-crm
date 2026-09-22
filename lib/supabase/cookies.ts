import type { CookieOptionsWithName } from '@supabase/ssr'

/**
 * The attributes every Supabase auth cookie is written with.
 *
 * @supabase/ssr's defaults are `path=/`, `sameSite=lax`, `httpOnly: false` and
 * — the reason this file exists — **no `Secure` attribute at all**. Its
 * `DEFAULT_COOKIE_OPTIONS` simply does not mention it, so without this the
 * session token is a cookie a browser would send over plain HTTP.
 *
 * One object, imported by all three places a client is constructed (the server
 * client, the proxy and the browser client), because a cookie written with one
 * set of attributes and refreshed with another is two cookies as far as the
 * browser is concerned.
 *
 * ## HttpOnly is NOT set here, and that is a decision rather than an oversight
 *
 * `createBrowserClient` reads the session out of `document.cookie`; a cookie
 * the browser cannot see is a session the app cannot resume, so `httpOnly: true`
 * does not harden this design, it breaks it. Changing that means not holding the
 * session in a cookie the client reads at all — a different architecture, not a
 * flag. What stands in its place: `SameSite=Lax`, access tokens that are short
 * lived and verified locally by signature, a mandatory second factor re-checked
 * at every route handler and edge function, and RLS as the actual boundary.
 * Documented here so the next person reads a position, not an absence.
 *
 * ## Why `secure` is conditional
 *
 * Chromium and Firefox accept a `Secure` cookie on `http://localhost`, treating
 * it as a trustworthy origin; Safari does not. `next dev` and the Playwright
 * suite both serve over plain HTTP on localhost, so pinning this to `true`
 * would make signing in fail on one browser and work on another, which is a
 * miserable thing to debug. Every deployed environment — preview included,
 * since Next sets NODE_ENV=production for any build — gets the attribute.
 */
export const AUTH_COOKIE_OPTIONS: CookieOptionsWithName = {
  secure: process.env.NODE_ENV === 'production',
}
