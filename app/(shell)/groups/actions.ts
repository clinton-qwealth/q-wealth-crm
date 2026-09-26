'use server'

import { revalidatePath } from 'next/cache'
import { PROVIDER_LOGO_BUCKET } from '@/lib/provider-logo'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import {
  POST_MEDIA_BUCKET,
  POST_MEDIA_SIZE_LIMIT,
  EMAIL_MARK_TYPES,
  EMAIL_NODE_TYPES,
  isEmailColour,
  isEmailFont,
  isPostDoc,
  isTaskActionKind,
  type PostDoc,
  isPostMediaType,
  isReactionKey,
  postDocText,
  type BoardColumn,
  type Priority,
  type TaskStatus,
} from '@/lib/workflow-board'
import type { WorkflowStatus } from '@/lib/notes'

/**
 * The group detail page's route, for revalidation.
 *
 * **`'page'` is not optional here.** The detail page moved from `/groups?id=`
 * to `/groups/[id]` on 10 September, and `revalidatePath` REQUIRES the type
 * argument once the path carries a dynamic segment — without it the call does
 * not match the cache entry and every write to a group would appear to succeed
 * while the screen kept showing the old figures.
 *
 * A route pattern rather than `/groups/${id}` because these actions change
 * things reachable from more than one group's page — an account has owners, a
 * note can name several parties — and refreshing every group's file is the
 * cheap, correct answer at this size. It is also why the literal string is
 * written once here instead of fifteen times.
 */
const GROUP_PAGE = '/groups/[id]' as const

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

  revalidatePath(GROUP_PAGE, 'page')
  return { ok: true }
}

export type CreateBalanceItemState = { error: string } | { ok: true } | null

/**
 * Splits 100 between n owners so the parts total exactly 100.
 *
 * Three owners is 33.33 three times, which is 99.99 — one cent of a percent
 * short, and the database refuses anything but 100. The shortfall goes to the
 * first owner rather than being rounded away, so the sum is exact by
 * construction instead of by luck.
 */
function evenShares(n: number): string[] {
  const each = Math.floor(10000 / n) / 100
  const parts = Array.from({ length: n }, () => each)
  parts[0] = Number((each + (100 - each * n)).toFixed(2))
  return parts.map((p) => p.toFixed(2))
}

/**
 * Creates an asset or a liability with its owners, via create_asset_liability().
 *
 * Shares are what this table records and `financial_account_owners` deliberately
 * does not — a house held 60/40 is ordinary, a platform account held 60/40 is
 * not. They are validated here so a typo reads as a sentence, and again in the
 * function, and again by a deferred trigger at COMMIT: three layers because the
 * figure is one somebody reads out to a client.
 */
export async function createBalanceItem(
  _prev: CreateBalanceItemState,
  formData: FormData
): Promise<CreateBalanceItemState> {
  const itemType = String(formData.get('item_type') ?? '')
  const label = String(formData.get('label') ?? '').trim()
  const rawValue = String(formData.get('value') ?? '').trim()
  const valuedOn = String(formData.get('valued_on') ?? '') || null
  const institutionId = String(formData.get('institution_party_id') ?? '') || null
  const securedAgainst = String(formData.get('secured_against_id') ?? '') || null
  const notes = String(formData.get('notes') ?? '').trim() || null
  const ownerIds = formData.getAll('owner_party_ids').map(String).filter(Boolean)

  if (!itemType) return { error: 'Choose a type.' }
  if (!label) return { error: 'Give it a name.' }
  if (ownerIds.length === 0) return { error: 'Choose at least one owner.' }

  const value = parseAmount(rawValue, 'The value')
  if (typeof value !== 'string') return value

  /* Shares are optional in the form and never optional in the database. Left
     blank they are split evenly, which is what a reader means by ticking two
     names and typing nothing; filled in, every ticked owner must carry one, so
     a half-completed split cannot silently become an even one. */
  const typed = ownerIds.map((id) => String(formData.get(`share_${id}`) ?? '').trim())
  let shares: string[]
  if (typed.every((t) => t === '')) {
    shares = evenShares(ownerIds.length)
  } else {
    if (typed.some((t) => t === '')) {
      return { error: 'Give every owner a share, or leave them all blank for an even split.' }
    }
    for (const t of typed) {
      if (!/^\d+(\.\d{1,2})?$/.test(t.replace(/[%\s]/g, ''))) {
        return { error: 'Each share must be a percentage, to at most two decimal places.' }
      }
    }
    shares = typed.map((t) => t.replace(/[%\s]/g, ''))
    const total = shares.reduce((sum, s) => sum + Number(s), 0)
    /* Compared at two decimal places, not directly: three shares of 5.00,
       63.01 and 31.99 add up to 99.99999999999999 in binary floating point,
       and refusing a split that is correct on paper would be the same class of
       bug as storing money in a float. */
    if (Number(total.toFixed(2)) !== 100) {
      return { error: `Shares must total 100%, not ${Number(total.toFixed(2))}%.` }
    }
  }

  const supabase = await createSupabaseServerClient()
  const { error } = await supabase.rpc('create_asset_liability', {
    p_item_type: itemType,
    p_label: label,
    p_value: value,
    p_owners: ownerIds.map((id, i) => ({ party_id: id, share_percent: shares[i] })),
    p_valued_on: valuedOn,
    p_institution_party_id: institutionId,
    p_secured_against_id: securedAgainst,
    p_notes: notes,
  })

  if (error) return { error: error.message }

  revalidatePath(GROUP_PAGE, 'page')
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

  revalidatePath(GROUP_PAGE, 'page')
  return { ok: true }
}

