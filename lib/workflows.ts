import { createSupabaseServerClient } from '@/lib/supabase/server'
import type { BoardCard, WorkflowDetail } from '@/lib/workflow-board'

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
