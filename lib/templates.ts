/**
 * Workflow templates — the vocabulary and the pure reasoning.
 *
 * NO SERVER IMPORT. This module is pulled into Client Components (the editor,
 * the deploy dialog), and importing `next/headers` transitively — which is what
 * `lib/supabase/server` does — fails the build. Same split as
 * `lib/workflow-board.ts`, and for the same reason it documents.
 *
 * Everything here is a pure function over the rows, so the rules that are easy
 * to get subtly wrong — which moves are legal, which tasks are ready, what a
 * deployment will actually produce — are testable with nothing rendered.
 */

export type TemplateStatus = 'draft' | 'published' | 'archived'

export const TEMPLATE_STATUS_LABEL: Record<TemplateStatus, string> = {
  draft: 'Draft',
  published: 'Published',
  archived: 'Archived',
}

/** Drafts first — they are the ones being worked on — then published, then the
 *  archive, which is history and sorts out of the way. */
export const TEMPLATE_STATUS_ORDER: Record<TemplateStatus, number> = {
  draft: 0,
  published: 1,
  archived: 2,
}

export type TemplateRole = { id: string; name: string; task_count: number }

export type TemplateTask = {
  id: string
  ordinal: number
  subject: string
  description: string | null
  priority: string
  role_id: string
  role_name: string
  due_offset_days: number
  /** Ids of the tasks this one waits for. Always earlier in the order. */
  depends_on: string[]
}

export type TemplateSummary = {
  id: string
  name: string
  description: string | null
  status: TemplateStatus
  workflow_type: string | null
  task_count: number
  role_count: number
  deployment_count: number
  published_at: string | null
}

export type TemplateDetail = TemplateSummary & {
  roles: TemplateRole[]
  tasks: TemplateTask[]
}

/** A published template, as the deploy dialog needs it. */
export type DeployableTemplate = {
  id: string
  name: string
  description: string | null
  workflow_type: string | null
  roles: { id: string; name: string }[]
  tasks: {
    id: string
    subject: string
    role_id: string
    due_offset_days: number
    /** Template task ids, always earlier in the list than this task. */
    depends_on: string[]
  }[]
}

/* -------------------------------------------------------------------------- */

/**
 * How many layers of waiting a task sits behind: 0 for a task that starts
 * immediately, otherwise one more than the deepest thing it waits for.
 *
 * The editor indents by this, so a fifteen-task plan shows its waves of work as
 * a staircase rather than a wall. Safe on any input the database can produce —
 * a prerequisite is always earlier in the order, so a single forward pass
 * resolves every task, and a row referring to something it cannot see (mid-edit,
 * or a malformed fixture) contributes nothing rather than looping.
 */
export function taskDepths(tasks: TemplateTask[]): Map<string, number> {
  const depth = new Map<string, number>()
  for (const task of [...tasks].sort((a, b) => a.ordinal - b.ordinal)) {
    let deepest = -1
    for (const id of task.depends_on) {
      const seen = depth.get(id)
      if (seen !== undefined && seen > deepest) deepest = seen
    }
    depth.set(task.id, deepest + 1)
  }
  return depth
}

/**
 * The positions a task may legally be moved to, as `[first, last]` inclusive.
 *
 * A task must stay below everything it waits for and above everything that
 * waits for it. Returning the bounds rather than a boolean per position is what
 * lets the editor disable a move AND say why, instead of accepting the drag and
 * quietly dropping the edge that no longer fits — which is data loss discovered
 * at deploy time.
 */
export function legalPositions(tasks: TemplateTask[], taskId: string): [number, number] {
  const ordered = [...tasks].sort((a, b) => a.ordinal - b.ordinal)
  const index = new Map(ordered.map((t, i) => [t.id, i]))
  const me = index.get(taskId)
  if (me === undefined) return [0, Math.max(0, ordered.length - 1)]

  let first = 0
  for (const id of ordered[me].depends_on) {
    const at = index.get(id)
    if (at !== undefined && at + 1 > first) first = at + 1
  }

  let last = ordered.length - 1
  for (const task of ordered) {
    if (!task.depends_on.includes(taskId)) continue
    const at = index.get(task.id)
    if (at !== undefined && at - 1 < last) last = at - 1
  }

  // A task wedged between a prerequisite and a dependent has exactly one legal
  // position, which is where it already is. Never return an empty range.
  return [first, Math.max(first, last)]
}

/** Which task blocks a move to `to`, if any — the sentence the button needs. */
export function blockingNeighbour(
  tasks: TemplateTask[],
  taskId: string,
  to: number,
): { subject: string; reason: 'waits-for' | 'waited-on' } | null {
  const ordered = [...tasks].sort((a, b) => a.ordinal - b.ordinal)
  const [first, last] = legalPositions(ordered, taskId)
  const me = ordered.findIndex((t) => t.id === taskId)
  if (me < 0 || (to >= first && to <= last)) return null

  if (to < first) {
    const blocker = ordered[first - 1]
    return blocker ? { subject: blocker.subject, reason: 'waits-for' } : null
  }
  const blocker = ordered.find((t) => t.depends_on.includes(taskId))
  return blocker ? { subject: blocker.subject, reason: 'waited-on' } : null
}

