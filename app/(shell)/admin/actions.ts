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
const TEMPLATE_STATUSES = new Set(['draft', 'published', 'archived'])

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
 * Membership, one person at a time — the Members box on a user group.
 *
 * INCREMENTAL, not a set-replace, and that is the whole point at 100-200 users:
 * two administrators working on the same group cannot revert each other, because
 * neither call carries an opinion about anybody it was not asked about. It also
 * gives the audit trail the event that actually happened ("Added Jo Smith")
 * rather than whichever rows happened to differ.
 *
 * Both are idempotent in the database, so a double click is not an error.
 */
export async function addUserGroupMember(userGroupId: string, staffId: string): Promise<UserGroupState> {
  if (!UUID.test(userGroupId)) return { error: 'No user group selected.' }
  if (!UUID.test(staffId)) return { error: 'No person selected.' }

  const supabase = await createSupabaseServerClient()
  const { error } = await supabase.rpc('add_user_group_member', {
    p_user_group_id: userGroupId,
    p_staff_id: staffId,
  })
  if (error) return { error: error.message }

  revalidatePath('/admin')
  return { ok: true }
}

export async function removeUserGroupMember(userGroupId: string, staffId: string): Promise<UserGroupState> {
  if (!UUID.test(userGroupId)) return { error: 'No user group selected.' }
  if (!UUID.test(staffId)) return { error: 'No person selected.' }

  const supabase = await createSupabaseServerClient()
  const { error } = await supabase.rpc('remove_user_group_member', {
    p_user_group_id: userGroupId,
    p_staff_id: staffId,
  })
  if (error) return { error: error.message }

  revalidatePath('/admin')
  return { ok: true }
}

/**
 * Several people into several user groups, from the Users list — the errand
 * that actually takes the time when first carving a hundred people into
 * territories. A person belongs to as many territories as they work in, so the
 * bar takes a set rather than one: the single-group version made "north and
 * west" two passes over the same selection, which is where a batch gets missed.
 *
 * ADDITIVE: it never removes anybody, so pressing it from a list somebody else
 * may be editing cannot undo their work. The database returns how many rows it
 * actually wrote, so the message says "Added 12" rather than "Added 15" when
 * three were already members.
 *
 * ONE OUTCOME PER GROUP, not a total. "Added 12" across three territories tells
 * the reader nothing about which of them is still empty, and summing hides a
 * group that refused while its neighbours succeeded.
 */
export type BulkAssignResult = { id: string; added: number; error?: string }
export type BulkAssignState = { error: string } | { ok: true; results: BulkAssignResult[] } | null

export async function addUsersToUserGroups(
  userGroupIds: string[],
  staffIds: string[],
): Promise<BulkAssignState> {
  if (userGroupIds.length === 0) return { error: 'Choose at least one user group.' }
  if (!userGroupIds.every((id) => UUID.test(id))) return { error: 'Choose user groups from the list.' }
  if (staffIds.length === 0) return { error: 'Choose at least one person.' }
  if (!staffIds.every((id) => UUID.test(id))) return { error: 'Choose people from the list.' }

  const supabase = await createSupabaseServerClient()
  /* One call per territory, in one wave: `add_user_group_members` takes a single
     group, and each call is additive and idempotent, so a partial run leaves no
     half-state to unwind — whatever succeeded is simply done, and the report
     below says so group by group. */
  const results = await Promise.all(
    userGroupIds.map(async (userGroupId): Promise<BulkAssignResult> => {
      const { data, error } = await supabase.rpc('add_user_group_members', {
        p_user_group_id: userGroupId,
        p_staff_ids: staffIds,
      })
      if (error) return { id: userGroupId, added: 0, error: error.message }
      return { id: userGroupId, added: typeof data === 'number' ? data : 0 }
    }),
  )

  /* Only when something was actually written. Every group refusing, or every
     person already being a member, changes nothing for anybody to re-read. */
  if (results.some((r) => r.added > 0)) revalidatePath('/admin')
  return { ok: true, results }
}

/* -------------------------------------------------------------------------- */
/* Workflow templates                                                          */
/* -------------------------------------------------------------------------- */

const TEMPLATE_PAGE = '/admin/templates/[id]' as const

/**
 * Creating a template returns its ID, which is a deliberate widening of the
 * house `{ ok: true }` shape. The dialog navigates straight into the editor on
 * success; creating a template and then hunting for it in the list would be a
 * wasted step for the one action that always has a next step.
 */