export type MemberState = { error: string } | { ok: true } | null

// ---------------------------------------------------------------------------
// Correcting an account or a policy
// ---------------------------------------------------------------------------
//
// The three fields on each that a PERSON owns, and nothing else. Everything
// else about an account now belongs to the provider feed — value, cash,
// product, allocation are all refreshed daily by ingest.promote() and a hand
// edit would be gone by morning — which is why the drawer shows them without a
// pencil beside them.
//
// Both follow patchMember exactly: a patch built by KEY PRESENCE from whatever
// the submitted form actually carried, one RPC, one revalidate. A form holding
// only a name produces a one-key patch and the database leaves the owners
// alone.

export type RecordDetailState = { error: string } | { ok: true } | null

/**
 * `owner_party_ids` is read behind a sentinel, and the sentinel is load-bearing.
 *
 * `formData.getAll('owner_party_ids')` returns `[]` in two opposite situations:
 * when the owner editor was never on the form at all, and when it was there
 * with every box unticked. Under patch semantics those mean "leave the owners
 * exactly as they are" and "remove every owner" — so without something to tell
 * them apart, emptying the list would silently do nothing at all.
 *
 * The editor renders a hidden input alongside its checkboxes; its presence is
 * what says the set was on the form and is being submitted.
 */
function readPartySet(formData: FormData, field: string, sentinel: string): string[] | undefined {
  if (!formData.has(sentinel)) return undefined
  return formData.getAll(field).map(String).filter(Boolean)
}

export async function saveAccountDetails(
  _prev: RecordDetailState,
  formData: FormData,
): Promise<RecordDetailState> {
  const accountId = String(formData.get('account_id') ?? '')
  if (!accountId) return { error: 'No account selected.' }

  const patch: Record<string, unknown> = {}
  if (formData.has('label')) patch.label = String(formData.get('label')).trim()
  if (formData.has('account_type')) patch.account_type = String(formData.get('account_type'))
  const owners = readPartySet(formData, 'owner_party_ids', 'owners_present')
  if (owners) patch.owner_party_ids = owners

  if (Object.keys(patch).length === 0) return { error: 'Nothing to save.' }
  if ('label' in patch && !patch.label) return { error: 'Give the account a name.' }
  /* Caught here so an emptied list is a sentence rather than a round trip. The
     database refuses it too — this is the friendlier of two identical answers,
     not the only one. */
  if (owners && owners.length === 0) return { error: 'Choose at least one owner.' }

  const supabase = await createSupabaseServerClient()
  const { error } = await supabase.rpc('update_financial_account_patch', {
    p_account_id: accountId,
    p_patch: patch,
  })
  /* Passed through, not rewritten. The database's refusals here are already
     sentences an adviser can act on — "One of those owners is not someone you
     can add to this account" — and rewriting them would lose exactly that one. */
  if (error) return { error: error.message }

  /* The route pattern, not one path: a jointly owned account belongs to two
     groups, and an owner edit can move it between them. */
  revalidatePath(GROUP_PAGE, 'page')
  return { ok: true }
}

/**
 * Delete an account for good.
 *
 * Plain async rather than `useActionState`, like `removeMember`: the caller is
 * a confirm dialog that has already done its own gating, and there is no form
 * to read. Two things are deliberately NOT here:
 *
 * - **The word the user typed.** "Delete" is an arming gate in the UI — it
 *   stops a slip of the hand — and not a rule. The database's rules are access
 *   (RLS, unchanged) and provider (a BEFORE DELETE trigger that refuses any
 *   account a feed maintains), and both bind the MCP and psql, which never
 *   type anything. Sending the word would imply the server checked it.
 * - **Any child cleanup.** Owners, valuations, allocations and posts cascade;
 *   a policy held in the account keeps itself and drops the link. The migration
 *   of 19 September records why that is already clean.
 *
 * The refusal sentences pass through unrewritten — "maintained by the HUB24
 * feed, so it cannot be deleted here" is the one the reader needs.
 */
export async function deleteAccount(accountId: string): Promise<RecordDetailState> {
  if (!accountId) return { error: 'No account selected.' }

  const supabase = await createSupabaseServerClient()
  const { error } = await supabase.rpc('delete_financial_account', { p_account_id: accountId })
  if (error) return { error: error.message }

  /* The route pattern: a jointly owned account was on two groups' pages. */
  revalidatePath(GROUP_PAGE, 'page')
  return { ok: true }
}

/**
 * Delete a policy for good. `deleteAccount` with the noun changed and the
 * same two deliberate absences — the typed word and any child cleanup — for
 * the reasons written there. No provider rule applies: no feed maintains a
 * policy, so there is nothing for the database to refuse on that ground.
 */
