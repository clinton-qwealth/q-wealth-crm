import { NextResponse, type NextRequest } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from '@/lib/env'
import { AUTH_COOKIE_OPTIONS } from '@/lib/supabase/cookies'
import { contentSecurityPolicy } from '@/lib/csp'

/**
 * Proxy — called Middleware before Next.js 16.
 *
 * Two jobs, deliberately no more:
 *
 *  1. Refresh the Supabase session cookie. Access tokens are short-lived, and
 *     Server Components cannot write cookies, so without this the session dies
 *     mid-visit.
 *  2. An optimistic redirect for visitors with no VERIFIABLE session at all.
 *  3. A per-request CSP nonce. This is the only place it can be made: the
 *     policy has to differ on every response, and a config file is read once at
 *     build.
 *
 *     NEXT READS THE NONCE OFF THE RESPONSE HEADER SET HERE, and stamps it onto
 *     every script tag it emits. That was MEASURED on 16.3.4, not taken from
 *     the documentation: the widely-copied recipe also copies the policy onto
 *     the REQUEST headers, and on this version that copy changes nothing — the
 *     nonce in the header and the nonce on the tags match either way. So it is
 *     not done, because a line that does nothing is a line the next reader has
 *     to disprove. If a future version ever stops matching them the page breaks
 *     loudly rather than silently, and `e2e/security-headers.spec.ts` compares
 *     the two directly.
 *
 * It is NOT the authorisation boundary. Next's own guidance is that proxy runs
 * on every request including prefetches, so it should not make database calls;
 * the real check is getCurrentStaff() in each page, and behind that, RLS in
 * Postgres. Anything that matters is enforced in the database.
 *
 * **Until 10 September it made a network call anyway.** `auth.getUser()` asks
 * GoTrue over HTTP on every request that has a cookie — ~170ms from this
 * region, ~120ms of it fixed platform overhead — and this runs on every RSC
 * navigation and every one of the four nav-link prefetches on every page load.
 * It was the first of three sequential round trips a tab click paid before any
 * page data. It is now `getClaims()`, which verifies the token locally; see the
 * note at the call.
 */

// Reachable without a session. /oauth/consent is public on purpose: it needs to
// receive Supabase's redirect and then bounce to login itself, preserving the
// authorization_id it was called with.
const PUBLIC_PATHS = ['/login', '/auth', '/oauth/consent', '/request-access']

export async function proxy(request: NextRequest) {
  const t0 = performance.now()

  /* 128 bits from the platform CSPRNG, base64. A nonce that repeats, or that an
     attacker can predict, is a nonce that authorises their injected script. */
  const nonce = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(16))))
  const csp = contentSecurityPolicy({
    nonce,
    supabaseUrl: SUPABASE_URL(),
    production: process.env.NODE_ENV === 'production',
  })

  let response = NextResponse.next({ request })

  const supabase = createServerClient(
    SUPABASE_URL(),
    SUPABASE_PUBLISHABLE_KEY(),
    {
      cookieOptions: AUTH_COOKIE_OPTIONS,
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          for (const { name, value } of cookiesToSet) {
            request.cookies.set(name, value)
          }
          response = NextResponse.next({ request })
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options)
          }
        },
      },
    }
  )

  /*
   * getClaims(), not getUser().
   *
   * This project signs tokens with ES256 and publishes a JWKS, so getClaims()
   * verifies the signature LOCALLY with WebCrypto against a key cached for ten
   * minutes per function instance: about 10ms warm, one JWKS fetch on a cold
   * instance. getUser() was a round trip to GoTrue every time. Two route
   * handlers made this switch first, with the same reasoning, in
   * app/api/address/route.ts and app/api/post-media/[id]/route.ts.
   *
   * It still goes through getSession() first, so the refresh-on-expiry that
   * rewrites the cookie via setAll above is preserved — job 1 is unchanged.
   *
   * What it gives up: GoTrue is no longer asked whether the session still
   * exists. A banned account, or a "sign out everywhere", keeps a valid token
   * until that token expires. The database evaluates the same token the same
   * way — signature and expiry, then RLS — so this is the view of validity RLS
   * already had; the app is no longer stricter than the thing it defers to.
   * The instant lock-out is staff_users.status, which every page re-reads. If
   * the project ever moved to a symmetric key, this would silently fall back to
   * getUser(): slower, not broken.
   *
   * NOTE THE SHAPE: with no session at all this returns { data: null, error:
   * null } — no error. The gate below is on MISSING CLAIMS, deliberately. A
   * gate on `error` would wave every anonymous visitor through.
   */
  const { data: verified } = await supabase.auth.getClaims()
  const claims = verified?.claims

  /* The one place a header can be set on the page path: Server Components
     cannot set response headers, and a streamed page has sent them before it
     runs. This is the before/after a person can read in devtools. */
  const timing = `auth;dur=${(performance.now() - t0).toFixed(1)};desc="claims"`

  const path = request.nextUrl.pathname
  const isPublic = PUBLIC_PATHS.some((p) => path === p || path.startsWith(`${p}/`))

  if (!claims && !isPublic) {
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    // Send them back where they were headed once they have signed in.
    url.searchParams.set('next', path + request.nextUrl.search)
    const redirect = NextResponse.redirect(url)
    redirect.headers.set('Server-Timing', timing)
    redirect.headers.set('Content-Security-Policy', csp)
    return redirect
  }

  response.headers.set('Server-Timing', timing)
  response.headers.set('Content-Security-Policy', csp)
  return response
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)'],
}
