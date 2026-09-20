import { createSupabaseServerClient } from '@/lib/supabase/server'
import { privateDateOfBirth } from '@/lib/staff-private'
import { fullName } from '@/lib/staff-name'
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
    .select('id, first_name, last_name, status')
    // Surname first, as a directory reads. The ORDER IS THE DATABASE'S, not the
    // component's: sorting here would sort one page of rows rather than the set.
    .order('last_name')
    .order('first_name')
  if (error) throw new Error(`The staff directory could not be read: ${error.message}`)
  return (data ?? []).map((s) => ({
    id: s.id as string,
    name: fullName({ first_name: s.first_name as string, last_name: s.last_name as string }),
    status: s.status as string,
  }))
}

export type StaffRow = {
  id: string
  first_name: string
  last_name: string
  email: string
  status: string
  avatar_path: string | null
  /** When the row was made — for a pending request, when the person asked. */
  created_at: string
  /** Per person since 20 Sep 2026; toggled in the drawer's Access box. */
  verify_identity: boolean
  /** Optional salutation. Since 20 Sep 2026. */
  title: string | null
  /** `YYYY-MM-DD` or null, from staff_private_details — administrators may read every row. */
  date_of_birth: string | null
  /**
   * The later of their last sign-in and their newest session's refresh, as an
   * instant — or null for somebody who has never signed in. Not a plain
   * sign-in time: a person working all afternoon stops signing in but keeps
   * refreshing. See `staff_last_seen()`.
   */
  last_seen_at: string | null
  /** Holds a session they have not given up. The Staff tab says "Signed in". */
  signed_in: boolean
  profile: { id: string; name: string } | null
  /**
   * Sees only households in their own user groups (plus unassigned ones, plus
   * anything owned or granted). Per person since 20 Sep 2026 — membership
   * grants, this restricts. See `lib/user-groups.ts`.
   */
  limited_to_user_groups: boolean
  /** The user groups (territories) this person belongs to, by name. */
  user_groups: { id: string; name: string; status: string }[]
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
  /* Two reads, ONE wave. `staff_last_seen()` reaches auth.users, which PostgREST
     does not serve, so it cannot be an embed on the select above — but it must
     not become a second round trip either, or the page's depth-1 test fails.
     Issued together and joined in memory. */
  const [{ data, error }, { data: seen }] = await Promise.all([
    supabase
      .from('staff_users')
      .select('id, first_name, last_name, title, email, status, avatar_path, created_at, verify_identity, limited_to_user_groups, staff_private_details(date_of_birth), staff_access_assignments(profile_id, access_profiles(id, name)), user_group_members(user_groups(id, name, status))')
      .order('last_name')
      .order('first_name'),
    supabase.rpc('staff_last_seen'),
  ])
  if (error) throw new Error(`The staff list could not be read: ${error.message}`)

  /* A caller without manage_staff gets zero rows from the function rather than
     an error, so an absent entry is "not told", which reads as never seen. */
  const activity = new Map(
    ((seen ?? []) as { staff_id: string; last_seen_at: string | null; has_live_session: boolean }[]).map((r) => [
      r.staff_id,
      r,
    ]),
  )
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
      first_name: row.first_name as string,
      last_name: row.last_name as string,
      email: row.email as string,
      status: row.status as string,
      avatar_path: (row.avatar_path as string | null) ?? null,
      created_at: row.created_at as string,
      verify_identity: row.verify_identity === true,
      title: (row.title as string | null) ?? null,
      date_of_birth: privateDateOfBirth(row.staff_private_details),
      last_seen_at: activity.get(row.id as string)?.last_seen_at ?? null,
      signed_in: activity.get(row.id as string)?.has_live_session === true,
      profile: profile ? { id: profile.id, name: profile.name } : null,
      limited_to_user_groups: row.limited_to_user_groups === true,
      user_groups: embeddedUserGroups(row.user_group_members),
    }
  })
}

/**
 * The user groups embedded on a person's row, flattened and named.
 *
 * `user_group_members(user_groups(id, name, status))` arrives as a list of
 * membership rows each carrying one group — an object, or an array should
 * relationship detection ever change. Sorted HERE, by name, which is the one
 * place the "ordering belongs in the query" rule cannot reach: PostgREST does
 * not order a to-many embed by the embedded table's column.
 */
function embeddedUserGroups(raw: unknown): { id: string; name: string; status: string }[] {
  if (!Array.isArray(raw)) return []
  const groups: { id: string; name: string; status: string }[] = []
  for (const m of raw as { user_groups?: unknown }[]) {
    const g = m?.user_groups
    const one = (Array.isArray(g) ? g[0] : g) as { id?: string; name?: string; status?: string } | null | undefined
    if (one?.id && typeof one.name === 'string') groups.push({ id: one.id, name: one.name, status: one.status ?? 'active' })
  }
  return groups.sort((a, b) => a.name.localeCompare(b.name))
}

/** One user group (territory) as the User groups tab lists it. */
export type UserGroupRow = {
  id: string
  name: string
  status: string
  created_at: string
  /** Everyone the table says, whatever their status — the picker offers active people only. */
  members: { id: string; name: string }[]
  /** Households assigned to this group, as the administrator can see them. */
  household_count: number
}

/**
 * Every user group, with its members and how many households it holds, for
 * the User groups tab. Archived groups are listed on purpose — they can be
 * reactivated from here, and their members are still theirs.
 *
 * ONE read. The members come as an embed through `user_group_members`, the
 * household count as an embed of ids from `client_groups` — not an aggregate,
 * which PostgREST does not serve here — so the tab joins the page's single
 * wave rather than adding one. Throws on error, like every reader here.
 */
export async function getUserGroupsForAdmin(): Promise<UserGroupRow[]> {
  const supabase = await createSupabaseServerClient({ writable: false })
  const { data, error } = await supabase
    .from('user_groups')
    .select('id, name, status, created_at, user_group_members(staff_users(id, first_name, last_name)), client_groups(id)')
    .order('name')
  if (error) throw new Error(`The user groups could not be read: ${error.message}`)
  return (data ?? []).map((r) => {
    const row = r as Record<string, unknown>
    const memberRows = Array.isArray(row.user_group_members) ? (row.user_group_members as { staff_users?: unknown }[]) : []
    const members = memberRows
      .map((m) => {
        const s = m?.staff_users
        const one = (Array.isArray(s) ? s[0] : s) as { id?: string; first_name?: string; last_name?: string } | null | undefined
        return one?.id ? { id: one.id, name: fullName({ first_name: one.first_name ?? '', last_name: one.last_name ?? '' }) } : null
      })
      .filter((m): m is { id: string; name: string } => m !== null)
      .sort((a, b) => a.name.localeCompare(b.name))
    const households = Array.isArray(row.client_groups) ? row.client_groups.length : 0
    return {
      id: row.id as string,
      name: row.name as string,
      status: row.status as string,
      created_at: row.created_at as string,
      members,
      household_count: households,
    }
  })
}

/** The profiles an administrator may assign, with what each permits. */
export async function getAccessProfiles(): Promise<AccessProfileChoice[]> {
  const supabase = await createSupabaseServerClient({ writable: false })
  const { data, error } = await supabase
    .from('access_profiles')
    .select('id, name, description, view_all_groups, view_sensitive, manage_groups, manage_staff, file_unmatched_notes')
    .order('name')
  if (error) throw new Error(`The access profiles could not be read: ${error.message}`)
  return (data ?? []) as unknown as AccessProfileChoice[]
}
