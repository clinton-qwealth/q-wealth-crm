'use server'

import { revalidatePath } from 'next/cache'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getAuditEntries } from '@/lib/admin'
import { STAFF_AVATAR_BUCKET } from '@/lib/avatar'
import { TABLE_LABEL, type AuditCursor, type AuditEntry, type AuditFilters } from '@/lib/audit'

export type AuditPage = { entries: AuditEntry[]; hasMore: boolean }
export type AuditPageState = AuditPage | { error: string }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const ACTIONS = new Set(['insert', 'update', 'delete'])

/**
 * The Audit trail tab's one server action: a page of entries for a filter,
 * from a cursor.
 *
 * ## Why an action, and why it checks the second factor
 *
 * A server action rather than the page's `searchParams`: the tab mounts lazily
 * inside client-side `Tabs`, and the page's round-trip test pins one exact
 * wave, so a filter change must not re-run the whole page. Clicks are one at
 * a time, so Next's per-client serialisation of actions does not bite here
 * the way it does for search.
 *
 * It is also a new front door onto client data. RLS on `audit_log` is the
 * authorisation boundary — a non-administrator gets zero rows, not an error —
 * but the shell's MFA gate covers PAGES, and this is not one. So the action
 * asks `getClaims()` for the assurance level, free and local, exactly as the
 * search route does, and refuses anything under `aal2`.
 *
 * Filters are checked for shape before they reach the query: a table name
 * must be one the map knows, an action one of three, an actor a uuid or the
 * word system, a bound a date. Not because PostgREST would misbehave, but
 * because a front door should not forward whatever it was handed.
 */
export async function loadAuditEntries(
  filters: AuditFilters,
  before: AuditCursor | null,
): Promise<AuditPageState> {
  const supabase = await createSupabaseServerClient({ writable: false })
  const { data: verified } = await supabase.auth.getClaims()
  const claims = verified?.claims as { sub?: string; aal?: string } | undefined
  if (!claims?.sub) return { error: 'Not signed in.' }
  if (claims.aal !== 'aal2') return { error: 'A verified second factor is required.' }

  const clean: AuditFilters = {}
  if (filters.table) {
    if (!(filters.table in TABLE_LABEL)) return { error: 'Not a table this trail knows.' }
    clean.table = filters.table
  }
  if (filters.action) {
    if (!ACTIONS.has(filters.action)) return { error: 'Not an action this trail knows.' }
    clean.action = filters.action
  }
  if (filters.actor) {
    if (filters.actor !== 'system' && !UUID.test(filters.actor)) return { error: 'Not a person this trail knows.' }
    clean.actor = filters.actor
  }
  for (const key of ['from', 'to'] as const) {
    const v = filters[key]
    if (v) {
      if (Number.isNaN(new Date(v).getTime())) return { error: 'Not a date.' }
      clean[key] = new Date(v).toISOString()
    }
  }
  if (before && (typeof before.id !== 'number' || Number.isNaN(new Date(before.occurred_at).getTime()))) {
    return { error: 'Not a place in the trail.' }
  }

  try {
    return await getAuditEntries({ filters: clean, before })
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'The audit trail could not be read.' }
  }
}

export type StaffDetailState = { error: string } | { ok: true } | null

const STATUSES = new Set(['active', 'inactive'])

/**
 * Save a staff member's details from the Staff tab's forms.
 *
 * Patch-shaped, like `saveAccountDetails`: KEY PRESENCE is the meaning, so a
 * form carrying only a name leaves everything else alone. Only the eleven keys
 * the database function knows are ever forwarded — anything else on the form
 * is ignored here rather than refused there. Email is trimmed and lowercased
 * before it travels. Every rule lives in the database and its sentences pass
 * through unrewritten; the checks here are the friendlier of two identical
 * answers, not the only one.
 */
