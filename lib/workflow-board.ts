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

/**
 * Priority, Jira-shaped. Ordered low → urgent so the menu reads in one
 * direction and `PRIORITIES.indexOf` is a sort key if one is ever needed.
 */
export const PRIORITIES = [
  { id: 'low', label: 'Low' },
  { id: 'medium', label: 'Medium' },
  { id: 'high', label: 'High' },
  { id: 'urgent', label: 'Urgent' },
] as const

export type Priority = (typeof PRIORITIES)[number]['id']

export type BoardCard = {
  id: string
  name: string
  workflow_type: WorkflowType
  status: WorkflowStatus
  priority: Priority
  group_id: string
  group_name: string
  owner_name: string | null
  started_at: string | null
  completed_at: string | null
  updated_at: string
}

/**
 * Board filters. Three, and they are LAYERED: owner first, then kind, then
 * priority. Each narrows what the next one offers, so an adviser who picks
 * themselves is only ever offered the kinds of work they actually own, and so
 * on down. A filter is `null` when it is not applied.
 */
export type BoardFilters = {
  owner: string | null
  type: WorkflowType | null
  priority: Priority | null
}

export const NO_FILTERS: BoardFilters = { owner: null, type: null, priority: null }

/** Sentinel owner key for cards with nobody assigned, so they can be filtered to. */
export const UNASSIGNED = '__unassigned__'

const ownerKey = (c: BoardCard) => c.owner_name ?? UNASSIGNED

export function applyFilters(cards: BoardCard[], f: BoardFilters): BoardCard[] {
  return cards.filter(
    (c) =>
      (f.owner === null || ownerKey(c) === f.owner) &&
      (f.type === null || c.workflow_type === f.type) &&
      (f.priority === null || c.priority === f.priority),
  )
}

/**
 * What each filter may offer, given the filters ABOVE it. Owner sees every
 * card; kind sees the owner's cards; priority sees the owner's cards of that
 * kind. Options come from the cards themselves, so a kind with no card is not
 * offered — an option that yields an empty board is a dead end, not a choice.
 */
export function filterOptions(cards: BoardCard[], f: BoardFilters) {
  const afterOwner = applyFilters(cards, { ...NO_FILTERS, owner: f.owner })
  const afterType = applyFilters(afterOwner, { ...NO_FILTERS, type: f.type })
  const uniq = <T,>(xs: T[]) => [...new Set(xs)]
  return {
    owners: uniq(cards.map(ownerKey)).sort((a, b) =>
      a === UNASSIGNED ? 1 : b === UNASSIGNED ? -1 : a.localeCompare(b),
    ),
    types: uniq(afterOwner.map((c) => c.workflow_type)),
    priorities: PRIORITIES.map((p) => p.id).filter((p) => afterType.some((c) => c.priority === p)),
  }
}

/**
 * Changing an upstream filter can strand a downstream one — pick an owner who
 * has no insurance claims and the kind filter "insurance_claim" now matches
 * nothing. Rather than show an empty board with a stale filter, a downstream
 * value the new options do not offer is cleared.
 */
export function reconcileFilters(cards: BoardCard[], f: BoardFilters): BoardFilters {
  const step1 = { ...f }
  const o1 = filterOptions(cards, step1)
  if (step1.type !== null && !o1.types.includes(step1.type)) step1.type = null
  const o2 = filterOptions(cards, step1)
  if (step1.priority !== null && !o2.priorities.includes(step1.priority)) step1.priority = null
  return step1
}

/* The words for the enums, here with the rest of the vocabulary so both a
   Client Component and a Server Component can read them. They used to live in
   the (client) file-notes module, which the workflow detail page — a Server
   Component — could not use. */
export const WORKFLOW_TYPE_LABEL: Record<WorkflowType, string> = {
  onboarding: 'Onboarding',
  annual_review: 'Annual review',
  advice_production: 'Advice production',
  insurance_claim: 'Insurance claim',
  ad_hoc: 'Ad hoc',
}

export const WORKFLOW_STATUS_LABEL: Record<WorkflowStatus, string> = {
  not_started: 'Not started',
  in_progress: 'In progress',
  blocked: 'Blocked',
  under_review: 'Under review',
  complete: 'Complete',
  cancelled: 'Cancelled',
}
