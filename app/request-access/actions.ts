'use server'

import { redirect } from 'next/navigation'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { safeNext } from '@/lib/safe-next'

export type RequestState = { error: string } | { ok: true; message: string } | null

/**
 * Create an account. Anon-callable, no secret: `auth.signUp` is Supabase's own
 * front door, and it is switched on in the dashboard with email confirmation.
 *
 * The confirmation email's link is the template's, pointing at
 * `/auth/confirm`, so nothing is passed here for it. Supabase answers an
 * existing address with the same shape as a new one when confirmations are on,
 * and this action says the same thing either way — no enumeration of who has
 * an account.
 */
export async function signUpForAccess(_prev: RequestState, formData: FormData): Promise<RequestState> {
  const email = String(formData.get('email') ?? '').trim().toLowerCase()
  const password = String(formData.get('password') ?? '')
  const firstName = String(formData.get('first_name') ?? '').trim()
  const lastName = String(formData.get('last_name') ?? '').trim()
  if (!email || !password || !firstName || !lastName) {
    return { error: 'Enter your first and last name, your Q Wealth email address and a password.' }
  }
  if (password.length < 12) return { error: 'Use a password of at least 12 characters.' }

  const supabase = await createSupabaseServerClient()
  /* The parts go into Supabase Auth's own user_metadata, which is where the
     request form reads its prefill from. `getRegistration()` still accepts the
     pre-split `full_name` key there, because accounts created before 19 Sep
     2026 carry it and that metadata is not ours to rewrite. */
  const { error } = await supabase.auth.signUp({
    email,
    password,
    options: { data: { first_name: firstName, last_name: lastName } },
  })
  if (error) return { error: error.message }

  return { ok: true, message: `Check ${email} for a confirmation link, then come back here to ask for access.` }
}

/**
 * Ask to join. The database decides: confirmed email, allowed domain, no
 * existing record. On success the page re-renders in its waiting state, or
 * the consent screen the person came from.
 */
export async function requestStaffAccess(_prev: RequestState, formData: FormData): Promise<RequestState> {
  const firstName = String(formData.get('first_name') ?? '').trim()
  const lastName = String(formData.get('last_name') ?? '').trim()
  const next = safeNext(formData.get('next'))
  if (!firstName || !lastName) return { error: 'Enter your first and last name.' }

  const supabase = await createSupabaseServerClient()
  const { error } = await supabase.rpc('request_staff_access', {
    p_first_name: firstName,
    p_last_name: lastName,
  })
  if (error) return { error: error.message }

  redirect(next === '/' ? '/request-access' : next)
}