export async function deletePolicy(policyId: string): Promise<RecordDetailState> {
  if (!policyId) return { error: 'No policy selected.' }

  const supabase = await createSupabaseServerClient()
  const { error } = await supabase.rpc('delete_insurance_policy', { p_policy_id: policyId })
  if (error) return { error: error.message }

  /* The route pattern: a policy whose owner and life insured sit in two
     groups was on both of their pages. */
  revalidatePath(GROUP_PAGE, 'page')
  return { ok: true }
}

export async function savePolicyDetails(
  _prev: RecordDetailState,
  formData: FormData,
): Promise<RecordDetailState> {
  const policyId = String(formData.get('policy_id') ?? '')
  if (!policyId) return { error: 'No policy selected.' }

  const patch: Record<string, unknown> = {}
  if (formData.has('label')) patch.label = String(formData.get('label')).trim()
  const owners = readPartySet(formData, 'owner_party_ids', 'owners_present')
  const lives = readPartySet(formData, 'life_insured_party_ids', 'lives_present')
  if (owners) patch.owner_party_ids = owners
  if (lives) patch.life_insured_party_ids = lives

  if (Object.keys(patch).length === 0) return { error: 'Nothing to save.' }
  if ('label' in patch && !patch.label) return { error: 'Give the policy a name.' }
  if (owners && owners.length === 0) return { error: 'Choose at least one owner.' }
  if (lives && lives.length === 0) return { error: 'Name at least one life insured.' }

  const supabase = await createSupabaseServerClient()
  const { error } = await supabase.rpc('update_insurance_policy_patch', {
    p_policy_id: policyId,
    p_patch: patch,
  })
  if (error) return { error: error.message }

  revalidatePath(GROUP_PAGE, 'page')
  return { ok: true }
}

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

  revalidatePath(GROUP_PAGE, 'page')
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

  revalidatePath(GROUP_PAGE, 'page')
  return { ok: true }
}

/**
 * Take a member out of a group.
 *
 * **It ends the membership rather than deleting it** — `end_group_membership()`
 * sets an end date, and every read in the application already filters on that,
 * so one write removes the person from the group's members, its accounts, its
 * policies, its wealth figures and its mix ring at once while the record of
 * their having been there survives.
 *
 * The guards are in the database, not here, so they bind the MCP and psql too:
 * an active staff member, a membership that is actually current, and a refusal
 * when the person is the group's own primary contact. **The refusal is shown
 * rather than swallowed** — the database's own message names who it is and what
 * to do instead, and rewriting it here would lose that.
 */
export async function removeMember(groupId: string, partyId: string): Promise<MemberState> {
  if (!groupId || !partyId) return { error: 'No member selected.' }

  const supabase = await createSupabaseServerClient()
  const { error } = await supabase.rpc('end_group_membership', {
    p_group_id: groupId,
    p_party_id: partyId,
  })
  if (error) return { error: error.message }

  revalidatePath(GROUP_PAGE, 'page')
  return { ok: true }
}

/**
 * Change a member's role within this group.
 *
 * A role was set when somebody was added and never afterwards — the gap this
 * closes. The guards live in `set_member_role()` so they bind every caller.
 */
export async function setMemberRole(
  groupId: string,
  partyId: string,
  role: string,
): Promise<MemberState> {
  if (!groupId || !partyId || !role) return { error: 'No member selected.' }

  const supabase = await createSupabaseServerClient()
  const { error } = await supabase.rpc('set_member_role', {
    p_group_id: groupId,
    p_party_id: partyId,
    p_member_role: role,
  })
  if (error) return { error: error.message }

  revalidatePath(GROUP_PAGE, 'page')
  return { ok: true }
}

/**
 * Hand a group's primary contact to another of its current members.
 *
 * **It moves the contact rather than clearing it**, which is what keeps "every
 * group has one" true by construction — there is no state in between. The
 * database refuses anybody who is not a current member, so the group can never
 * be left pointing at a stranger.
 */
export async function setPrimaryContact(
  groupId: string,
  partyId: string,
): Promise<MemberState> {
  if (!groupId || !partyId) return { error: 'Choose who takes it.' }

  const supabase = await createSupabaseServerClient()
  const { error } = await supabase.rpc('set_group_primary_contact', {
    p_group_id: groupId,
    p_party_id: partyId,
  })
  if (error) return { error: error.message }

  revalidatePath(GROUP_PAGE, 'page')
  return { ok: true }
}

/**
 * Set which user groups (territories) a household belongs to. Any number, and
 * an empty list takes it out of all of them.
 *
 * One database function, `set_client_group_user_groups`, governed by the same
 * policy that lets somebody edit the household at all — this adds no reach.
 * The refusals are its sentences, unrewritten: an archived group newly chosen,
 * a household the caller may not change. The shape checks are the front-door
 * rule, and the ids are de-duplicated so a repeated one is not an argument the
 * database has to have an opinion about.
 *
 * Three revalidations: the household's own page (the pills), the groups index
 * (whose rows a territory may now hide from a limited colleague), and the
 * admin page (the User groups tab counts households).
 */
