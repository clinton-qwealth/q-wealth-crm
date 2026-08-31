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
 */
export async function getCurrentStaff(): Promise<Staff | null> {
  const supabase = await createSupabaseServerClient({ writable: false })

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return null

  const { data, error } = await supabase
    .from('staff_users')
    .select(
      'id, full_name, email, status, staff_access_assignments(access_profiles(name, view_all_groups, view_sensitive, manage_groups, manage_staff, file_unmatched_notes))'
    )
    .eq('auth_user_id', user.id)
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
}