/** The whole list in a new order, for the reorder call. Out-of-range is clamped
 *  rather than refused: the caller has already disabled the illegal moves, and
 *  a silent clamp beats an exception on a keystroke. */
export function reordered(tasks: TemplateTask[], taskId: string, to: number): string[] {
  const ordered = [...tasks].sort((a, b) => a.ordinal - b.ordinal)
  const from = ordered.findIndex((t) => t.id === taskId)
  if (from < 0) return ordered.map((t) => t.id)
  const [first, last] = legalPositions(ordered, taskId)
  const target = Math.min(Math.max(to, first), last)
  const ids = ordered.map((t) => t.id)
  ids.splice(target, 0, ...ids.splice(from, 1))
  return ids
}

/**
 * Everything standing between a draft and Publish, as sentences.
 *
 * The screen disables its own button from this list, and the database refuses
 * for the same reasons. Two answers to one question, deliberately: a Publish
 * that fails on click with something the client already knew is a worse
 * experience than a button that explains itself.
 */
export function templateIssues(template: TemplateDetail): { message: string; taskId?: string }[] {
  const issues: { message: string; taskId?: string }[] = []
  if (template.tasks.length === 0) {
    issues.push({ message: 'Add at least one task.' })
  }
  for (const role of template.roles) {
    if (role.task_count === 0) {
      issues.push({ message: `No task is done by ${role.name}. Use the role, or remove it.` })
    }
  }
  for (const task of template.tasks) {
    if (task.due_offset_days < 0) {
      issues.push({ message: `“${task.subject}” has a negative offset.`, taskId: task.id })
    }
  }
  return issues
}

/* -------------------------------------------------------------------------- */

export type PreviewRow = {
  subject: string
  roleName: string
  /** The date this task will carry the moment it is deployed, or null. */
  dueOn: string | null
  /** Named when there is no date yet: what it is waiting for. */
  after: string | null
  offsetDays: number
}

/**
 * What deploying will actually produce.
 *
 * THE POINT OF THIS FUNCTION IS THE NULLS. A task that waits for something has
 * NO due date until that thing is done, so the preview must show the absence.
 * Computing a full waterfall of dates from the start date is what a reasonable
 * implementation does by reflex, it contradicts the rule the database applies,
 * and the deployer then opens the workflow, finds a column of blanks, and
 * reports it as a bug.
 *
 * `startDate` is an ISO `YYYY-MM-DD` and is added to as a calendar date, never
 * through `new Date()` — the house rule for every `date` column.
 */
export function previewSchedule(
  template: Pick<DeployableTemplate, 'tasks' | 'roles'>,
  startDate: string,
): PreviewRow[] {
  const roleName = new Map(template.roles.map((r) => [r.id, r.name]))
  const subjectOf = new Map(template.tasks.map((t) => [t.id, t.subject]))
  return template.tasks.map((task) => {
    // The one it will actually wait on longest is unknowable until the work
    // happens, so the preview names the LAST of its prerequisites in plan
    // order — the one furthest down, and the one a reader is looking for.
    const waitsFor = task.depends_on
      .map((id) => subjectOf.get(id))
      .filter((s): s is string => Boolean(s))
    return {
      subject: task.subject,
      roleName: roleName.get(task.role_id) ?? 'Unassigned',
      dueOn: waitsFor.length > 0 ? null : addDays(startDate, task.due_offset_days),
      after: waitsFor.length > 0 ? waitsFor[waitsFor.length - 1] : null,
      offsetDays: task.due_offset_days,
    }
  })
}

/**
 * A calendar date plus a whole number of days.
 *
 * Built from the parts and re-formatted from the parts. `new Date('2026-10-01')`
 * parses as midnight UTC and prints as the day before in Sydney, which is the
 * bug this whole codebase avoids by never letting a `date` column touch a Date.
 * UTC arithmetic in the middle is safe because both ends are UTC.
 */
export function addDays(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number)
  if (!y || !m || !d) return iso
  const at = new Date(Date.UTC(y, m - 1, d))
  at.setUTCDate(at.getUTCDate() + days)
  return `${at.getUTCFullYear()}-${String(at.getUTCMonth() + 1).padStart(2, '0')}-${String(
    at.getUTCDate(),
  ).padStart(2, '0')}`
}

/** Today in Sydney as `YYYY-MM-DD`, for the deploy dialog's default. The firm
 *  is in one timezone and a plan starting "today" means today here. */
export function todayInSydney(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Australia/Sydney',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now)
}
