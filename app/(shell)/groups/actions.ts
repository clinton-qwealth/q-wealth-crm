'use server'

import { revalidatePath } from 'next/cache'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import type { BoardColumn, Priority, TaskStatus } from '@/lib/workflow-board'
import type { WorkflowStatus } from '@/lib/notes'

export type CreateAccountState = { error: string } | { ok: true } | null

/**
 * Creates an account, its owners and an optional opening valuation in one
 * transaction, via create_financial_account(). The function is SECURITY INVOKER,
 * so every RLS policy still evaluates as the signed-in staff member.
 */
export async function createAccount(
  _prev: CreateAccountState,
  formData: FormData
): Promise<CreateAccountState> {
  const accountType = String(formData.get('account_type') ?? '')
  const status = String(formData.get('status') ?? 'active')
  const label = String(formData.get('label') ?? '').trim()
  const ownerIds = formData.getAll('owner_party_ids').map(String).filter(Boolean)
  const providerId = String(formData.get('provider_party_id') ?? '') || null
  const accountNumber = String(formData.get('account_number') ?? '').trim()
  const openedOn = String(formData.get('opened_on') ?? '') || null
  const rawValue = String(formData.get('opening_value') ?? '').trim()
  const valuedOn = String(formData.get('valued_on') ?? '') || null

  if (!accountType) return { error: 'Choose an account type.' }
  if (!label) return { error: 'Give the account a name.' }
  if (ownerIds.length === 0) return { error: 'Choose at least one owner.' }
  // The browser's `required` attribute is a convenience; a server action can be
  // called without ever rendering the form, so the rule is checked here too.
  if (!accountNumber) return { error: 'Enter the account number.' }

  // Parsed here so a typo is a clear message rather than a database error, and
  // sent as a string so the numeric column keeps full precision — a JS number
  // would round-trip through binary floating point on the way.
  let openingValue: string | null = null
  if (rawValue) {
    const cleaned = rawValue.replace(/[$,\s]/g, '')
    if (!/^-?\d+(\.\d{1,2})?$/.test(cleaned)) {
      return { error: 'Opening value must be an amount, to at most two decimal places.' }
    }
    openingValue = cleaned
  }

  const supabase = await createSupabaseServerClient()
  const { error } = await supabase.rpc('create_financial_account', {
    p_account_type: accountType,
    p_label: label,
    p_owner_party_ids: ownerIds,
    p_provider_party_id: providerId,
    p_account_number: accountNumber,
    p_opened_on: openedOn,
    p_opening_value: openingValue,
    p_valued_on: valuedOn,
    p_status: status,
  })

  if (error) return { error: error.message }

  revalidatePath('/groups')
  return { ok: true }
}

export type CreatePolicyState = { error: string } | { ok: true } | null

/** Amounts are validated here so a typo is a clear message rather than a
 *  database error, and passed as strings so numeric(14,2) keeps full precision. */
function parseAmount(raw: string, field: string): string | { error: string } {
  const cleaned = raw.replace(/[$,\s]/g, '')
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) {
    return { error: `${field} must be an amount, to at most two decimal places.` }
  }
  return cleaned
}

