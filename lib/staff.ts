import { cache } from 'react'
import { createSupabaseServerClient } from '@/lib/supabase/server'

export type AccessProfile = {
  name: string
  view_all_groups: boolean
  view_sensitive: boolean
  manage_groups: boolean
  manage_staff: boolean
  file_unmatched_notes: boolean
}

export type Staff = {
  id: string
  full_name: string
  email: string
  status: string
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
      'id, full_name, email, status, staff_access_assignments(access_profiles(name, view_all_groups, view_sensitive, manage_groups, manage_staff, file_unmatched_notes))'
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
    full_name: row.full_name as string,
    email: row.email as string,
    status: row.status as string,
    access_profiles: profile,
  }
})
