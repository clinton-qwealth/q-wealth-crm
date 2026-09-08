import { createSupabaseServerClient } from '@/lib/supabase/server'
import type {
  WorkflowPost, BoardCard, EntityChoice, WorkflowDetail, WorkflowTask } from '@/lib/workflow-board'

/**
 * Every workflow the caller can see, across every group — the view is
 * security_invoker, so RLS on workflows and client_groups decides.
 *
 * Ordered newest-touched first, which within a lane means "most recently
 * moved at the top". There is no manual rank yet: a rank column is the first
 * thing a real board grows, and it should be added when somebody reaches for
 * it rather than guessed at now.
 */
export async function getWorkflowBoard(): Promise<{ cards: BoardCard[]; cancelled: number }> {
  const supabase = await createSupabaseServerClient({ writable: false })
  const { data } = await supabase
    .from('workflow_board')
    .select(
      'id, name, workflow_type, status, priority, group_id, group_name, owner_name, started_at, completed_at, updated_at',
    )
    .order('updated_at', { ascending: false })

  const rows = (data ?? []) as BoardCard[]
  return {
    cards: rows.filter((r) => r.status !== 'cancelled'),
    cancelled: rows.filter((r) => r.status === 'cancelled').length,
  }
}

/** The groups a workflow could be started for, for the board's picker. */
export async function getGroupChoices(): Promise<{ id: string; name: string }[]> {
  const supabase = await createSupabaseServerClient({ writable: false })
  const { data } = await supabase.from('group_summary').select('group_id, name').order('name')
  return (data ?? []).map((g) => ({ id: g.group_id as string, name: g.name as string }))
}

/**
 * One workflow, for its detail page — or null when there is no such row OR
 * the caller may not see it. The view is security_invoker, so those two cases
 * are the same answer on purpose: a workflow an adviser cannot see should not
 * be distinguishable from one that does not exist.
 */
export async function getWorkflow(id: string): Promise<WorkflowDetail | null> {
  const supabase = await createSupabaseServerClient({ writable: false })
  const { data, error } = await supabase
    .from('workflow_board')
    .select(
      /* The card's columns plus the three only this page reads. The board's own
         query deliberately does not ask for these — see WorkflowDetail. */
      'id, name, workflow_type, status, priority, group_id, group_name, owner_name, owner_staff_id, started_at, completed_at, updated_at, created_at, due_at, description',
    )
    .eq('id', id)
    .maybeSingle()
  return error ? null : ((data as WorkflowDetail | null) ?? null)
}

/**
 * Active staff, for the owner picker on the detail page.
 *
 * From `staff_directory` rather than `staff_users`: the directory is readable by
 * every active staff member, where the base table is not — which is the whole
 * reason the view exists. See the Data Model page.
 */
export async function getStaffChoices(): Promise<{ id: string; name: string }[]> {
  const supabase = await createSupabaseServerClient({ writable: false })
  const { data } = await supabase
    .from('staff_directory')
    .select('id, full_name, status')
    .eq('status', 'active')
    .order('full_name')
  return (data ?? []).map((s) => ({ id: s.id as string, name: s.full_name as string }))
}

/**
 * A workflow's tasks, **soonest due first**. Through the security_invoker view,
 * so a task is visible exactly when its workflow is.
 *
 * `nullsFirst: false` puts the undated tasks after the dated ones rather than
 * before: Postgres would sort NULLs last for an ascending order anyway, but
 * saying so means the order does not depend on knowing that. A task with no
 * deadline is not due sooner than every task that has one.
 *
 * `created_at` breaks the tie, so tasks sharing a due date — which
 * template-generated tasks will — keep the order they were made in rather than
 * shuffling between renders.
 */
export async function getWorkflowTasks(workflowId: string): Promise<WorkflowTask[]> {
  const supabase = await createSupabaseServerClient({ writable: false })
  const { data } = await supabase
    .from('workflow_tasks_summary')
    .select(
      'id, workflow_id, task_type, subject, description, comment, due_at, status, priority, assigned_to_staff_id, assigned_to_name, completed_at, created_at, updated_at',
    )
    .eq('workflow_id', workflowId)
    .order('due_at', { ascending: true, nullsFirst: false })
    .order('created_at', { ascending: true })
  return (data ?? []) as WorkflowTask[]
}

