import { createBrowserClient } from '@supabase/ssr'

/**
 * Browser Supabase client.
 *
 * Uses the publishable key and the signed-in user's session, so every request
 * is evaluated by RLS as that staff member. The service-role key is never used
 * anywhere in this app: is_elevated_context() treats it as a bypass of every
 * permission check, including sensitive-field access.
 */
export function createSupabaseBrowserClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!
  )
}