export async function setGroupUserGroups(groupId: string, userGroupIds: string[]): Promise<RecordDetailState> {
  if (!UUID_SHAPE.test(groupId)) return { error: 'No group selected.' }
  if (!userGroupIds.every((id) => UUID_SHAPE.test(id))) return { error: 'Choose user groups from the list.' }

  const supabase = await createSupabaseServerClient()
  /* SET-REPLACING: the array is the household's whole set, and an empty one
     takes it out of every territory. That is the contract the database function
     states, and the checkbox set in front of it submits exactly that. */
  const { error } = await supabase.rpc('set_client_group_user_groups', {
    p_group_id: groupId,
    p_user_group_ids: [...new Set(userGroupIds)],
  })
  if (error) return { error: error.message }

  revalidatePath(GROUP_PAGE, 'page')
  revalidatePath('/groups')
  revalidatePath('/admin')
  return { ok: true }
}

const UUID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Record a staff opt-in or opt-out for one communication channel.
 *
 * **A channel the client unsubscribed from themselves is refused**, by the
 * database rather than by this function, so the rule holds for the connector
 * and psql too. The message says so in the client's terms, and is shown rather
 * than swallowed — it is the one refusal here that a reader must not mistake
 * for a fault.
 */
export async function setSubscription(
  partyId: string,
  channel: string,
  optedIn: boolean,
): Promise<MemberState> {
  if (!partyId || !channel) return { error: 'No channel selected.' }

  const supabase = await createSupabaseServerClient()
  const { error } = await supabase.rpc('set_subscription', {
    p_party_id: partyId,
    p_channel: channel,
    p_opted_in: optedIn,
  })
  if (error) return { error: error.message }

  revalidatePath(GROUP_PAGE, 'page')
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

  revalidatePath(GROUP_PAGE, 'page')
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
  revalidatePath(GROUP_PAGE, 'page')
  return { ok: true, passed: body.passed as boolean, outcome_source: body.outcome_source as string }
}

/** The fallback path: no code could be delivered and a named adviser vouched. */
export async function attestVerification(id: string, passed: boolean): Promise<VerifyOutcome> {
  const body = await callVerify('/attest', { verification_id: id, passed })
  if ('error' in body) return { error: body.error as string }
  revalidatePath(GROUP_PAGE, 'page')
  return { ok: true, passed: body.passed as boolean, outcome_source: body.outcome_source as string }
}