/**
 * What a post on this workflow may name with `#`.
 *
 * THE SAME SET THE DATABASE WILL ACCEPT, and that is the point of loading it
 * here rather than offering a search across the whole CRM: the workflow's own
 * client group, that group's current members, and the group's other
 * workflows. `post_workflow_activity()` enforces exactly this, so the menu
 * cannot offer something that would then be refused — and, more importantly,
 * cannot become the only thing standing between a chip and a disclosure. See
 * the rule at the top of the entities migration.
 *
 * Two round trips rather than one join: members are parties, and the label
 * worth showing is the one `clients` gives — which also filters out a party in
 * the group that is not an active client. A join through PostgREST would have
 * to pick one or the other.
 */
export async function getWorkflowEntityChoices(
  workflowId: string,
): Promise<EntityChoice[]> {
  const supabase = await createSupabaseServerClient({ writable: false })

  const { data: workflow } = await supabase
    .from('workflow_board')
    .select('group_id, group_name')
    .eq('id', workflowId)
    .maybeSingle()
  if (!workflow?.group_id) return []

  const groupId = workflow.group_id as string
  const [{ data: members }, { data: siblings }] = await Promise.all([
    supabase.from('client_group_members').select('party_id').eq('group_id', groupId).is('end_date', null),
    supabase.from('workflow_board').select('id, name').eq('group_id', groupId).order('updated_at', { ascending: false }),
  ])

  const partyIds = (members ?? []).map((m) => m.party_id as string).filter(Boolean)
  const { data: clients } = partyIds.length
    ? await supabase.from('clients').select('party_id, display_name').in('party_id', partyIds)
    : { data: [] }

  return [
    { kind: 'group' as const, id: groupId, label: (workflow.group_name as string) ?? 'This group' },
    ...(clients ?? []).map((c) => ({
      kind: 'client' as const,
      id: c.party_id as string,
      label: (c.display_name as string) ?? 'Unnamed',
    })),
    /* The post's own workflow is left out: a post naming the thing it is
       already on says nothing. */
    ...(siblings ?? [])
      .filter((w) => (w.id as string) !== workflowId)
      .map((w) => ({ kind: 'workflow' as const, id: w.id as string, label: (w.name as string) ?? 'Untitled' })),
  ]
}

/**
 * Every post on the workflow — with a task or without — **newest first**.
 *
 * Fetched for the whole workflow rather than per task, on purpose: the task
 * panel filters this to its own task, and the workflow's timeline (to come)
 * shows all of it. One query, two views of the result, and the panel opening
 * costs no round trip. Ordered here, not in the component: a feed is read from
 * the top, and the tie-break on id keeps two posts in the same instant stable.
 */
export async function getWorkflowPosts(workflowId: string): Promise<WorkflowPost[]> {
  const supabase = await createSupabaseServerClient({ writable: false })
  const { data, error } = await supabase
    .from('workflow_posts_summary')
    .select('id, workflow_id, task_id, author_staff_id, author_name, body, body_text, created_at, mentioned, reactions, media, entities')
    .eq('workflow_id', workflowId)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })

  /*
   * A FAILED READ MUST NEVER LOOK LIKE AN EMPTY FEED.
   *
   * This function used to discard `error` and return `data ?? []`, so a query
   * PostgREST rejected came back as zero posts and the panel said "Nothing
   * posted yet." That is the worst possible lie for this screen: an adviser
   * reading a blank timeline concludes nothing was ever discussed about a
   * client, when in truth the question was never answered.
   *
   * It cost real time on 8 September. The app began selecting `media` before
   * the migration adding that column had been applied; every post on every
   * workflow disappeared from the screen while sitting safely in the table,
   * and nothing anywhere said why.
   *
   * So this throws. A workflow page that fails loudly is worth more than one
   * that quietly under-reports what people said, and an unknown column is a
   * deployment mistake to be seen rather than absorbed.
   */
  if (error) {
    throw new Error(`The workflow's posts could not be read: ${error.message}`)
  }
  return (data ?? []) as WorkflowPost[]
}
