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

/**
 * Every status, in the order a person would read them: the four lanes in
 * sequence, with `blocked` beside the stage it is a condition of and
 * `cancelled` last because it is where work goes to stop.
 *
 * BOARD_COLUMNS is deliberately not this list. The board can only offer the
 * four it has lanes for; the detail page has no lanes, so it is the one screen
 * that can mark work blocked or cancelled.
 */
export const WORKFLOW_STATUSES = [
  'not_started',
  'in_progress',
  'blocked',
  'under_review',
  'complete',
  'cancelled',
] as const satisfies readonly WorkflowStatus[]

export const WORKFLOW_STATUS_LABEL: Record<WorkflowStatus, string> = {
  not_started: 'Not started',
  in_progress: 'In progress',
  blocked: 'Blocked',
  under_review: 'Under review',
  complete: 'Complete',
  cancelled: 'Cancelled',
}

/**
 * A workflow as its own page needs it: the card, plus the three fields only the
 * detail page reads.
 *
 * Deliberately NOT folded into BoardCard. The board fetches every workflow the
 * caller can see and renders none of these — a description per card is payload
 * for nothing, on the one query that returns the most rows.
 */
export type WorkflowDetail = BoardCard & {
  /** The owner's staff id, for the picker. `owner_name` is the resolved name. */
  owner_staff_id: string | null
  /** An instant: when the record was made. Rendered in the reader's timezone. */
  created_at: string
  /** A calendar date, or none set. Rendered by splitting the string. */
  due_at: string | null
  description: string | null
}

/**
 * How far a workflow has come, as a percentage — DERIVED from its status, never
 * stored.
 *
 * The board's four lanes are the stages, so the status already answers this. A
 * `progress` column would be a second answer to the same question, and the two
 * would part company the first time somebody dragged a card without updating
 * it. Evenly spaced across the four lanes: 0, 33, 67, 100.
 *
 * `blocked` reports the same 33% as in_progress, because blocked work sits in
 * the In progress lane. It has come exactly as far as it has come; the amber
 * Blocked pill is what says it has stopped, and moving the bar backwards would
 * claim work was undone.
 *
 * `cancelled` reports NO percentage. Cancelled work stopped somewhere nobody
 * recorded, and printing 0% would assert that nothing had been done.
 */
export function workflowProgress(status: WorkflowStatus): {
  percent: number | null
  label: string
} {
  const label = WORKFLOW_STATUS_LABEL[status]
  if (status === 'cancelled') return { percent: null, label }
  const lane = columnFor(status)
  const index = BOARD_COLUMNS.findIndex((c) => c.id === lane)
  return { percent: Math.round((index / (BOARD_COLUMNS.length - 1)) * 100), label }
}

/**
 * A task under a workflow: one thing to be done as part of the work.
 *
 * `task_type` has one value today. A checkbox task is a boolean selection —
 * done or not done — and its status IS that selection. Other kinds are
 * expected once templates exist; the column is here so the meaning is in place
 * before the second kind arrives.
 */
export type TaskType = 'checkbox'
export type TaskStatus = 'open' | 'done' | 'cancelled'

export const TASK_TYPE_LABEL: Record<TaskType, string> = {
  checkbox: 'Checkbox',
}

export const TASK_STATUS_LABEL: Record<TaskStatus, string> = {
  open: 'Open',
  done: 'Done',
  cancelled: 'Cancelled',
}

export type WorkflowTask = {
  id: string
  workflow_id: string
  task_type: TaskType
  subject: string
  /** What the task is. */
  description: string | null
  /** What the person doing it had to say. */
  comment: string | null
  /** A calendar date, or none. Rendered by splitting the string. */
  due_at: string | null
  status: TaskStatus
  /** The same four levels as a workflow's — see the Data Model page. */
  priority: Priority
  assigned_to_staff_id: string | null
  assigned_to_name: string | null
  completed_at: string | null
  created_at: string
  updated_at: string
}

/* ------------------------------------------------------------------------ */
/* Posts: the activity feed                                                 */
/* ------------------------------------------------------------------------ */

/**
 * A post's body is a DOCUMENT, never HTML.
 *
 * The shape is ProseMirror's — the editor produces it, the database validates
 * it, the renderer walks it — and it is deliberately a small subset: the node
 * and mark types below and no others. `post_workflow_activity()` refuses
 * anything else, so every stored document is one the renderer knows how to
 * draw, and nothing that reaches the screen is ever interpreted as markup.
 * The same list, in the same order, lives in that function; if one grows the
 * other must.
 */
export const POST_NODE_TYPES = [
  'doc', 'paragraph', 'text', 'hardBreak', 'mention', 'bulletList', 'orderedList', 'listItem',
] as const
export const POST_MARK_TYPES = ['bold', 'italic', 'strike', 'code', 'link'] as const

export type PostMark = { type: (typeof POST_MARK_TYPES)[number]; attrs?: { href?: string } }
export type PostNode = {
  type: string
  text?: string
  attrs?: Record<string, unknown>
  marks?: PostMark[]
  content?: PostNode[]
}
export type PostDoc = { type: 'doc'; content?: PostNode[] }
export type PostMention = { staff_id: string; full_name: string }

export type WorkflowPost = {
  id: string
  workflow_id: string
  /** Null for a post on the workflow as a whole; the timeline shows both. */
  task_id: string | null
  author_staff_id: string
  author_name: string | null
  body: PostDoc
  /** The database's plain-text reading of the body. */
  body_text: string
  /** A timestamptz — an instant. Rendered in the reader's timezone. */
  created_at: string
  /** Who the post names, resolved to their CURRENT names by the view. */
  mentioned: PostMention[]
}

/** The cheap shape check a client can do before a round trip. The database does the real one. */
export function isPostDoc(value: unknown): value is PostDoc {
  if (typeof value !== 'object' || value === null) return false
  const v = value as { type?: unknown; content?: unknown }
  return v.type === 'doc' && (v.content === undefined || Array.isArray(v.content))
}

/**
 * The plain text of a document, for "is there anything here" and for the
 * optimistic entry before the server's own `body_text` arrives. The database's
 * `activity_doc_text()` is the authority; this agrees with it on the cases the
 * client needs and is tested against the same inputs.
 */
export function postDocText(doc: PostDoc): string {
  const out: string[] = []
  const walk = (n: PostNode) => {
    if (n.type === 'text') out.push(n.text ?? '')
    else if (n.type === 'mention') out.push('@' + String(n.attrs?.label ?? ''))
    else if (n.type === 'paragraph' || n.type === 'listItem' || n.type === 'hardBreak') out.push('\n')
    for (const c of n.content ?? []) walk(c)
  }
  for (const c of doc.content ?? []) walk(c)
  return out.join('').replace(/\n{2,}/g, '\n').trim()
}

/** Every staff id a document mentions, once each. */
export function postMentionIds(doc: PostDoc): string[] {
  const ids = new Set<string>()
  const walk = (n: PostNode) => {
    if (n.type === 'mention' && typeof n.attrs?.id === 'string') ids.add(n.attrs.id)
    for (const c of n.content ?? []) walk(c)
  }
  for (const c of doc.content ?? []) walk(c)
  return [...ids]
}
