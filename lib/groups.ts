import { PROVIDER_DETAIL_SELECT, SERVICE_PROVIDERS_SELECT } from '@/lib/admin-selects'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import type { UserGroupChoice } from '@/lib/user-groups'

/**
 * One client group as the index lists it.
 *
 * Only the columns the list actually shows. `group_summary` also rolls up every
 * member's name into a `members` string, which the detail page uses and this
 * deliberately does not ask for: a list of thirty groups would then carry every
 * member of every one of them to render a count.
 */
export type GroupListItem = {
  group_id: string
  name: string
  group_type: string
  status: string
  member_count: number | null
  primary_contact: string | null
}

/**
 * Every client group the caller can see, by name.
 *
 * **The set is decided by the database, not here.** `group_summary` is
 * `security_invoker`, so an adviser gets the groups they own or are assigned to
 * and an administrator gets all of them — the same rule that decides whether
 * `/groups/[id]` renders or 404s. There is no filter in this function and there
 * should not be one: a second place deciding who sees which client is a second
 * place to get it wrong.
 *
 * **Ordered in the query.** By name, so the list is stable between renders and
 * every consumer gets the same order — the standing rule that ordering belongs
 * in the query rather than the component.
 *
 * **Throws rather than returning an empty list on failure.** The house rule,
 * learned the hard way on 8 September: a discarded query `error` turns a broken
 * page into one that lies, and "no groups" is a sentence an adviser would
 * believe. A thrown error reaches the error boundary instead.
 */
export async function getVisibleGroups(): Promise<GroupListItem[]> {
  const supabase = await createSupabaseServerClient({ writable: false })
  const { data, error } = await supabase
    .from('group_summary')
    .select('group_id, name, group_type, status, member_count, primary_contact')
    .order('name')

  if (error) {
    throw new Error(`The client groups could not be read: ${error.message}`)
  }
  return (data ?? []) as GroupListItem[]
}

/** One service provider, as the register lists it. */
export type ServiceProviderItem = {
  party_id: string
  name: string
  /** The role's start date, ISO `YYYY-MM-DD`, when one was recorded. */
  since: string | null
}

/**
 * Every party holding an active `product_provider` role.
 *
 * The first read of providers as a LIST anywhere in the product — until
 * 25 September 2026 they existed only as search hits, and the search's own
 * comment conceded the hit "goes nowhere useful". The embed is the search's
 * exact shape (`parties!inner(display_name)`), which is the shape already
 * proven against the live schema, plus the role's start date.
 *
 * Sorted here rather than in the query: PostgREST orders a parent by an
 * embedded column reluctantly, and two rows do not earn the syntax.
 */
export async function getServiceProviders(): Promise<ServiceProviderItem[]> {
  const supabase = await createSupabaseServerClient({ writable: false })
  const { data, error } = await supabase
    .from('party_roles')
    .select(SERVICE_PROVIDERS_SELECT)
    .eq('role', 'product_provider')
    .eq('status', 'active')
    .is('end_date', null)
  if (error) throw new Error(`The service providers could not be read: ${error.message}`)

  return (data ?? [])
    .map((r) => {
      const row = r as Record<string, unknown>
      const party = Array.isArray(row.parties) ? row.parties[0] : row.parties
      return {
        party_id: row.party_id as string,
        name: ((party as { display_name?: string } | null)?.display_name ?? 'Unnamed') as string,
        since: (row.start_date as string | null) ?? null,
      }
    })
    .sort((a, b) => a.name.localeCompare(b.name))
}

/** One provider, as its page needs it. */
export type ServiceProviderDetail = {
  party_id: string
  name: string
  role_status: string
  since: string | null
  ended: string | null
  notes: string | null
  contact_points: { kind: string; value: string; is_preferred: boolean }[]
}

/**
 * One provider by party id, or null when that party is not a provider.
 *
 * Null covers "no such party", "a party that is somebody's client", and "not
 * visible" alike, and the page answers all three with `notFound()` — the same
 * one-answer rule the share-token page follows. NOT filtered to active: an
 * ended provider still has a page, the way an archived template does, and the
 * page says so rather than pretending the record never existed.
 */
