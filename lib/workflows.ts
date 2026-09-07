import { createSupabaseServerClient } from '@/lib/supabase/server'
import type { BoardCard } from '@/lib/workflow-board'

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
      'id, name, workflow_type, status, group_id, group_name, owner_name, started_at, completed_at, updated_at',
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
