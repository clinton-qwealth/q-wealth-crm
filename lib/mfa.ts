import { createSupabaseServerClient } from '@/lib/supabase/server'

export type MfaState = {
  /** Assurance level of the current session: 'aal1' password only, 'aal2' second factor verified. */
  currentLevel: string | null
  /** The level this user *could* reach. 'aal2' means they have a verified factor. */
  nextLevel: string | null
  /** True when the session is one factor short of what this user has enrolled. */
  stepUpRequired: boolean
  /** True when a verified factor exists at all. */
  enrolled: boolean
}

/**
 * Where the caller sits on the MFA ladder.
 *
 * Supabase has no global "require MFA" switch. `nextLevel` is 'aal2' only when
 * the user has a verified factor, so comparing it against `currentLevel` is how
 * you detect "this person has MFA and has not used it yet this session".
 */
export async function getMfaState(): Promise<MfaState> {
  const supabase = await createSupabaseServerClient({ writable: false })
  const { data, error } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel()

  if (error || !data) {
    return { currentLevel: null, nextLevel: null, stepUpRequired: false, enrolled: false }
  }
  const enrolled = data.nextLevel === 'aal2'
  return {
    currentLevel: data.currentLevel,
    nextLevel: data.nextLevel,
    enrolled,
    stepUpRequired: enrolled && data.currentLevel === 'aal1',
  }
}
