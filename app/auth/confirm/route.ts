import { NextResponse } from 'next/server'
import type { EmailOtpType } from '@supabase/supabase-js'
import { createSupabaseServerClient } from '@/lib/supabase/server'

/**
 * The confirmation link's landing. The email template points here with a
 * token hash rather than a PKCE code, so the link works when opened in a
 * different browser from the one that signed up — a phone reading its email,
 * say. `verifyOtp` sets the session cookie; the request page then asks for
 * the name and creates the pending row.
 */
export async function GET(request: Request) {
  const url = new URL(request.url)
  const tokenHash = url.searchParams.get('token_hash')
  const type = url.searchParams.get('type') as EmailOtpType | null

  if (tokenHash && type) {
    const supabase = await createSupabaseServerClient()
    const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash })
    if (!error) return NextResponse.redirect(new URL('/request-access', url.origin))
  }
  return NextResponse.redirect(new URL('/login?error=confirm', url.origin))
}