export async function abandonVerification(id: string, reason?: string) {
  const body = await callVerify('/abandon', { verification_id: id, status: 'cancelled', reason })
  if ('error' in body) return { error: body.error as string }
  revalidatePath(GROUP_PAGE, 'page')
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

  revalidatePath(GROUP_PAGE, 'page')
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

  revalidatePath(GROUP_PAGE, 'page')
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

  revalidatePath(GROUP_PAGE, 'page')
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

  revalidatePath(GROUP_PAGE, 'page')
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
  revalidatePath(GROUP_PAGE, 'page')
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
  revalidatePath(GROUP_PAGE, 'page')
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
  revalidatePath(GROUP_PAGE, 'page')
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

/**
 * A task's assignee, due date, description and comment, from the panel's field
 * boxes.
 *
 * **A patch where key presence decides**, not four parameters defaulting to
 * null — the contract `set_workflow_details()` already uses, and the reason is
 * the same: null cannot mean both "leave this alone" and "clear this". So only
 * the fields the submitted box actually carried go into the patch. That is what
 * lets the Details box and the Completion box write through ONE function
 * without either clearing the other's columns.
 *
 * Subject, status and priority are not writable here: each has its own path.
 */
export async function saveWorkflowTaskDetails(
  _prev: NoteState,
  formData: FormData,
): Promise<NoteState> {
  const id = String(formData.get('task_id') ?? '')
  if (!id) return { error: 'No task selected.' }

  const patch: Record<string, string> = {}
  for (const key of ['assigned_to_staff_id', 'due_at', 'description', 'comment'] as const) {
    if (formData.has(key)) patch[key] = String(formData.get(key) ?? '')
  }

  const supabase = await createSupabaseServerClient()
  const { error } = await supabase.rpc('set_workflow_task_details', { p_id: id, p_patch: patch })
  if (error) return { error: error.message }

  /* Only the workflow's own page shows a task. The id rides along in the form
     because the panel knows it and the task row does not carry it into the
     patch — see the test that asserts it never leaks in. */
  const workflowId = String(formData.get('workflow_id') ?? '')
  if (workflowId) revalidatePath(`/workflows/${workflowId}`)
  return { ok: true }
}

/**
 * A task's priority, from the glyph on its row. The first caller of
 * set_workflow_task_priority(), which had waited in the database since the
 * column arrived. Only the task's own page shows a task, so that is the one
 * path revalidated.
 */
export async function setWorkflowTaskPriority(
  id: string,
  priority: Priority,
  workflowId: string,
): Promise<NoteState> {
  if (!id) return { error: 'No task selected.' }
  const supabase = await createSupabaseServerClient()
  const { error } = await supabase.rpc('set_workflow_task_priority', { p_id: id, p_priority: priority })
  if (error) return { error: error.message }
  revalidatePath(`/workflows/${workflowId}`)
  return { ok: true }
}

/**
 * A post on a workflow's timeline — about one task when `taskId` is given, or
 * about the workflow itself when it is null.
 *
 * The body is a document, not text and never HTML. Two cheap checks here save
 * a round trip for the obvious cases; the database does the real validation —
 * node and mark types, link schemes, mentions — and its message comes back
 * verbatim, because it is the one that knows why.
 */
export async function postWorkflowActivity(
  workflowId: string,
  taskId: string | null,
  body: unknown,
  /**
   * The post being answered, when this is a reply.
   *
   * Only the id travels. The reply's thread root is DERIVED by the database
   * from the parent and never sent from here — a client that could name its
   * own root could put a reply in somebody else's conversation.
   */
  parentPostId: string | null = null,
): Promise<NoteState> {
  if (!workflowId) return { error: 'No workflow selected.' }
  if (!isPostDoc(body)) return { error: 'A post must be a document.' }
  if (!postDocText(body)) return { error: 'Write something before posting.' }

  const supabase = await createSupabaseServerClient()
  const { error } = await supabase.rpc('post_workflow_activity', {
    p_workflow_id: workflowId,
    p_task_id: taskId,
    p_body: body,
    p_parent_post_id: parentPostId,
  })
  if (error) return { error: error.message }

  revalidatePath(`/workflows/${workflowId}`)
  return { ok: true }
}

/**
 * Add or take away the caller's reaction to a post.
 *
 * The key is checked against the six the feed offers before any call, so a
 * client sending "poop" gets a sentence rather than a constraint name. The
 * database toggles — one row per person per reaction — and stamps the person
 * from the session; the row a person may delete is their own.
 */
export async function togglePostReaction(
  workflowId: string,
  postId: string,
  reaction: unknown,
): Promise<NoteState> {
  if (!workflowId) return { error: 'No workflow selected.' }
  if (!postId) return { error: 'No post selected.' }
  if (!isReactionKey(reaction)) return { error: 'Not a reaction this feed offers.' }

  const supabase = await createSupabaseServerClient()
  const { error } = await supabase.rpc('toggle_post_reaction', {
    p_post_id: postId,
    p_reaction: reaction,
  })
  if (error) return { error: error.message }

  revalidatePath(`/workflows/${workflowId}`)
  return { ok: true }
}

/**
 * Post to a financial account's activity.
 *
 * The same table, the same document rules and the same RPC family as a
 * workflow post — `post_account_activity()` and `post_workflow_activity()`
 * share `validate_post_body()` in the database, so a document refused on one is
 * refused on the other with the same sentence.
 *
 * TWO ACTIONS RATHER THAN ONE WITH A SCOPE ARGUMENT, and the difference between
 * them is one line: which route to revalidate. An account post lives on the
 * group page, a workflow post on the workflow's. Threading a discriminated
 * union through a working action to save four lines would have been the more
 * clever and less readable choice.
 */
export async function postAccountActivity(
  accountId: string,
  body: unknown,
  /** The post being answered. Only the id travels; the thread root is derived
   *  by the database from the parent, never sent from here. */
  parentPostId: string | null = null,
): Promise<NoteState> {
  if (!accountId) return { error: 'No account selected.' }
  if (!isPostDoc(body)) return { error: 'A post must be a document.' }
  if (!postDocText(body)) return { error: 'Write something before posting.' }

  const supabase = await createSupabaseServerClient()
  const { error } = await supabase.rpc('post_account_activity', {
    p_account_id: accountId,
    p_body: body,
    p_parent_post_id: parentPostId,
  })
  if (error) return { error: error.message }

  /* The route pattern, not one path — the same call the rest of this file
     makes, and for the same reason: a jointly owned account belongs to two
     groups and this post is on both of their pages. */
  revalidatePath(GROUP_PAGE, 'page')
  return { ok: true }
}

/**
 * Add or take away the caller's reaction to a post on an account.
 *
 * The RPC is the same one workflow posts use and needs no account: a reaction
 * is keyed by post alone, and the post's own row-level security decides. What
 * differs is only the route to revalidate.
 */
export async function toggleAccountPostReaction(
  postId: string,
  reaction: unknown,
): Promise<NoteState> {
  if (!postId) return { error: 'No post selected.' }
  if (!isReactionKey(reaction)) return { error: 'Not a reaction this feed offers.' }

  const supabase = await createSupabaseServerClient()
  const { error } = await supabase.rpc('toggle_post_reaction', {
    p_post_id: postId,
    p_reaction: reaction,
  })
  if (error) return { error: error.message }

  revalidatePath(GROUP_PAGE, 'page')
  return { ok: true }
}

/**
 * Post to an insurance policy's activity.
 *
 * The third scope, 19 Sep 2026, and the third action rather than a scope
 * argument on one — the reasoning on `postAccountActivity` holds a third time.
 * `post_policy_activity()` shares `validate_post_body()` with the other two,
 * so a document refused on one is refused on all with the same sentence.
 */
export async function postPolicyActivity(
  policyId: string,
  body: unknown,
  parentPostId: string | null = null,
): Promise<NoteState> {
  if (!policyId) return { error: 'No policy selected.' }
  if (!isPostDoc(body)) return { error: 'A post must be a document.' }
  if (!postDocText(body)) return { error: 'Write something before posting.' }

  const supabase = await createSupabaseServerClient()
  const { error } = await supabase.rpc('post_policy_activity', {
    p_policy_id: policyId,
    p_body: body,
    p_parent_post_id: parentPostId,
  })
  if (error) return { error: error.message }

  /* The route pattern: a policy whose owner and life insured sit in two groups
     is on both of their pages. */
  revalidatePath(GROUP_PAGE, 'page')
  return { ok: true }
}

/**
 * Add or take away the caller's reaction to a post on a policy.
 *
 * Byte for byte the account version: the RPC keys by post alone. It exists
 * under its own name because an action is named for the scope whose page it
 * revalidates, and a reader of the feed's dispatch should see that scope.
 */
export async function togglePolicyPostReaction(
  postId: string,
  reaction: unknown,
): Promise<NoteState> {
  if (!postId) return { error: 'No post selected.' }
  if (!isReactionKey(reaction)) return { error: 'Not a reaction this feed offers.' }

  const supabase = await createSupabaseServerClient()
  const { error } = await supabase.rpc('toggle_post_reaction', {
    p_post_id: postId,
    p_reaction: reaction,
  })
  if (error) return { error: error.message }

  revalidatePath(GROUP_PAGE, 'page')
  return { ok: true }
}

export type PostMediaSlot = { id: string; storage_path: string }
export type PostMediaState = { error: string } | PostMediaSlot

/**
 * Reserve a place for a file a post will carry, before its bytes are uploaded.
 *
 * ROW FIRST, THEN BYTES. The order is not an implementation detail: the storage
 * policy that decides whether this staff member may write this path works by
 * matching the path against a `workflow_post_media` row belonging to them. With
 * no row there is nothing to check against, and the bucket becomes a place any
 * staff member can write anything.
 *
 * The bytes themselves go straight from the browser to Storage rather than
 * through this action. A Server Action's request body is capped at 1 MB by
 * default, and routing ten megabytes through the server would send them over
 * the wire twice for no gain — the upload is evaluated by the same RLS either
 * way.
 *
 * The checks here are the cheap ones, so a 40 MB drop is refused before any
 * round trip. `create_post_media()` checks them all again, and the bucket's own
 * `file_size_limit` and `allowed_mime_types` are the rule.
 */
export async function createPostMedia(
  workflowId: string,
  file: { mime: string; size: number; name: string; width?: number | null; height?: number | null },
): Promise<PostMediaState> {
  if (!workflowId) return { error: 'No workflow selected.' }
  if (!file?.name?.trim()) return { error: 'That file has no name.' }
  if (!isPostMediaType(file.mime)) {
    return { error: 'A post can carry images, PDFs, Word, Excel, CSV and text files.' }
  }
  if (!(file.size > 0)) return { error: 'That file is empty.' }
  if (file.size > POST_MEDIA_SIZE_LIMIT) {
    return { error: `That file is larger than the ${POST_MEDIA_SIZE_LIMIT / 1024 / 1024} MB limit.` }
  }

  const supabase = await createSupabaseServerClient()
  const { data, error } = await supabase.rpc('create_post_media', {
    p_workflow_id: workflowId,
    p_mime_type: file.mime,
    p_byte_size: file.size,
    p_original_name: file.name.trim(),
    p_width: file.width ?? null,
    p_height: file.height ?? null,
  })
  if (error) return { error: error.message }

  const row = data as { id?: string; storage_path?: string } | null
  if (!row?.id || !row?.storage_path) {
    return { error: 'The upload could not be started. Try again.' }
  }
  // No revalidation: nothing on the page reads this row until it is posted.
  return { id: row.id, storage_path: row.storage_path }
}

/**
 * Take an image off a post without altering the post.
 *
 * A post is append-only — a correction is a new post — so this does not touch
 * it. The media row is marked redacted and the bytes are deleted; the feed then
 * draws a sentence saying who removed it, in the place the picture was. A
 * redaction is a STATE, which is the same reasoning that gave the reactions
 * table the only other write-back under this feed.
 *
 * Two steps, in this order, and the order is what the storage policy relies on:
 * the delete policy permits removing the bytes only for a row that is ALREADY
 * marked. If the second step fails the row still reads as redacted, so the
 * screen is correct and the bytes are what a sweep collects — the failure that
 * leaves a stale row visible is the one worth avoiding, and this is not it.
 */
export async function redactPostMedia(workflowId: string, mediaId: string): Promise<NoteState> {
  if (!workflowId) return { error: 'No workflow selected.' }
  if (!mediaId) return { error: 'No file selected.' }

  const supabase = await createSupabaseServerClient()
  const { data: path, error } = await supabase.rpc('redact_post_media', { p_id: mediaId })
  if (error) return { error: error.message }

  if (typeof path === 'string' && path) {
    await supabase.storage.from(POST_MEDIA_BUCKET).remove([path])
  }

  revalidatePath(`/workflows/${workflowId}`)
  return { ok: true }
}

/**
 * Record an action taken from a task's Tools and Actions tab. Today: an email.
 *
 * **Nothing is sent.** This writes what the person did, and the naming is
 * deliberate throughout — `recordTaskAction`, not `sendEmail` — because a
 * function called send that does not send is the kind of thing somebody later
 * builds a compliance claim on.
 *
 * It also deliberately does NOT write a `notes` row of type `email_record`.
 * That is where an email to a client belongs, and it is where it will go once
 * sending is real; putting it there now would put a line in the client's
 * permanent file saying they were contacted when they were not. The reasoning
 * is in the migration.
 *
 * The body is validated here as a document on the EMAIL list — narrower than a
 * post's — so a mention or a picture is a sentence rather than a refusal from
 * the database. The database checks the same list again, because it is the gate.
 */
export async function recordTaskAction(
  workflowId: string,
  taskId: string,
  kind: unknown,
  recipient: unknown,
  sender: unknown,
  subject: unknown,
  body: unknown,
): Promise<NoteState> {
  if (!workflowId) return { error: 'No workflow selected.' }
  if (!taskId) return { error: 'No task selected.' }
  if (!isTaskActionKind(kind)) return { error: 'Not an action this task can record.' }

  const to = typeof recipient === 'string' ? recipient.trim() : ''
  if (!to) return { error: 'An email needs a recipient.' }

  if (body !== null && body !== undefined) {
    if (!isPostDoc(body)) return { error: 'A message must be a document.' }
    const problem = emailBodyProblem(body)
    if (problem) return { error: problem }
  }

  const supabase = await createSupabaseServerClient()
  const { error } = await supabase.rpc('record_task_action', {
    p_workflow_id: workflowId,
    p_task_id: taskId,
    p_kind: kind,
    p_recipient: to,
    p_sender: typeof sender === 'string' ? sender.trim() : null,
    p_subject: typeof subject === 'string' ? subject.trim() : null,
    p_body: body ?? null,
  })
  if (error) return { error: error.message }

  revalidatePath(`/workflows/${workflowId}`)
  return { ok: true }
}

/**
 * What is wrong with an email body, as a sentence — or null if nothing is.
 *
 * Checked here as well as in the database, for the reason the link row checks
 * a scheme before posting: a refusal the writer can read beats a Postgres
 * error relayed through a modal. The DATABASE is still the gate; this only
 * decides who gets to phrase the message.
 *
 * Walks the whole tree rather than the top level: a mention lives inside a
 * paragraph, and a `textStyle` mark inside a run of text.
 */
function emailBodyProblem(doc: PostDoc): string | null {
  const nodes = new Set<string>([...EMAIL_NODE_TYPES])
  const marks = new Set<string>([...EMAIL_MARK_TYPES])
  let problem: string | null = null

  const walk = (node: unknown) => {
    if (problem || !node || typeof node !== 'object') return
    const n = node as { type?: unknown; content?: unknown; marks?: unknown }
    if (typeof n.type === 'string' && !nodes.has(n.type)) {
      problem = `A message may not contain a ${n.type}.`
      return
    }
    if (Array.isArray(n.marks)) {
      for (const mark of n.marks) {
        const m = mark as { type?: unknown; attrs?: { fontFamily?: unknown; color?: unknown } }
        if (typeof m.type !== 'string' || !marks.has(m.type)) {
          problem = `A message may not contain a ${String(m.type)}.`
          return
        }
        /* The two values a writer chooses rather than we do. A font off the
           list and a colour that is not six hex digits are both refused
           rather than stripped: neither came from this application. */
        if (m.attrs?.fontFamily !== undefined && !isEmailFont(m.attrs.fontFamily)) {
          problem = 'That is not a font a message may use.'
          return
        }
        if (m.attrs?.color !== undefined && !isEmailColour(m.attrs.color)) {
          problem = 'A colour must be six hex digits, like #1a4d8f.'
          return
        }
      }
    }
    if (Array.isArray(n.content)) for (const child of n.content) walk(child)
  }

  walk(doc)
  return problem
}

/* -------------------------------------------------------------------------- */
/* Workflow templates                                                          */
/* -------------------------------------------------------------------------- */

/**
 * Deploy a published template into this workflow.
 *
 * The role map arrives as a plain object from the dialog's selects, keyed by
 * role id. Validated only for shape here — that every role a task uses has a
 * person, that nobody named is inactive, and that the template is published are
 * all the database's answers, and its sentences pass through unrewritten.
 */
export async function deployWorkflowTemplate(
  _prev: NoteState,
  formData: FormData,
): Promise<NoteState> {
  const templateId = String(formData.get('template_id') ?? '')
  const workflowId = String(formData.get('workflow_id') ?? '')
  const startDate = String(formData.get('start_date') ?? '').trim()
  if (!templateId) return { error: 'Choose a template.' }
  if (!workflowId) return { error: 'No workflow selected.' }

  /* One select per role, named `role:<uuid>`. A map rather than two parallel
     lists: the pairing is then visible at the call site and cannot slip. */
  const roleStaff: Record<string, string> = {}
  for (const [key, value] of formData.entries()) {
    if (!key.startsWith('role:')) continue
    const person = String(value).trim()
    if (person) roleStaff[key.slice(5)] = person
  }

  const supabase = await createSupabaseServerClient()
  const { error } = await supabase.rpc('deploy_workflow_template', {
    p_template_id: templateId,
    p_workflow_id: workflowId,
    p_start_date: startDate || null,
    p_role_staff: roleStaff,
  })
  if (error) return { error: error.message }
  revalidatePath(`/workflows/${workflowId}`)
  return { ok: true }
}

/**
 * Complete a task whose prerequisites are not done.
 *
 * The SAME RPC as an ordinary completion — `set_workflow_task_status` — because
 * the override record is written by a database trigger in the same transaction
 * as the status change. That is the whole guarantee: a blocked completion
 * cannot happen without its record, and no client can produce one without the
 * other. This action exists as a separate name only so the component's confirm
 * step reads as what it is, and so the reason is recorded as a comment on the
 * task where a person will actually find it.
 */
export async function completeWorkflowTaskEarly(
  taskId: string,
  workflowId: string,
  reason: string,
): Promise<NoteState> {
  if (!taskId) return { error: 'No task selected.' }
  const supabase = await createSupabaseServerClient()

  const note = reason.trim()
  if (note) {
    const { error } = await supabase.rpc('set_workflow_task_details', {
      p_id: taskId,
      p_patch: { comment: note },
    })
    if (error) return { error: error.message }
  }

  const { error } = await supabase.rpc('set_workflow_task_status', {
    p_id: taskId,
    p_status: 'done',
  })
  if (error) return { error: error.message }
  revalidatePath(`/workflows/${workflowId}`)
  return { ok: true }
}

/* -------------------------------------------------------------------------- */
/* The registers' own creators, 26 Sep 2026                                    */
/* -------------------------------------------------------------------------- */

/**
 * Widened the way `TemplateCreateState` is and for the same reason: both
 * dialogs navigate INTO the record they made — an empty household goes
 * straight to its page to be given members, a provider to its skeleton —
 * and hunting the new row out of the register would be a wasted step.
 */
export type RegisterCreateState = { error: string } | { ok: true; id: string } | null

export async function createClientGroup(
  _prev: RegisterCreateState,
  formData: FormData,
): Promise<RegisterCreateState> {
  const name = String(formData.get('name') ?? '').trim()
  const groupType = String(formData.get('group_type') ?? '')
  if (!name) return { error: 'Give the group a name.' }
  /* The register the dialog sits on decides the type; a value outside the
     enum would only produce a Postgres error worded for nobody. */
  if (groupType !== 'household' && groupType !== 'business_entity') {
    return { error: 'Choose what kind of group this is.' }
  }

  const supabase = await createSupabaseServerClient()
  const { data, error } = await supabase.rpc('create_client_group', {
    p_name: name,
    p_group_type: groupType,
  })
  if (error) return { error: error.message }
  revalidatePath('/groups')
  return { ok: true, id: data as string }
}

/** The provider page's route, for revalidation — dynamic, so 'page' is
 *  required, the same trap GROUP_PAGE documents. */
const PROVIDER_PAGE = '/groups/providers/[partyId]' as const

export type ProviderContactState = { error: string } | { ok: true } | null

/**
 * Set or remove a provider's logo — `setStaffAvatar`'s protocol on the
 * register's bucket. THE ROW FIRST, THEN THE BYTES: the function validates the
 * path (this provider's prefix, object already uploaded) and returns what it
 * replaced; only then are the old bytes removed, best effort, because the row
 * already says what the logo is.
 */
export async function setProviderLogo(partyId: string, path: string | null): Promise<ProviderContactState> {
  if (!partyId) return { error: 'No provider selected.' }

  const supabase = await createSupabaseServerClient()
  const { data, error } = await supabase.rpc('set_provider_logo', {
    p_party_id: partyId,
    p_path: path,
  })
  if (error) return { error: error.message }

  const replaced = typeof data === 'string' && data ? data : null
  if (replaced) {
    await supabase.storage.from(PROVIDER_LOGO_BUCKET).remove([replaced])
  }

  revalidatePath(PROVIDER_PAGE, 'page')
  revalidatePath('/groups')
  return { ok: true }
}

export async function addProviderContact(
  _prev: ProviderContactState,
  formData: FormData,
): Promise<ProviderContactState> {
  const providerPartyId = String(formData.get('provider_party_id') ?? '')
  const name = String(formData.get('name') ?? '').trim()
  if (!name) return { error: 'Give the contact a name.' }

  const supabase = await createSupabaseServerClient()
  const { error } = await supabase.rpc('add_provider_contact', {
    p_provider_party_id: providerPartyId,
    p_name: name,
    /* Empty strings become nulls in the function, so "no email" is NULL in the
       row rather than '' — one spelling of absent. */
    p_role_title: String(formData.get('role_title') ?? ''),
    p_email: String(formData.get('email') ?? ''),
    p_phone: String(formData.get('phone') ?? ''),
  })
  if (error) return { error: error.message }
  revalidatePath(PROVIDER_PAGE, 'page')
  return { ok: true }
}

export async function removeProviderContact(contactId: string): Promise<ProviderContactState> {
  const supabase = await createSupabaseServerClient()
  const { error } = await supabase.rpc('remove_provider_contact', { p_id: contactId })
  if (error) return { error: error.message }
  revalidatePath(PROVIDER_PAGE, 'page')
  return { ok: true }
}

export async function createServiceProvider(
  _prev: RegisterCreateState,
  formData: FormData,
): Promise<RegisterCreateState> {
  const name = String(formData.get('name') ?? '').trim()
  if (!name) return { error: 'Give the provider a name.' }

  const supabase = await createSupabaseServerClient()
  const { data, error } = await supabase.rpc('create_service_provider', { p_name: name })
  /* The duplicate guard's message ("A provider with that name already
     exists") is written for a person and passes through verbatim. */
  if (error) return { error: error.message }
  revalidatePath('/groups')
  return { ok: true, id: data as string }
}