export type TemplateCreateState = { error: string } | { ok: true; id: string } | null

export async function createWorkflowTemplate(
  _prev: TemplateCreateState,
  formData: FormData,
): Promise<TemplateCreateState> {
  const name = String(formData.get('name') ?? '').trim()
  const description = String(formData.get('description') ?? '').trim()
  if (!name) return { error: 'Give the template a name.' }

  const supabase = await createSupabaseServerClient()
  const { data, error } = await supabase.rpc('create_workflow_template', {
    p_name: name,
    p_description: description || null,
    p_workflow_type: null,
  })
  if (error) return { error: error.message }
  revalidatePath('/admin')
  return { ok: true, id: data as string }
}

export async function saveWorkflowTemplate(
  _prev: UserGroupState,
  formData: FormData,
): Promise<UserGroupState> {
  const id = String(formData.get('template_id') ?? '')
  if (!UUID.test(id)) return { error: 'Choose a template.' }

  // Key presence is the meaning: a form carrying only a name leaves the rest
  // alone, exactly as saveUserGroupDetails does.
  const patch: Record<string, unknown> = {}
  for (const key of ['name', 'description'] as const) {
    if (formData.has(key)) patch[key] = String(formData.get(key) ?? '').trim() || null
  }
  if (Object.keys(patch).length === 0) return { error: 'Nothing to save.' }
  if (patch.name === null) return { error: 'Give the template a name.' }

  const supabase = await createSupabaseServerClient()
  const { error } = await supabase.rpc('update_workflow_template_patch', {
    p_template_id: id,
    p_patch: patch,
  })
  if (error) return { error: error.message }
  revalidatePath('/admin')
  revalidatePath(TEMPLATE_PAGE, 'page')
  return { ok: true }
}

export async function setWorkflowTemplateStatus(
  templateId: string,
  status: 'draft' | 'published' | 'archived',
): Promise<UserGroupState> {
  if (!UUID.test(templateId)) return { error: 'Choose a template.' }
  if (!TEMPLATE_STATUSES.has(status)) return { error: 'That is not a status.' }

  const supabase = await createSupabaseServerClient()
  const { error } = await supabase.rpc('set_workflow_template_status', {
    p_template_id: templateId,
    p_status: status,
  })
  if (error) return { error: error.message }
  revalidatePath('/admin')
  revalidatePath(TEMPLATE_PAGE, 'page')
  return { ok: true }
}

/* ---- Roles: immediate actions, not a form -------------------------------- */

export async function addTemplateRole(templateId: string, name: string): Promise<UserGroupState> {
  if (!UUID.test(templateId)) return { error: 'Choose a template.' }
  if (!name.trim()) return { error: 'Give the role a name.' }

  const supabase = await createSupabaseServerClient()
  const { error } = await supabase.rpc('create_workflow_template_role', {
    p_template_id: templateId,
    p_name: name.trim(),
  })
  if (error) return { error: error.message }
  revalidatePath(TEMPLATE_PAGE, 'page')
  return { ok: true }
}

export async function renameTemplateRole(roleId: string, name: string): Promise<UserGroupState> {
  if (!UUID.test(roleId)) return { error: 'Choose a role.' }
  if (!name.trim()) return { error: 'Give the role a name.' }

  const supabase = await createSupabaseServerClient()
  const { error } = await supabase.rpc('rename_workflow_template_role', {
    p_role_id: roleId,
    p_name: name.trim(),
  })
  if (error) return { error: error.message }
  revalidatePath(TEMPLATE_PAGE, 'page')
  return { ok: true }
}

export async function removeTemplateRole(roleId: string): Promise<UserGroupState> {
  if (!UUID.test(roleId)) return { error: 'Choose a role.' }

  const supabase = await createSupabaseServerClient()
  const { error } = await supabase.rpc('remove_workflow_template_role', { p_role_id: roleId })
  if (error) return { error: error.message }
  revalidatePath(TEMPLATE_PAGE, 'page')
  return { ok: true }
}

/* ---- Tasks --------------------------------------------------------------- */

