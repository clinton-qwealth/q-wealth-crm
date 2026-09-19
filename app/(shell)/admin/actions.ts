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
 * form carrying only a name leaves everything else alone. Only the six keys
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
