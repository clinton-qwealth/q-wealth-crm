import { createSupabaseServerClient } from '@/lib/supabase/server'
import type {
  WorkflowPost, BoardCard, WorkflowDetail, WorkflowTask } from '@/lib/workflow-board'

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
  const { data } = await supabase
    .from('workflow_posts_summary')
    .select('id, workflow_id, task_id, author_staff_id, author_name, body, body_text, created_at, mentioned, reactions')
    .eq('workflow_id', workflowId)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
  return (data ?? []) as WorkflowPost[]
}
