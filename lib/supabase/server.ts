import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from '@/lib/env'

/**
 * Server Supabase client, bound to the request's cookies.
 *
 * `cookies()` is async in this version of Next, so this function is too.
 *
 * Pass `writable: false` from a Server Component. Server Components cannot set
 * cookies, and @supabase/ssr will attempt to when it refreshes a token; the
 * no-op setter keeps that from throwing. Server Actions and Route Handlers can
 * write, so they should leave it at the default.
 */
export async function createSupabaseServerClient({ writable = true } = {}) {
  const cookieStore = await cookies()

  return createServerClient(
    SUPABASE_URL(),
    SUPABASE_PUBLISHABLE_KEY(),
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet) {
          if (!writable) return
          try {
            for (const { name, value, options } of cookiesToSet) {
              cookieStore.set(name, value, options)
            }
          } catch {
            // Called from a context that cannot set cookies. Token refresh is
            // handled in proxy.ts, so ignoring this is safe.
          }
        },
      },
    }
  )
}
