import { createSupabaseServerClient } from '@/lib/supabase/server'
import type { Staff } from '@/lib/staff'
import type { AuditActor, AuditCursor, AuditEntry, AuditFilters } from '@/lib/audit'

/**
 * The Administration page's readers.
 *
 * ## Who may use the page
 *
 * `manage_staff`, the Admin profile's flag. In the database
 * `current_staff_has('admin')` is an alias for it, and it is what the audit
 * table's own read policy checks — so the page and the rows it reads answer
 * the same question. Named here rather than in `lib/staff.ts`, which the
 * round-trip tests mock wholesale.
 */
export function isAdmin(staff: Staff): boolean {
  return staff.access_profiles.manage_staff
}

export const AUDIT_PAGE_SIZE = 50

const COLUMNS =
  'id, occurred_at, table_name, record_id, action, changed_fields, old_data, new_data, ' +
  'actor_staff_id, actor_context, actor_name, record_label'

/**
 * One page of the trail, newest first.
 *
 * Reads `audit_entries`, the view that names the actor and recovers the
 * record's label; RLS on `audit_log` beneath it decides who sees anything.
 * Fetches one row more than the page so `hasMore` is a fact rather than a
 * count query. Keyset on `(occurred_at, id)`, both descending, because two
 * rows can share an instant and `id` is the identity that orders them.
 *
 * Throws on error. A trail that quietly showed nothing would be the worst
 * possible lie for this screen — the same rule every reader here follows.
 */
export async function getAuditEntries({
  filters = {},
  before = null,
  limit = AUDIT_PAGE_SIZE,
}: {
  filters?: AuditFilters
  before?: AuditCursor | null
  limit?: number
} = {}): Promise<{ entries: AuditEntry[]; hasMore: boolean }> {
  const supabase = await createSupabaseServerClient({ writable: false })
  let q = supabase.from('audit_entries').select(COLUMNS)
  if (filters.table) q = q.eq('table_name', filters.table)
  if (filters.action) q = q.eq('action', filters.action)
  if (filters.actor === 'system') q = q.is('actor_staff_id', null)
  else if (filters.actor) q = q.eq('actor_staff_id', filters.actor)
  if (filters.from) q = q.gte('occurred_at', filters.from)
  if (filters.to) q = q.lt('occurred_at', filters.to)
  if (before) {
    q = q.or(
      `occurred_at.lt.${before.occurred_at},and(occurred_at.eq.${before.occurred_at},id.lt.${before.id})`,
    )
  }
  const { data, error } = await q
    .order('occurred_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(limit + 1)
  if (error) throw new Error(`The audit trail could not be read: ${error.message}`)
  const rows = (data ?? []) as unknown as AuditEntry[]
  return { entries: rows.slice(0, limit), hasMore: rows.length > limit }
}

/**
 * Everyone who could have made a change: all statuses, on purpose. A former
 * adviser's edits are still theirs, and the filter should be able to find them.
 */
export async function getAuditActors(): Promise<AuditActor[]> {
  const supabase = await createSupabaseServerClient({ writable: false })
  const { data, error } = await supabase
    .from('staff_directory')
    .select('id, full_name, status')
    .order('full_name')
  if (error) throw new Error(`The staff directory could not be read: ${error.message}`)
  return (data ?? []).map((s) => ({ id: s.id as string, name: s.full_name as string, status: s.status as string }))
}

export type StaffRow = {
  id: string
  full_name: string
  email: string
  status: string
  avatar_path: string | null
  /** When the row was made — for a pending request, when the person asked. */
  created_at: string
  profile: { id: string; name: string } | null
}

export type AccessProfileChoice = {
  id: string
  name: string
  description: string | null
  view_all_groups: boolean
  view_sensitive: boolean
  manage_groups: boolean
  manage_staff: boolean
  file_unmatched_notes: boolean
  verify_identity: boolean
}

/**
 * Everyone on the staff, with their profile, for the Staff tab. Reads the
 * base table rather than the directory: the directory carries no profile,
 * and the base table's policy admits an administrator. Inactive people are
 * listed on purpose — notes reference their authors forever. Pending people
 * come back too, since 19 September: the Staff tab shows them as the queue
 * awaiting approval, so no second read is needed for the count.
 */
export async function getStaffForAdmin(): Promise<StaffRow[]> {
  const supabase = await createSupabaseServerClient({ writable: false })
  const { data, error } = await supabase
    .from('staff_users')
    .select('id, full_name, email, status, avatar_path, created_at, staff_access_assignments(profile_id, access_profiles(id, name))')
    .order('full_name')
  if (error) throw new Error(`The staff list could not be read: ${error.message}`)
  return (data ?? []).map((r) => {
    const row = r as Record<string, unknown>
    const raw = row.staff_access_assignments
    const assignment = (Array.isArray(raw) ? raw[0] : raw) as
      | { access_profiles?: { id: string; name: string } | { id: string; name: string }[] | null }
      | null
      | undefined
    const ap = assignment?.access_profiles
    const profile = (Array.isArray(ap) ? ap[0] : ap) ?? null
    return {
      id: row.id as string,
      full_name: row.full_name as string,
      email: row.email as string,
      status: row.status as string,
      avatar_path: (row.avatar_path as string | null) ?? null,
      created_at: row.created_at as string,
      profile: profile ? { id: profile.id, name: profile.name } : null,
    }
  })
}

/** The profiles an administrator may assign, with what each permits. */
export async function getAccessProfiles(): Promise<AccessProfileChoice[]> {
  const supabase = await createSupabaseServerClient({ writable: false })
  const { data, error } = await supabase
    .from('access_profiles')
    .select('id, name, description, view_all_groups, view_sensitive, manage_groups, manage_staff, file_unmatched_notes, verify_identity')
    .order('name')
  if (error) throw new Error(`The access profiles could not be read: ${error.message}`)
  return (data ?? []) as unknown as AccessProfileChoice[]
}