export async function addTemplateTask(
  _prev: UserGroupState,
  formData: FormData,
): Promise<UserGroupState> {
  const templateId = String(formData.get('template_id') ?? '')
  const roleId = String(formData.get('role_id') ?? '')
  const subject = String(formData.get('subject') ?? '').trim()
  const description = String(formData.get('description') ?? '').trim()
  const offset = Number(formData.get('due_offset_days') ?? 0)

  if (!UUID.test(templateId)) return { error: 'Choose a template.' }
  if (!subject) return { error: 'Give the task a subject.' }
  if (!UUID.test(roleId)) return { error: 'Say who does this task.' }
  if (!Number.isInteger(offset) || offset < 0) return { error: 'The offset is a whole number of days, or zero.' }

  const supabase = await createSupabaseServerClient()
  const { data, error } = await supabase.rpc('add_workflow_template_task', {
    p_template_id: templateId,
    p_subject: subject,
    p_role_id: roleId,
    p_due_offset_days: offset,
    p_description: description || null,
    p_priority: 'medium',
  })
  if (error) return { error: error.message }

  // A new task is appended last, so every existing task is a legal
  // prerequisite; the form may send some.
  const prerequisites = formData.getAll('depends_on').map(String).filter((v) => UUID.test(v))
  if (prerequisites.length > 0) {
    const { error: depError } = await supabase.rpc('set_workflow_template_dependencies', {
      p_task_id: data as string,
      p_depends_on_task_ids: prerequisites,
    })
    if (depError) return { error: depError.message }
  }

  revalidatePath(TEMPLATE_PAGE, 'page')
  revalidatePath('/admin')
  return { ok: true }
}

export async function saveTemplateTask(
  _prev: UserGroupState,
  formData: FormData,
): Promise<UserGroupState> {
  const taskId = String(formData.get('task_id') ?? '')
  if (!UUID.test(taskId)) return { error: 'Choose a task.' }

  const patch: Record<string, unknown> = {}
  if (formData.has('subject')) patch.subject = String(formData.get('subject') ?? '').trim()
  if (formData.has('description')) patch.description = String(formData.get('description') ?? '').trim() || null
  if (formData.has('role_id')) patch.role_id = String(formData.get('role_id') ?? '')
  if (formData.has('due_offset_days')) {
    const offset = Number(formData.get('due_offset_days') ?? 0)
    if (!Number.isInteger(offset) || offset < 0) {
      return { error: 'The offset is a whole number of days, or zero.' }
    }
    patch.due_offset_days = offset
  }
  if (patch.subject === '') return { error: 'Give the task a subject.' }

  const supabase = await createSupabaseServerClient()
  if (Object.keys(patch).length > 0) {
    const { error } = await supabase.rpc('update_workflow_template_task_patch', {
      p_task_id: taskId,
      p_patch: patch,
    })
    if (error) return { error: error.message }
  }

  /* The sentinel is what makes "nothing ticked" mean "waits for nothing"
     rather than "leave alone" — the same device CheckboxSet uses everywhere
     else. Without it, a task's prerequisites could never be cleared. */
  if (formData.has('depends_on_set')) {
    const prerequisites = formData.getAll('depends_on').map(String).filter((v) => UUID.test(v))
    const { error } = await supabase.rpc('set_workflow_template_dependencies', {
      p_task_id: taskId,
      p_depends_on_task_ids: prerequisites,
    })
    if (error) return { error: error.message }
  }

  revalidatePath(TEMPLATE_PAGE, 'page')
  return { ok: true }
}

export async function removeTemplateTask(taskId: string): Promise<UserGroupState> {
  if (!UUID.test(taskId)) return { error: 'Choose a task.' }

  const supabase = await createSupabaseServerClient()
  const { error } = await supabase.rpc('remove_workflow_template_task', { p_task_id: taskId })
  if (error) return { error: error.message }
  revalidatePath(TEMPLATE_PAGE, 'page')
  revalidatePath('/admin')
  return { ok: true }
}

/**
 * The whole list, in its new order.
 *
 * One action for both the nudge buttons and the Move-to menu, so two controls
 * for one value cannot disagree — the component computes the new order with
 * `reordered()` and sends it here. The database refuses a partial list, which
 * is what stops a stale client leaving a gap.
 */
export async function reorderTemplateTasks(
  templateId: string,
  taskIds: string[],
): Promise<UserGroupState> {
  if (!UUID.test(templateId)) return { error: 'Choose a template.' }
  if (taskIds.length === 0 || !taskIds.every((id) => UUID.test(id))) {
    return { error: 'That is not an order.' }
  }

  const supabase = await createSupabaseServerClient()
  const { error } = await supabase.rpc('reorder_workflow_template_tasks', {
    p_template_id: templateId,
    p_task_ids: taskIds,
  })
  if (error) return { error: error.message }
  revalidatePath(TEMPLATE_PAGE, 'page')
  return { ok: true }
}