export async function createPolicy(
  _prev: CreatePolicyState,
  formData: FormData,
): Promise<CreatePolicyState> {
  const label = String(formData.get('label') ?? '').trim()
  const policyNumber = String(formData.get('policy_number') ?? '').trim()
  const status = String(formData.get('status') ?? 'in_force')
  const ownerIds = formData.getAll('owner_party_ids').map(String).filter(Boolean)
  const lifeIds = formData.getAll('life_insured_ids').map(String).filter(Boolean)
  const providerId = String(formData.get('provider_party_id') ?? '') || null
  const commencedOn = String(formData.get('commenced_on') ?? '') || null
  const frequency = String(formData.get('premium_frequency') ?? '') || null
  const structure = String(formData.get('premium_structure') ?? '') || null
  const rawPremium = String(formData.get('premium') ?? '').trim()

  if (!label) return { error: 'Give the policy a name.' }
  if (!policyNumber) return { error: 'Enter the policy number.' }
  if (ownerIds.length === 0) return { error: 'Choose at least one owner.' }
  if (lifeIds.length === 0) return { error: 'Choose at least one life insured.' }

  // A cover is what makes a policy a policy, so at least one is required. Each
  // cover type only counts when it carries an amount.
  const covers: Array<Record<string, unknown>> = []
  for (const type of ['life', 'tpd', 'trauma', 'income_protection']) {
    const raw = String(formData.get(`cover_${type}`) ?? '').trim()
    if (!raw) continue
    const amount = parseAmount(raw, 'Every cover amount')
    if (typeof amount !== 'string') return amount
    covers.push({
      cover_type: type,
      benefit_amount: amount,
      // Basis is left unset: the database defaults it from the cover type, so
      // the rule lives in one place rather than being restated here.
      benefit_period: String(formData.get(`period_${type}`) ?? '').trim() || null,
      waiting_period: String(formData.get(`waiting_${type}`) ?? '').trim() || null,
      indexed: formData.get(`indexed_${type}`) === 'on',
    })
  }
  if (covers.length === 0) return { error: 'Enter an amount for at least one cover.' }

  let premium: string | null = null
  if (rawPremium) {
    const parsed = parseAmount(rawPremium, 'Premium')
    if (typeof parsed !== 'string') return parsed
    premium = parsed
    if (!frequency) return { error: 'Choose how often the premium is paid.' }
  }

  const supabase = await createSupabaseServerClient()
  const { error } = await supabase.rpc('create_insurance_policy', {
    p_label: label,
    p_policy_number: policyNumber,
    p_owner_party_ids: ownerIds,
    p_life_insured_ids: lifeIds,
    p_covers: covers,
    p_provider_party_id: providerId,
    p_status: status,
    p_commenced_on: commencedOn,
    p_premium: premium,
    p_premium_frequency: premium ? frequency : null,
    p_premium_structure: structure,
  })
  if (error) return { error: error.message }

  revalidatePath('/groups')
  return { ok: true }
}

export type MemberState = { error: string } | { ok: true } | null

/** Shared by create and update: the panel's field set, read off the form. */
function readPersonFields(formData: FormData) {
  const str = (k: string) => String(formData.get(k) ?? '').trim()
  return {
    p_title: str('title') || null,
    p_first_name: str('first_name'),
    p_middle_name: str('middle_name') || null,
    p_last_name: str('last_name'),
    p_preferred_name: str('preferred_name') || null,
    p_date_of_birth: str('date_of_birth') || null,
    p_gender: str('gender') || null,
    p_marital_status: str('marital_status') || null,
    p_email: str('email') || null,
    p_mobile: str('mobile') || null,
    p_phone_other: str('phone_other') || null,
    p_addr_line1: str('addr_line1') || null,
    p_addr_line2: str('addr_line2') || null,
    p_addr_suburb: str('addr_suburb') || null,
    p_addr_state: str('addr_state') || null,
    p_addr_postcode: str('addr_postcode') || null,
    p_notes: str('notes') || null,
    p_place_of_birth: str('place_of_birth') || null,
    // Three states, so an empty select means "not asked" rather than "no".
    p_smoker: str('smoker') === '' ? null : str('smoker') === 'true',
    p_primary_citizenship: str('primary_citizenship') || null,
    p_secondary_citizenship: str('secondary_citizenship') || null,
    p_tax_residency: str('tax_residency') || null,
    p_employment_status: str('employment_status') || null,
    p_occupation: str('occupation') || null,
    p_company_name: str('company_name') || null,
    p_hin: str('hin') || null,
    p_chess_pid: str('chess_pid') || null,
    p_coffee_preference: str('coffee_preference') || null,
    p_date_of_death: str('date_of_death') || null,
  }
}

/** Checked here so a typo is a clear message rather than a database error. */
function fieldProblem(f: ReturnType<typeof readPersonFields>) {
  if (!f.p_first_name) return 'Enter a first name.'
  if (!f.p_last_name) return 'Enter a last name.'
  if (f.p_email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.p_email)) {
    return 'That email address does not look right.'
  }
  return null
}

export async function createMember(
  _prev: MemberState,
  formData: FormData,
): Promise<MemberState> {
  const groupId = String(formData.get('group_id') ?? '')
  const memberRole = String(formData.get('member_role') ?? 'other_person')
  if (!groupId) return { error: 'No group selected.' }

  const fields = readPersonFields(formData)
  const problem = fieldProblem(fields)
  if (problem) return { error: problem }

  const supabase = await createSupabaseServerClient()
  const { error } = await supabase.rpc('create_person_in_group', {
    p_group_id: groupId,
    p_member_role: memberRole,
    ...fields,
  })
  if (error) return { error: error.message }

  revalidatePath('/groups')
  return { ok: true }
}

