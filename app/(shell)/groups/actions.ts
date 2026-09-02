'use server'

import { revalidatePath } from 'next/cache'
import { createSupabaseServerClient } from '@/lib/supabase/server'

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
