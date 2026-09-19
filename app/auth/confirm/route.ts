import { NextResponse } from 'next/server'
import type { EmailOtpType } from '@supabase/supabase-js'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { suggestedName } from '@/lib/staff'

/**
 * The confirmation link's landing, and since 20 September 2026 the step that
 * finishes a registration.
 *
 * The email template points here with a token hash rather than a PKCE code, so
 * the link works when opened in a different browser from the one that signed up
 * — a phone reading its email, say. `verifyOtp` sets the session cookie.
 *
 * ## Why a GET writes to the database
 *
 * Unusual, and deliberate. `request_staff_access()` refuses to create a pending
 * row until `auth.users.email_confirmed_at` is set, which is the whole point —
 * it is what stops somebody registering under a colleague's address. **The first
 * instant it can succeed is this one.** Asking for the name again on the next
 * screen, when the account already carries it, was a step that existed only
 * because nothing called the function here.
 *
 * Two things make the write safe rather than merely convenient:
 *
 * - `staff_users.auth_user_id` is `uuid unique` (migration 20260704061817).
 *   The function reads then inserts without a lock, so that constraint — not the
 *   function's own `if found` branch — is what turns a concurrent double-submit
 *   into one row and a clean refusal, rather than two pending rows and a
 *   `maybeSingle()` that errors for that person forever.
 * - A confirmation token is single-use, so a second visit never reaches the RPC
 *   at all: `verifyOtp` fails first.
 *
 * ## Re-following a spent link is harmless, and that is a fix
 *
 * This route is a GET a browser may request again freely — a second click, a
 * reload, a back button, an email client unfurling the URL. Until 20 September
 * every failure redirected to `/login?error=confirm`, **including when the
 * caller already held the session the first visit had just created**. Production
 * logs for 19 September show exactly that: `verifyOtp` succeeded at 14:21:09,
 * the request page loaded with a live session a second later, three more
 * requests arrived over the next twenty seconds and each got `otp_expired`, and
 * the person was then bounced to a bare sign-in form and typed their password
 * again. That was the "login screen" in the middle of joining.
 *
 * So a spent token is now judged by what the caller already has, not by the
 * token alone.
 */
export async function GET(request: Request) {
  const url = new URL(request.url)
  const tokenHash = url.searchParams.get('token_hash')
  const type = url.searchParams.get('type') as EmailOtpType | null

  const requestAccess = () => NextResponse.redirect(new URL('/request-access', url.origin))

  // Nobody followed a link. There is no expiry to explain, so no error is claimed.
  if (!tokenHash || !type) return NextResponse.redirect(new URL('/login', url.origin))

  /* ONE client for the whole request. `verifyOtp` writes the session into this
     object's cookie jar; a second `createSupabaseServerClient()` would read the
     jar as it stood when the request arrived, find nothing, and the RPC below
     would raise 'Not signed in' — silently, for everybody, forever. */
  const supabase = await createSupabaseServerClient()
  const { data, error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash })

  if (error) {
    /* Spent, expired, or already used. If they are signed in regardless, the
       work this link existed to do is already done — send them on rather than
       throwing away a good session. */
    const { data: claims } = await supabase.auth.getClaims()
    if (claims?.claims?.sub) return requestAccess()
    return NextResponse.redirect(new URL('/login?error=confirm', url.origin))
  }

  /* Only a sign-up confirmation asks to join. A password recovery or an email
     change lands here too and must not create a staff record. */
  if (type === 'signup') {
    const name = suggestedName(data.user?.user_metadata)
    if (name.first_name && name.last_name) {
      const { error: rpcError } = await supabase.rpc('request_staff_access', {
        p_first_name: name.first_name,
        p_last_name: name.last_name,
      })
      if (rpcError) {
        /* Swallowed for the person, not for us. They land on the request form,
           prefilled, and pressing its button produces this same sentence from
           this same function — so nobody is stranded and no database text is
           reflected into a URL. But a wiring fault here would otherwise be
           invisible everywhere, so it is logged. The auth id, never the email. */
        console.error(
          JSON.stringify({
            event: 'request_staff_access_failed',
            auth_user_id: data.user?.id ?? null,
            code: rpcError.code ?? null,
            message: rpcError.message,
          })
        )
      }
    }
  }

  return requestAccess()
}
