import { createSupabaseServerClient } from '@/lib/supabase/server'

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
