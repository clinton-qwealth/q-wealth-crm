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
      'id, full_name, email, status, access_profiles(name, view_all_groups, view_sensitive, manage_groups, manage_staff, file_unmatched_notes)'
    )
    .eq('auth_user_id', user.id)
    .maybeSingle()

  if (error || !data) return null
  const staff = data as unknown as Staff
  return staff.status === 'active' ? staff : null
}