export async function saveStaffDetails(_prev: StaffDetailState, formData: FormData): Promise<StaffDetailState> {
  const staffId = String(formData.get('staff_id') ?? '')
  if (!staffId) return { error: 'No staff member selected.' }

  const patch: Record<string, unknown> = {}
  if (formData.has('first_name')) {
    const first = String(formData.get('first_name')).trim()
    if (!first) return { error: 'Enter a first name.' }
    patch.first_name = first
  }
  if (formData.has('last_name')) {
    const last = String(formData.get('last_name')).trim()
    if (!last) return { error: 'Enter a last name.' }
    patch.last_name = last
  }
  /* Optional facts: a present-and-blank value CLEARS, matching the patch
     function's contract — "remove my title" has to be sayable. Sent as null,
     not '', so the database sees one shape for "cleared". */
  if (formData.has('title')) {
    const title = String(formData.get('title')).trim()
    if (title.length > 30) return { error: 'Use 30 characters or fewer for the title.' }
    patch.title = title || null
  }
  if (formData.has('date_of_birth')) {
    const dob = String(formData.get('date_of_birth')).trim()
    if (dob && !/^\d{4}-\d{2}-\d{2}$/.test(dob)) return { error: 'Enter the date of birth as a date.' }
    patch.date_of_birth = dob || null
  }
  if (formData.has('email')) {
    const email = String(formData.get('email')).trim().toLowerCase()
    if (!email) return { error: 'Enter an email address.' }
    patch.email = email
  }
  if (formData.has('status')) {
    const status = String(formData.get('status'))
    if (!STATUSES.has(status)) return { error: 'Choose a status.' }
    patch.status = status
  }
  if (formData.has('profile_id')) {
    const profile = String(formData.get('profile_id'))
    if (!profile) return { error: 'Choose an access profile.' }
    patch.profile_id = profile
  }
  /* A checkbox that is off submits NOTHING, which under key-presence would read
     as "leave it alone" — so opting somebody out would be impossible. The form
     therefore carries a hidden `verify_identity=false` ahead of the checkbox's
     `true`; both arrive when it is on, only the hidden one when it is off, and
     neither when the box is not on the form at all. A real boolean travels,
     because the database refuses anything else. */
  if (formData.has('verify_identity')) {
    patch.verify_identity = formData.getAll('verify_identity').includes('true')
  }
  /* The territory toggle, 20 Sep 2026, in the same three shapes. */
  if (formData.has('limited_to_user_groups')) {
    patch.limited_to_user_groups = formData.getAll('limited_to_user_groups').includes('true')
  }
  /* The person's user groups: a SET, read behind a sentinel, because an
     emptied list and an absent control both come back as `[]` and mean
     opposite things. See `readSet`. */
  const groups = readSet(formData, 'user_group_ids', 'user_groups_present')
  if (groups) {
    if (!groups.every((id) => UUID.test(id))) return { error: 'Choose user groups from the list.' }
    patch.user_group_ids = groups
  }
  if (Object.keys(patch).length === 0) return { error: 'Nothing to save.' }

  const supabase = await createSupabaseServerClient()
  const { error } = await supabase.rpc('update_staff_patch', { p_staff_id: staffId, p_patch: patch })
  if (error) return { error: error.message }

  revalidatePath('/admin')
  /* The person's own profile page shows the same details. */
  revalidatePath('/profile')
  return { ok: true }
}

/**
 * Set or remove a staff member's photo.
 *
 * THE ROW FIRST, THEN THE BYTES — `redactPostMedia`'s ordering. The function
 * validates the new path (it must be under this person's prefix and the object
 * must already exist) and returns the path it REPLACED, if any; only then are
 * those old bytes removed. If the removal fails the row is already right and
 * the orphan is what a sweep collects; the reverse order could leave a row
 * pointing at nothing.
 */
export async function setStaffAvatar(staffId: string, path: string | null): Promise<StaffDetailState> {
  if (!staffId) return { error: 'No staff member selected.' }

  const supabase = await createSupabaseServerClient()
  const { data, error } = await supabase.rpc('update_staff_patch', {
    p_staff_id: staffId,
    p_patch: { avatar_path: path },
  })
  if (error) return { error: error.message }

  const replaced = typeof data === 'string' && data ? data : null
  if (replaced) {
    /* Best effort. The row already says what the photo is. */
    await supabase.storage.from(STAFF_AVATAR_BUCKET).remove([replaced])
  }

  revalidatePath('/admin')
  revalidatePath('/profile')
  return { ok: true }
}

/**
 * Approve a pending access request with a profile.
 *
 * One database function, one transaction: the row goes active and the
 * assignment is inserted together, through the administrator's own RLS so the
 * audit trail names who approved. Every refusal — not an administrator,
 * already decided, no such profile — is the database's sentence, unrewritten.
 * The shape check on the ids is the front-door rule: nothing forwarded that
 * is not the kind of thing asked for.
 */
export async function approveStaffRegistration(staffId: string, profileId: string): Promise<StaffDetailState> {
  if (!UUID.test(staffId)) return { error: 'No request selected.' }
  if (!UUID.test(profileId)) return { error: 'Choose an access profile.' }

  const supabase = await createSupabaseServerClient()
  const { error } = await supabase.rpc('approve_staff_registration', { p_staff_id: staffId, p_profile_id: profileId })
  if (error) return { error: error.message }

  revalidatePath('/admin')
  return { ok: true }
}