export async function getServiceProvider(partyId: string): Promise<ServiceProviderDetail | null> {
  const supabase = await createSupabaseServerClient({ writable: false })
  const { data, error } = await supabase
    .from('party_roles')
    .select(PROVIDER_DETAIL_SELECT)
    .eq('role', 'product_provider')
    .eq('party_id', partyId)
    .maybeSingle()
  /* An ERROR is thrown, not folded into null: `getTemplate` swallowed its
     errors into a 404 and cost a day of production diagnosis this week. */
  if (error) throw new Error(`The provider could not be read: ${error.message}`)
  if (!data) return null

  const row = data as Record<string, unknown>
  const party = (Array.isArray(row.parties) ? row.parties[0] : row.parties) as {
    display_name?: string
    notes?: string | null
    contact_points?: { kind: string; value: string; is_preferred: boolean }[] | null
  } | null

  return {
    party_id: row.party_id as string,
    name: party?.display_name ?? 'Unnamed',
    role_status: row.status as string,
    since: (row.start_date as string | null) ?? null,
    ended: (row.end_date as string | null) ?? null,
    notes: party?.notes ?? null,
    contact_points: party?.contact_points ?? [],
  }
}

/** One holding with a provider, as the provider page lists it. */
export type ProviderHolding = {
  kind: 'account' | 'policy'
  group_id: string
  group_name: string
  record_id: string
  label: string
  status: string
}

/**
 * Everything held with one provider, through the reader's own keys.
 *
 * `provider_holdings` is SECURITY INVOKER over the group views, so a limited
 * adviser sees the firm's exposure only through the groups their RLS admits —
 * the page states the register is firm-wide, but the holdings list never is.
 * A joint account whose owners span two households appears once per household,
 * the same way it appears on both households' own pages.
 */
export async function getProviderHoldings(partyId: string): Promise<ProviderHolding[]> {
  const supabase = await createSupabaseServerClient({ writable: false })
  const { data, error } = await supabase
    .from('provider_holdings')
    .select('kind, group_id, group_name, record_id, label, status')
    .eq('provider_party_id', partyId)
    .order('kind')
    .order('label')
  if (error) throw new Error(`The provider's holdings could not be read: ${error.message}`)
  return (data ?? []) as ProviderHolding[]
}

/** One of a provider's key contacts — a BDM, adviser support. */
export type ProviderContact = {
  id: string
  name: string
  role_title: string | null
  email: string | null
  phone: string | null
}

/**
 * A provider's key contacts, by name.
 *
 * Deliberately NOT person parties — the table's own migration says why: a BDM
 * is somebody who serves the firm, not somebody the firm serves, and a
 * four-field row should not buy a seat in the client world to exist.
 */
export async function getProviderContacts(partyId: string): Promise<ProviderContact[]> {
  const supabase = await createSupabaseServerClient({ writable: false })
  const { data, error } = await supabase
    .from('provider_contacts')
    .select('id, name, role_title, email, phone')
    .eq('provider_party_id', partyId)
    .order('name')
  if (error) throw new Error(`The provider's contacts could not be read: ${error.message}`)
  return (data ?? []) as ProviderContact[]
}

/**
 * The user groups a household may be put in: active ones, by name.
 *
 * Readable by every active staff member (`staff_read_user_groups`), so the
 * group page can offer the list to anyone allowed to edit the household.
 * Archived groups are left out on purpose — the database refuses to newly
 * assign one, so offering it would be offering a refusal.
 *
 * Lives here rather than in `lib/user-groups.ts`, which is pure vocabulary a
 * client component imports; a Supabase import there pulls `next/headers` into
 * the browser bundle.
 *
 * Throws on error, the house rule above: an empty picker that is really a
 * failed read would tell an adviser there are no territories.
 */
export async function getActiveUserGroups(): Promise<UserGroupChoice[]> {
  const supabase = await createSupabaseServerClient({ writable: false })
  const { data, error } = await supabase
    .from('user_groups')
    .select('id, name, status')
    .eq('status', 'active')
    .order('name')
  if (error) throw new Error(`The user groups could not be read: ${error.message}`)
  return (data ?? []) as UserGroupChoice[]
}
