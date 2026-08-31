'use server'

import { redirect } from 'next/navigation'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { safeNext } from '@/lib/safe-next'

export type LoginState = { error: string } | null

export async function signIn(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const email = String(formData.get('email') ?? '').trim()
  const password = String(formData.get('password') ?? '')
  const next = safeNext(formData.get('next'))

  if (!email || !password) {
    return { error: 'Enter your email address and password.' }
  }

  const supabase = await createSupabaseServerClient()
  const { error } = await supabase.auth.signInWithPassword({ email, password })

  if (error) {
    // Deliberately not distinguishing "no such account" from "wrong password":
    // that difference tells an attacker which addresses are real.
    return { error: 'Those details did not match an account.' }
  }

  redirect(next)
}
