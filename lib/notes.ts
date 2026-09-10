import { createSupabaseServerClient } from '@/lib/supabase/server'
import type { BoardCard } from '@/lib/workflow-board'

export type WorkflowType =
  | 'onboarding'
  | 'annual_review'
  | 'advice_production'
  | 'insurance_claim'
  | 'ad_hoc'

export type WorkflowStatus =
  | 'not_started'
  | 'in_progress'
  | 'blocked'
  | 'under_review'
  | 'complete'
  | 'cancelled'

export type WorkflowOption = {
  id: string
  name: string
  workflow_type: WorkflowType
  status: WorkflowStatus
}

/**
 * A note's HEADER, plus the first 255 characters of what it says.
 *
 * **The full body is still not here, and neither is the transcript.** The rule
 * this type used to state — that the content of a client meeting should not
 * travel to the browser to render a date and an author — held while the list
 * showed only a date and an author. Since 10 September the list opens onto the
 * note's first words, so an excerpt is now something it displays; the rest of
 * the body is not, and a group with sixty meeting summaries still ships sixty
 * excerpts rather than sixty meetings.
 *
 * The excerpt is computed in the database by `note_excerpt()`, not here:
 * truncating in TypeScript would mean the whole body had crossed the wire to
 * be thrown away, which is the thing being avoided.
 */
export type NoteHeader = {
  note_id: string
  note_type: string
  title: string | null
  /** A timestamptz — an instant, not a calendar date. See formatNoteDate. */
  occurred_at: string
  author_name: string | null
  source: string
  workflow_id: string | null
  workflow_name: string | null
  workflow_status: WorkflowStatus | null
  /**
   * Up to 255 characters of the body, whitespace collapsed and cut at a word
   * boundary. Empty string for a note whose body is blank — never null, so the
   * caller has one case fewer to handle.
   */
  body_excerpt: string
  /** True when there is more body than the excerpt shows. Drives Read more. */
  body_is_truncated: boolean
}

/**
 * The group's file notes and its workflows.
 *
 * The workflows come from `workflow_board` — the same view the cross-group
 * board reads, filtered to this group — so the Workflows tab can show the same
 * card as the board, priority and owner included, and the notes picker gets
 * the same rows to file under. One source, two uses.
 *
 * One wave, two queries. They need nothing from each other, and this whole
 * function is itself one member of the page's existing top-level wave — so
 * adding notes to /groups cost no round-trip depth at all. A test measures
 * that rather than trusting it.
 *
 * The notes come from `group_notes_summary`, which resolves a note to a group
 * whether it names the group directly or names one of its members. Filtering
 * on group_id there yields one row per note, so nothing needs de-duplicating
 * here.
 */
export async function getGroupNotes(groupId: string): Promise<{
  notes: NoteHeader[]
  /** A BoardCard is a WorkflowOption with more on it, so the notes picker takes these as they are. */
  workflows: BoardCard[]
}> {
  const supabase = await createSupabaseServerClient({ writable: false })

  const [notesRes, workflowsRes] = await Promise.all([
    supabase
      .from('group_notes_summary')
      .select(
        'note_id, note_type, title, occurred_at, author_name, source, workflow_id, workflow_name, workflow_status, body_excerpt, body_is_truncated',
      )
      .eq('group_id', groupId)
      /* Newest first: a file note list is read from the top, and the thing
         somebody wants is almost always the most recent one. */
      .order('occurred_at', { ascending: false })
      /* A cap rather than paging, for now. Fifty headers is more than fits on
         the screen and keeps the payload bounded on a group with years of
         history; paging belongs with a full notes screen, not a side panel. */
      .limit(50),
    supabase
      .from('workflow_board')
      .select(
        'id, name, workflow_type, status, priority, group_id, group_name, owner_name, started_at, completed_at, updated_at',
      )
      .eq('group_id', groupId)
      /* Most recently touched first, the same order as the board. */
      .order('updated_at', { ascending: false }),
  ])

  return {
    notes: (notesRes.data ?? []) as NoteHeader[],
    workflows: (workflowsRes.data ?? []) as BoardCard[],
  }
}