/** Attach someone who already exists — the reason the party model exists. */
export async function linkMember(
  _prev: MemberState,
  formData: FormData,
): Promise<MemberState> {
  const groupId = String(formData.get('group_id') ?? '')
  const partyId = String(formData.get('party_id') ?? '')
  const memberRole = String(formData.get('member_role') ?? 'other_person')
  if (!groupId || !partyId) return { error: 'Choose someone to add.' }

  const supabase = await createSupabaseServerClient()
  const { error } = await supabase.rpc('add_party_to_group', {
    p_group_id: groupId,
    p_party_id: partyId,
    p_member_role: memberRole,
  })
  if (error) return { error: error.message }

  revalidatePath('/groups')
  return { ok: true }
}

export type PersonMatch = { party_id: string; display_name: string; detail: string }

/**
 * Search existing individuals, so an adviser adding someone already on file
 * links to that record rather than typing a second copy of them.
 *
 * Scoped by RLS like everything else: it can only surface people the caller can
 * already see. Excludes anyone already in this group.
 */
export async function searchPeople(groupId: string, query: string): Promise<PersonMatch[]> {
  if (query.trim().length < 2) return []
  const supabase = await createSupabaseServerClient({ writable: false })

  const { data: existing } = await supabase
    .from('client_group_members')
    .select('party_id')
    .eq('group_id', groupId)
    .is('end_date', null)
  const already = new Set((existing ?? []).map((m) => m.party_id as string))

  const { data, error } = await supabase
    .from('parties')
    .select('id, display_name, persons(date_of_birth), contact_points(kind, value, is_preferred)')
    .eq('party_type', 'person')
    .eq('status', 'active')
    .ilike('display_name', `%${query.trim()}%`)
    .limit(12)
  if (error) return []

  return (data ?? [])
    .filter((p) => !already.has(p.id as string))
    .map((p) => {
      const row = p as Record<string, unknown>
      const person = (Array.isArray(row.persons) ? row.persons[0] : row.persons) as
        | { date_of_birth?: string }
        | null
      const points = (row.contact_points ?? []) as Record<string, unknown>[]
      const email = points.find((c) => c.kind === 'email' && c.is_preferred)?.value as
        | string
        | undefined
      // Enough to tell two people with the same name apart.
      const detail = [email, person?.date_of_birth ? `born ${person.date_of_birth}` : null]
        .filter(Boolean)
        .join(' · ')
      return {
        party_id: row.id as string,
        display_name: (row.display_name as string) ?? 'Unnamed',
        detail: detail || 'No contact details on file',
      }
    })
}


/**
 * Decrypt one sensitive field for display.
 *
 * Every gate lives in the database, not here. reveal_sensitive_field checks the
 * caller holds `view_sensitive`, checks the session carries a verified second
 * factor, and writes a row to sensitive_access_log naming the caller — all of
 * which apply whether the call arrives from this action, from psql, or from
 * anywhere else. Adding a weaker check here would only create a second, softer
 * answer to the same question.
 *
 * The second-factor requirement is not an extra hurdle in the web app: every
 * authenticated route already requires `aal2`, so a staff member who can reach
 * this screen has already satisfied it. It matters for any other caller.
 */
export async function revealSensitiveField(
  partyId: string,
  kind: string,
): Promise<{ value: string } | { error: string }> {
  const supabase = await createSupabaseServerClient()
  const { data, error } = await supabase.rpc('reveal_sensitive_field', {
    p_party_id: partyId,
    p_kind: kind,
  })
  if (error) return { error: revealError(error.message) }
  if (data === null || data === undefined) return { error: 'Nothing recorded for that field.' }
  return { value: String(data) }
}

/**
 * Turn a database refusal into something a person can act on.
 *
 * The raw message is not shown: `permission denied for function
 * reveal_sensitive_field` tells a user nothing and tells an attacker the
 * function's name. Each refusal the database can actually produce is mapped;
 * anything unrecognised falls back to a message that admits the failure without
 * describing the internals.
 */
