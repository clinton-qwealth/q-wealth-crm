import { NextResponse, type NextRequest } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from '@/lib/env'

/**
 * Proxy — called Middleware before Next.js 16.
 *
 * Two jobs, deliberately no more:
 *
 *  1. Refresh the Supabase session cookie. Access tokens are short-lived, and
 *     Server Components cannot write cookies, so without this the session dies
 *     mid-visit.
 *  2. An optimistic redirect for visitors with no VERIFIABLE session at all.
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
const PUBLIC_PATHS = ['/login', '/auth', '/oauth/consent']

export async function proxy(request: NextRequest) {
  const t0 = performance.now()
  let response = NextResponse.next({ request })

  const supabase = createServerClient(
    SUPABASE_URL(),
    SUPABASE_PUBLISHABLE_KEY(),
    {
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
    return redirect
  }

  response.headers.set('Server-Timing', timing)
  return response
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)'],
}
