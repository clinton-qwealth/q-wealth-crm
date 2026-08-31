import { NextResponse, type NextRequest } from 'next/server'
import { createServerClient } from '@supabase/ssr'

/**
 * Proxy — called Middleware before Next.js 16.
 *
 * Two jobs, deliberately no more:
 *
 *  1. Refresh the Supabase session cookie. Access tokens are short-lived, and
 *     Server Components cannot write cookies, so without this the session dies
 *     mid-visit.
 *  2. An optimistic redirect for visitors with no session at all.
 *
 * It is NOT the authorisation boundary. Next's own guidance is that proxy runs
 * on every request including prefetches, so it should not make database calls;
 * the real check is getCurrentStaff() in each page, and behind that, RLS in
 * Postgres. Anything that matters is enforced in the database.
 */

// Reachable without a session. /oauth/consent is public on purpose: it needs to
// receive Supabase's redirect and then bounce to login itself, preserving the
// authorization_id it was called with.
const PUBLIC_PATHS = ['/login', '/auth', '/oauth/consent']

export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
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

  // Refreshes the token and rewrites the cookie via setAll above.
  const {
    data: { user },
  } = await supabase.auth.getUser()

  const path = request.nextUrl.pathname
  const isPublic = PUBLIC_PATHS.some((p) => path === p || path.startsWith(`${p}/`))

  if (!user && !isPublic) {
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    // Send them back where they were headed once they have signed in.
    url.searchParams.set('next', path + request.nextUrl.search)
    return NextResponse.redirect(url)
  }

  return response
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)'],
}