function revealError(message: string) {
  if (message.includes('view_sensitive')) {
    return 'Your access profile does not permit revealing this field.'
  }
  if (message.toLowerCase().includes('multi-factor')) {
    return 'Sign in again and complete your authenticator step to reveal this.'
  }
  if (message.includes('permission denied')) {
    return 'You do not have permission to reveal this field.'
  }
  return 'That field could not be revealed. If it persists, contact your administrator.'
}


/**
 * Save one section of an individual's record.
 *
 * The patch is built from whatever fields the submitted form contains, which is
 * what makes per-section editing safe: a form holding four inputs produces a
 * four-key patch, and update_person_patch leaves every column it does not
 * mention alone. Sending the same four fields to update_person would have
 * nulled the other nineteen.
 */
export async function patchMember(
  _prev: MemberState,
  formData: FormData,
): Promise<MemberState> {
  const partyId = String(formData.get('party_id') ?? '')
  const groupId = String(formData.get('group_id') ?? '') || null
  if (!partyId) return { error: 'No individual selected.' }

  const patch: Record<string, string> = {}
  for (const [key, value] of formData.entries()) {
    if (key === 'party_id' || key === 'group_id') continue
    patch[key] = String(value).trim()
  }
  if (Object.keys(patch).length === 0) return { error: 'Nothing to save.' }

  if (patch.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(patch.email)) {
    return { error: 'That email address does not look right.' }
  }
  /*
   * The mobile is not just a contact detail: it is where an identity-verification
   * code is sent, and the database refuses a number it cannot read with
   * confidence. Without this check that refusal surfaces mid-telephone-call,
   * months after somebody typed a landline into the wrong box. Better to say so
   * while they are still looking at the field.
   *
   * Mirrors public.to_e164_au EXACTLY rather than being stricter — a rule that
   * rejects what the database would accept is its own kind of bug. Clearing the
   * field is still allowed; only a value that could never be dialled is refused.
   */
  if (patch.mobile) {
    const digits = patch.mobile.replace(/[^0-9]/g, '')
    const ok = patch.mobile.trim().startsWith('+')
      ? /^[1-9][0-9]{7,14}$/.test(digits)
      : /^04[0-9]{8}$/.test(digits) || /^614[0-9]{8}$/.test(digits)
    if (!ok) {
      return {
        error:
          'That does not read as a mobile number. Use 04xx xxx xxx, or full international form such as +64 21 555 901. A landline belongs in Other phone.',
      }
    }
  }
  if ('first_name' in patch && !patch.first_name) return { error: 'Enter a first name.' }
  if ('last_name' in patch && !patch.last_name) return { error: 'Enter a last name.' }

  const supabase = await createSupabaseServerClient()
  const { error } = await supabase.rpc('update_person_patch', {
    p_party_id: partyId,
    p_patch: patch,
    p_group_id: groupId,
  })
  if (error) return { error: error.message }

  revalidatePath('/groups')
  return { ok: true }
}

// ---------------------------------------------------------------------------
// Identity verification
// ---------------------------------------------------------------------------
// These call the identity-verify edge function rather than the database
// directly, for one reason: the function is the only place the Twilio
// credentials exist. It sits beside the database in Sydney while these actions
// run in a Vercel function, so it is also the faster place to do the work.
//
// The caller's own access token is forwarded, so the database evaluates every
// statement as that staff member. Nothing here decides whether the action is
// allowed — the permission, the second-factor requirement, access to the client
// and both rate limits all live in the database functions the edge function
// calls, and cannot be routed around from here.

type VerifyStart =
  | { ok: true; verification_id: string; destination_masked: string; provider: string; expires_in_seconds: number; stub_code?: string }
  | { error: string }

type VerifyOutcome = { ok: true; passed: boolean; outcome_source: string } | { error: string }

/**
 * The session's access token, for forwarding to the edge function.
 *
 * getSession reads the cookie rather than calling Supabase, so this costs no
 * round trip. getUser would.
 */
async function accessToken() {
  const supabase = await createSupabaseServerClient()
  const {
    data: { session },
  } = await supabase.auth.getSession()
  return session?.access_token ?? null
}

