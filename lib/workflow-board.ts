/**
 * The board's pure vocabulary: lanes, the status→lane mapping, the card shape.
 *
 * In its own module, with NO server import, because the board component is a
 * Client Component. When these lived beside the fetchers in workflows.ts the
 * browser bundle pulled in lib/supabase/server and, through it, next/headers —
 * which Next refuses at build time. Vitest did not catch that: it does not
 * enforce the server/client boundary. A real browser did, on the first drag.
 */
import type { WorkflowStatus, WorkflowType } from '@/lib/notes'

/**
 * The four lanes of the board, in order. These ARE statuses — dropping a card
 * in a lane sets its status to the lane's id — which is why 'under_review' had
 * to be added to the enum rather than invented on the client.
 */
export const BOARD_COLUMNS = [
  { id: 'not_started', label: 'Not started' },
  { id: 'in_progress', label: 'In progress' },
  { id: 'under_review', label: 'Under review' },
  { id: 'complete', label: 'Completed' },
] as const

export type BoardColumn = (typeof BOARD_COLUMNS)[number]['id']

/**
 * Which lane a status lives in.
 *
 * `blocked` is a CONDITION of work in progress, not a stage of its own, so it
 * sits in the In progress lane and the card carries a warning mark. `cancelled`
 * is not on the board: cancelled work is not at any stage, and a lane for it
 * would turn a board of live work into an archive. The board says how many it
 * is not showing, so nothing disappears silently.
 */
export function columnFor(status: WorkflowStatus): BoardColumn | null {
  switch (status) {
    case 'blocked':
      return 'in_progress'
    case 'cancelled':
      return null
    default:
      return status
  }
}

export type BoardCard = {
  id: string
  name: string
  workflow_type: WorkflowType
  status: WorkflowStatus
  group_id: string
  group_name: string
  owner_name: string | null
  started_at: string | null
  completed_at: string | null
  updated_at: string
}
