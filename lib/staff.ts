import { cache } from 'react'
import { createSupabaseServerClient } from '@/lib/supabase/server'

export type AccessProfile = {
  name: string
  view_all_groups: boolean
  view_sensitive: boolean
  manage_groups: boolean
  manage_staff: boolean
  file_unmatched_notes: boolean
  /** Added to the profile on 3 Sep; reached the app's type on 19 Sep with the Administration page. */
  verify_identity: boolean
}

export type Staff = {
  id: string
  /** Split out of `full_name` on 19 Sep 2026. Compose with `fullName()` from lib/staff-name. */
  first_name: string
  last_name: string
  email: string
  status: string
  /** Object path of their photo in the staff-avatars bucket, or null. See lib/avatar.ts. */
  avatar_path: string | null
  access_profiles: AccessProfile
}

/**
 * The authoritative "who is this, and are they staff" check.
 *
 * Being signed in is not the same as being staff. Supabase Auth will happily
 * issue a session to any account that exists; every RLS policy additionally
 * requires an active row in staff_users. This is the app-side mirror of that
 * rule, so a non-staff session is stopped at the door instead of reaching a
 * screen that silently shows nothing.
 *
 * Filters on auth_user_id deliberately. staff_users is readable for your own
 * row (or by manage_staff), so an unfiltered query would not reliably return
 * the caller — the bug that broke the MCP server's add_note in August.
 *
 * Memoised for the life of one request. The shell layout and the page inside it
 * both need the current staff member; without this the staff_users select is
 * paid twice on a hard navigation, and again on the re-render that follows
 * every save. It does NOT help a tab click: the shell layout segment is
 * unchanged on a soft navigation so it does not re-execute, and the page's
 * call is the first in a fresh cache scope. That is why the auth step itself
 * has to be cheap — see below.
 *
 * **One round trip, not two, since 10 September.** This used to call
 * `auth.getUser()` — a network call to GoTrue on every page render, ~170ms —
 * before the staff_users select. It now calls `getClaims()`, which verifies the
 * ES256 token locally against a process-wide JWKS cache (~1ms warm) and yields
 * the same `sub`. Two route handlers made this switch first, for the same
 * reason; the reasoning is at their call sites and on proxy.ts.
 *
 * **What that gives up, stated plainly for whoever reads this next.** GoTrue is
 * no longer asked whether the session still exists, so a session revoked in
 * Supabase — "sign out everywhere", or a banned account — stays usable in the
 * web app until its access token expires (one JWT lifetime). Postgres evaluates
 * the token the same way, so the app now has the database's own view of
 * validity rather than a stricter one. **To remove somebody NOW, set their
 * staff_users.status to anything but 'active'**: this function re-reads that
 * row on every request, and every RLS policy requires it, so that lock-out is
 * instant everywhere.
 *
 * With no session `getClaims()` returns null data and no error, so the gate is
 * on `sub`, never on `error`.
 */
export const getCurrentStaff = cache(async (): Promise<Staff | null> => {
  const supabase = await createSupabaseServerClient({ writable: false })

  const { data: verified } = await supabase.auth.getClaims()
  const sub = verified?.claims.sub
  if (!sub) return null

  const { data, error } = await supabase
    .from('staff_users')
    .select(
      'id, first_name, last_name, email, status, avatar_path, staff_access_assignments(access_profiles(name, view_all_groups, view_sensitive, manage_groups, manage_staff, file_unmatched_notes, verify_identity))'
    )
    .eq('auth_user_id', sub)
    .maybeSingle()

  if (error || !data) return null

  // The profile is reached through staff_access_assignments: profile_id was moved
  // out of staff_users so staff identity could be readable by colleagues while the
  // permission mapping stayed restricted. The assignment is to-one, so PostgREST
  // returns an object; an array is tolerated in case that changes.
  const row = data as Record<string, unknown>
  const raw = row.staff_access_assignments
  const assignment = (Array.isArray(raw) ? raw[0] : raw) as
    | { access_profiles?: AccessProfile }
    | null
    | undefined
  const profile = assignment?.access_profiles
  if (!profile) return null
  if (row.status !== 'active') return null

  return {
    id: row.id as string,
    first_name: row.first_name as string,
    last_name: row.last_name as string,
    email: row.email as string,
    status: row.status as string,
    avatar_path: (row.avatar_path as string | null) ?? null,
    access_profiles: profile,
  }
})

/**
 * Who is signed in, whether or not they are staff — the question the request
 * page and the consent screen ask when `getCurrentStaff()` says null.
 *
 * `getCurrentStaff()`'s contract is unchanged: null for anything that is not an
 * active staff member with a profile. This reads the same row through the same
 * client and reports what is actually there: no row (a stranger who signed up),
 * a pending row (asked, not yet approved), or an inactive one. A pending person
 * can read their own row because `staff_read_own_row` says so; that policy is
 * the only reason this can be an ordinary select.
 *
 * The name comes from the sign-up form via user metadata in the claims, so the
 * request form can be prefilled. It is a suggestion; the function that writes
 * the row takes what the person submits.
 */
export type Registration =
  | { signedIn: false }
  | {
      signedIn: true
      email: string | null
      /** Prefill for the request form. Either half may be empty. */
      suggested: { first_name: string; last_name: string }
      row: { id: string; first_name: string; last_name: string; email: string; status: string } | null
    }

/**
 * Read a suggested name out of the auth account's own metadata.
 *
 * **This is the one place `full_name` legitimately survives the split.**
 * `user_metadata` belongs to Supabase Auth, not to us: accounts created before
 * 19 September 2026 carry a `full_name` key we cannot rewrite, and an OAuth
 * provider may supply `given_name` / `family_name` of its own. So all three
 * shapes are accepted, newest first, and the whole thing is a hint anyway — the
 * database takes what the person actually types.
 */
function suggestedFrom(meta: Record<string, unknown> | undefined): { first_name: string; last_name: string } {
  const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '')
  const first = str(meta?.first_name) || str(meta?.given_name)
  const last = str(meta?.last_name) || str(meta?.family_name)
  if (first || last) return { first_name: first, last_name: last }

  // The pre-split shape, and whatever a provider called it.
  const whole = str(meta?.full_name) || str(meta?.name)
  if (!whole) return { first_name: '', last_name: '' }
  const words = whole.split(/\s+/).filter(Boolean)
  if (words.length < 2) return { first_name: whole, last_name: '' }
  return { first_name: words.slice(0, -1).join(' '), last_name: words[words.length - 1]! }
}

export const getRegistration = cache(async (): Promise<Registration> => {
  const supabase = await createSupabaseServerClient({ writable: false })
  const { data: verified } = await supabase.auth.getClaims()
  const claims = verified?.claims as
    | { sub?: string; email?: string; user_metadata?: Record<string, unknown> }
    | undefined
  if (!claims?.sub) return { signedIn: false }

  const { data } = await supabase
    .from('staff_users')
    .select('id, first_name, last_name, email, status')
    .eq('auth_user_id', claims.sub)
    .maybeSingle()

  return {
    signedIn: true,
    email: claims.email ?? null,
    suggested: suggestedFrom(claims.user_metadata),
    row: data
      ? {
          id: data.id as string,
          first_name: data.first_name as string,
          last_name: data.last_name as string,
          email: data.email as string,
          status: data.status as string,
        }
      : null,
  }
})