async function callVerify(path: string, payload: unknown, method = 'POST') {
  const token = await accessToken()
  if (!token) return { error: 'Your session has expired. Sign in again.' as string }

  const base = process.env.NEXT_PUBLIC_SUPABASE_URL
  if (!base) return { error: 'Identity verification is not configured.' as string }

  try {
    const res = await fetch(`${base}/functions/v1/identity-verify${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      ...(method === 'POST' ? { body: JSON.stringify(payload) } : {}),
      cache: 'no-store',
    })
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>
    if (!res.ok) {
      // The edge function already writes messages fit to show an adviser, so
      // they are passed through rather than replaced with something vaguer.
      return { error: (body.error as string) ?? 'The verification could not be completed.' }
    }
    return body
  } catch {
    return { error: 'Could not reach the verification service.' as string }
  }
}

export async function startVerification(partyId: string, groupId: string | null): Promise<VerifyStart> {
  const body = await callVerify('/start', { party_id: partyId, group_id: groupId })
  if ('error' in body) return { error: body.error as string }
  return {
    ok: true,
    verification_id: body.verification_id as string,
    destination_masked: body.destination_masked as string,
    provider: body.provider as string,
    expires_in_seconds: (body.expires_in_seconds as number) ?? 600,
    ...(body.stub_code ? { stub_code: body.stub_code as string } : {}),
  }
}

export async function checkVerification(id: string, code: string): Promise<VerifyOutcome> {
  const body = await callVerify('/check', { verification_id: id, code })
  if ('error' in body) return { error: body.error as string }
  revalidatePath('/groups')
  return { ok: true, passed: body.passed as boolean, outcome_source: body.outcome_source as string }
}

/** The fallback path: no code could be delivered and a named adviser vouched. */
export async function attestVerification(id: string, passed: boolean): Promise<VerifyOutcome> {
  const body = await callVerify('/attest', { verification_id: id, passed })
  if ('error' in body) return { error: body.error as string }
  revalidatePath('/groups')
  return { ok: true, passed: body.passed as boolean, outcome_source: body.outcome_source as string }
}

export async function abandonVerification(id: string, reason?: string) {
  const body = await callVerify('/abandon', { verification_id: id, status: 'cancelled', reason })
  if ('error' in body) return { error: body.error as string }
  revalidatePath('/groups')
  return { ok: true as const }
}

// ---------------------------------------------------------------------------
// File notes and workflows
// ---------------------------------------------------------------------------

export type NoteState = { error: string } | { ok: true } | null

/**
 * A date the adviser picked, as an instant Postgres can store.
 *
 * notes.occurred_at is timestamptz — a moment, not a calendar date — but a file
 * note is dated by day. Turning one into the other has a trap: '2026-09-06'
 * alone is read as midnight in the server's timezone (UTC), and midnight UTC is
 * still the 5th anywhere west of Greenwich. Noon UTC is the same calendar date
 * in every timezone from UTC-11 to UTC+12, so it is the only choice of instant
 * that cannot render as the wrong day for anybody.
 */
function dayAsInstant(day: string) {
  return `${day}T12:00:00Z`
}

/**
 * Write a file note against the group.
 *
 * Subjects are what a note is *about*, and here that is the group: a file note
 * added from a group's workspace concerns the household, not one named member.
 * create_note_with_subjects also accepts party ids for a note about one person;
 * that belongs with the member panel, which knows who is being looked at.
 */
export async function createFileNote(
  _prev: NoteState,
  formData: FormData,
): Promise<NoteState> {
  const groupId = String(formData.get('group_id') ?? '')
  const title = String(formData.get('title') ?? '').trim()
  const body = String(formData.get('body') ?? '').trim()
  const noteType = String(formData.get('note_type') ?? 'file_note')
  const day = String(formData.get('occurred_on') ?? '').trim()
  const workflowId = String(formData.get('workflow_id') ?? '') || null

  if (!groupId) return { error: 'No group selected.' }
  // Checked here as well as in the database: a server action is reachable
  // without the form ever rendering, so `required` binds nobody.
  if (!body) return { error: 'Write something in the note.' }

  const supabase = await createSupabaseServerClient()
  const { error } = await supabase.rpc('create_note_with_subjects', {
    p_body: body,
    p_party_ids: null,
    p_group_id: groupId,
    p_title: title || null,
    p_note_type: noteType,
    p_occurred_at: day ? dayAsInstant(day) : null,
    p_workflow_id: workflowId,
  })
  if (error) return { error: error.message }

  revalidatePath('/groups')
  return { ok: true }
}

/**
 * Start a piece of work for the group.
 *
 * Everything about who may do this, and for which group, is in the database:
 * create_workflow requires active staff and the insert policy requires access
 * to the group. Nothing is decided here.
 */
export async function startWorkflow(
  _prev: NoteState,
  formData: FormData,
): Promise<NoteState> {
  const groupId = String(formData.get('group_id') ?? '')
  const name = String(formData.get('name') ?? '').trim()
  const workflowType = String(formData.get('workflow_type') ?? 'ad_hoc')

  if (!groupId) return { error: 'No group selected.' }
  if (!name) return { error: 'Give the workflow a name.' }

  const supabase = await createSupabaseServerClient()
  const { error } = await supabase.rpc('create_workflow', {
    p_group_id: groupId,
    p_workflow_type: workflowType,
    p_name: name,
  })
  if (error) return { error: error.message }

  revalidatePath('/groups')
  /* The board lists every workflow, so one started from either screen belongs
     on it — without this, a new workflow reached the board only on a reload. */
  revalidatePath('/workflows')
  return { ok: true }
}

/**
 * File a note under a workflow, or take it back out.
 *
 * Not an ordinary update: notes are append-only, and workflow_id is one of the
 * two columns the trigger permits to change. The rule that a note and its
 * workflow must concern the same client group lives in set_note_workflow, so it
 * holds for the MCP and psql too — not only for this button.
 */
export async function attachNoteToWorkflow(
  noteId: string,
  workflowId: string | null,
): Promise<NoteState> {
  if (!noteId) return { error: 'No note selected.' }

  const supabase = await createSupabaseServerClient()
  const { error } = await supabase.rpc('set_note_workflow', {
    p_note_id: noteId,
    p_workflow_id: workflowId,
  })
  if (error) return { error: error.message }

  revalidatePath('/groups')
  return { ok: true }
}

/**
 * Start a workflow and file the note under it in one gesture.
 *
 * Two round trips rather than one, because the second needs the id the first
 * returns. Worth it: the alternative is making an adviser start a workflow,
 * find the note again and then attach it — three screens for one thought.
 *
 * NOT transactional, and it does not pretend to be. If the attach fails the
 * workflow still exists, which is the harmless half: a workflow with no notes
 * yet is an ordinary state, whereas a note filed under nothing is what the
 * adviser was trying to fix. The error says which half happened.
 */
export async function fileNoteUnderNewWorkflow(
  noteId: string,
  groupId: string,
  name: string,
  workflowType: string,
): Promise<NoteState> {
  if (!noteId) return { error: 'No note selected.' }
  if (!groupId) return { error: 'No group selected.' }
  if (!name.trim()) return { error: 'Give the workflow a name.' }

  const supabase = await createSupabaseServerClient()
  const { data: workflowId, error } = await supabase.rpc('create_workflow', {
    p_group_id: groupId,
    p_workflow_type: workflowType,
    p_name: name.trim(),
  })
  if (error) return { error: error.message }

  const { error: attachError } = await supabase.rpc('set_note_workflow', {
    p_note_id: noteId,
    p_workflow_id: workflowId,
  })
  if (attachError) {
    return { error: `The workflow was created, but the note could not be filed under it: ${attachError.message}` }
  }

  revalidatePath('/groups')
  revalidatePath('/workflows')
  return { ok: true }
}

/**
 * Move a workflow to a lane on the board.
 *
 * The lane IS the status, so this is a status change; set_workflow_status also
 * keeps started_at and completed_at truthful for the new state. Both pages that
 * show workflows are revalidated — the board, and the group page whose tab
 * lists the same rows.
 */
/**
 * Set a workflow's status to any of the six — not only the four board lanes.
 *
 * `set_workflow_status()` has always taken the whole enum and has always kept
 * started_at and completed_at truthful for every value of it; nothing in the
 * web app could reach `blocked` or `cancelled` because the board has no lane
 * for either. The workflow detail page has no lanes, so it is the screen that
 * can.
 */
export async function setWorkflowStatus(id: string, status: WorkflowStatus): Promise<NoteState> {
  if (!id) return { error: 'No workflow selected.' }

  const supabase = await createSupabaseServerClient()
  const { error } = await supabase.rpc('set_workflow_status', { p_id: id, p_status: status })
  if (error) return { error: error.message }

  revalidatePath('/workflows')
  /* The workflow's own page, by path: a change made there must not leave a
     stale server render behind the optimistic one. */
  revalidatePath(`/workflows/${id}`)
  revalidatePath('/groups')
  return { ok: true }
}

/**
 * The board's entry point: a lane move. Narrower on purpose — the type makes it
 * impossible for a drop to set a status the board has no lane for.
 */
export async function moveWorkflow(id: string, status: BoardColumn): Promise<NoteState> {
  return setWorkflowStatus(id, status)
}

/** Set a workflow's priority. Visibility and the right to change it are RLS. */
export async function setWorkflowPriority(id: string, priority: Priority): Promise<NoteState> {
  if (!id) return { error: 'No workflow selected.' }
  const supabase = await createSupabaseServerClient()
  const { error } = await supabase.rpc('set_workflow_priority', { p_id: id, p_priority: priority })
  if (error) return { error: error.message }
  revalidatePath('/workflows')
  revalidatePath(`/workflows/${id}`)
  revalidatePath('/groups')
  return { ok: true }
}

/**
 * Save the workflow detail page's field box: owner, due date and description.
 *
 * The patch carries only the keys the form actually submitted, because that is
 * what `set_workflow_details()` reads — key presence means "change this". A
 * form that one day stops rendering a field therefore stops writing it, rather
 * than clearing a column nobody touched.
 */
export async function saveWorkflowDetails(
  _prev: NoteState,
  formData: FormData,
): Promise<NoteState> {
  const id = String(formData.get('workflow_id') ?? '')
  if (!id) return { error: 'No workflow selected.' }

  const patch: Record<string, string> = {}
  for (const key of ['owner_staff_id', 'due_at', 'description'] as const) {
    if (formData.has(key)) patch[key] = String(formData.get(key) ?? '')
  }

  const supabase = await createSupabaseServerClient()
  const { error } = await supabase.rpc('set_workflow_details', { p_id: id, p_patch: patch })
  if (error) return { error: error.message }

  revalidatePath('/workflows')
  revalidatePath(`/workflows/${id}`)
  revalidatePath('/groups')
  return { ok: true }
}

/**
 * Add a task to a workflow, from the Add task dialog.
 *
 * Blank optional fields are sent as null rather than '', so the database sees
 * "not given" and not "given as nothing" — the function trims and nullifies a
 * description anyway, but a `date` column would refuse '' outright.
 */
export async function createWorkflowTask(
  _prev: NoteState,
  formData: FormData,
): Promise<NoteState> {
  const workflowId = String(formData.get('workflow_id') ?? '')
  const subject = String(formData.get('subject') ?? '').trim()
  const description = String(formData.get('description') ?? '').trim()
  const dueAt = String(formData.get('due_at') ?? '').trim()
  const assignedTo = String(formData.get('assigned_to_staff_id') ?? '').trim()
  const priority = String(formData.get('priority') ?? '').trim()

  if (!workflowId) return { error: 'No workflow selected.' }
  if (!subject) return { error: 'Give the task a subject.' }

  const supabase = await createSupabaseServerClient()
  const { error } = await supabase.rpc('create_workflow_task', {
    p_workflow_id: workflowId,
    p_subject: subject,
    p_description: description || null,
    p_due_at: dueAt || null,
    p_assigned_to_staff_id: assignedTo || null,
    /* The database defaults this to medium; sending null rather than '' lets it,
       for a caller that leaves the field alone. */
    p_priority: priority || null,
  })
  if (error) return { error: error.message }

  revalidatePath(`/workflows/${workflowId}`)
  return { ok: true }
}

/**
 * Tick or untick a task — or cancel it. The workflow id is only for the
 * revalidation; visibility and the right to change the task are RLS, and a
 * task is visible exactly when its workflow is.
 */
export async function setWorkflowTaskStatus(
  id: string,
  status: TaskStatus,
  workflowId: string,
): Promise<NoteState> {
  if (!id) return { error: 'No task selected.' }
  const supabase = await createSupabaseServerClient()
  const { error } = await supabase.rpc('set_workflow_task_status', { p_id: id, p_status: status })
  if (error) return { error: error.message }
  revalidatePath(`/workflows/${workflowId}`)
  return { ok: true }
}