/**
 * Decline a pending request: the row becomes inactive, which is the state the
 * Phase 2 function already knows how to reach and whose rules already refuse
 * a return to pending. Nothing is deleted — the audit trail and the row both
 * say a request was made and refused, and the person cannot ask again from
 * the same account.
 */
export async function declineStaffRegistration(staffId: string): Promise<StaffDetailState> {
  if (!UUID.test(staffId)) return { error: 'No request selected.' }

  const supabase = await createSupabaseServerClient()
  const { error } = await supabase.rpc('update_staff_patch', { p_staff_id: staffId, p_patch: { status: 'inactive' } })
  if (error) return { error: error.message }

  revalidatePath('/admin')
  return { ok: true }
}

/**
 * A set of checkboxes read behind its sentinel — the group actions'
 * `readPartySet`, copied rather than imported because a `'use server'` file
 * may export only async functions. Absent sentinel: the set was not on the
 * form, leave it alone (`undefined`). Present: whatever is ticked, which may
 * legitimately be nothing.
 */
function readSet(formData: FormData, field: string, sentinel: string): string[] | undefined {
  if (!formData.has(sentinel)) return undefined
  return formData.getAll(field).map(String).filter(Boolean)
}

export type UserGroupState = { error: string } | { ok: true } | null

/**
 * The group detail page's route, for revalidation. `'page'` is REQUIRED with
 * a dynamic segment — see the note on `GROUP_PAGE` in the group actions, which
 * this repeats rather than imports for the `'use server'` reason above.
 */
const GROUP_PAGE = '/groups/[id]' as const

const USER_GROUP_STATUSES = new Set(['active', 'archived'])

/**
 * Create a user group (territory) from the one-field dialog on the User groups
 * tab. The database owns every rule — administrators only, name unique
 * regardless of case, 60 characters — and its sentences pass through; the two
 * checks here are the friendlier of two identical answers.
 */
export async function createUserGroup(_prev: UserGroupState, formData: FormData): Promise<UserGroupState> {
  const name = String(formData.get('name') ?? '').trim()
  if (!name) return { error: 'Give the user group a name.' }
  if (name.length > 60) return { error: 'Use 60 characters or fewer for the name.' }

  const supabase = await createSupabaseServerClient()
  const { error } = await supabase.rpc('create_user_group', { p_name: name })
  if (error) return { error: error.message }

  revalidatePath('/admin')
  return { ok: true }
}

/**
 * Rename or archive a user group. Patch-shaped: only the keys the Details box
 * carried travel. A rename shows on every household's page and on the groups
 * index, so both are revalidated with the admin page.
 */
export async function saveUserGroupDetails(_prev: UserGroupState, formData: FormData): Promise<UserGroupState> {
  const id = String(formData.get('user_group_id') ?? '')
  if (!UUID.test(id)) return { error: 'No user group selected.' }

  const patch: Record<string, unknown> = {}
  if (formData.has('name')) {
    const name = String(formData.get('name')).trim()
    if (!name) return { error: 'Give the user group a name.' }
    if (name.length > 60) return { error: 'Use 60 characters or fewer for the name.' }
    patch.name = name
  }
  if (formData.has('status')) {
    const status = String(formData.get('status'))
    if (!USER_GROUP_STATUSES.has(status)) return { error: 'Choose a status.' }
    patch.status = status
  }
  if (Object.keys(patch).length === 0) return { error: 'Nothing to save.' }

  const supabase = await createSupabaseServerClient()
  const { error } = await supabase.rpc('update_user_group_patch', { p_user_group_id: id, p_patch: patch })
  if (error) return { error: error.message }

  revalidatePath('/admin')
  revalidatePath(GROUP_PAGE, 'page')
  revalidatePath('/groups')
  return { ok: true }
}

/**
 * Replace a user group's members with exactly what is ticked. The sentinel is
 * what lets an EMPTIED list mean "remove everyone" rather than "nothing to
 * save" — without it the two are the same `[]`.
 */
export async function saveUserGroupMembers(_prev: UserGroupState, formData: FormData): Promise<UserGroupState> {
  const id = String(formData.get('user_group_id') ?? '')
  if (!UUID.test(id)) return { error: 'No user group selected.' }
  const ids = readSet(formData, 'staff_ids', 'members_present')
  if (!ids) return { error: 'Nothing to save.' }
  if (!ids.every((s) => UUID.test(s))) return { error: 'Choose members from the list.' }

  const supabase = await createSupabaseServerClient()
  const { error } = await supabase.rpc('set_user_group_members', { p_user_group_id: id, p_staff_ids: ids })
  if (error) return { error: error.message }

  revalidatePath('/admin')
  return { ok: true }
}
