import { SERVICE_PROVIDERS_SELECT } from '@/lib/admin-selects'
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
