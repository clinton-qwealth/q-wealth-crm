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
