'use client'

import { useActionState, useEffect, useRef, useState, useTransition, type ReactNode } from 'react'
import {
  createWorkflowTask,
  saveWorkflowTaskDetails,
  setWorkflowTaskPriority,
  setWorkflowTaskStatus,
  type NoteState,
} from '@/app/(shell)/groups/actions'
import {
  PRIORITIES,
  TASK_STATUS_LABEL,
  type Priority,
  type TaskStatus,
  type EntityChoice,
  type TaskAction,
  type TaskActionKind,
  type WorkflowPost,
  type WorkflowTask,
} from '@/lib/workflow-board'
import { dueState, formatCalendarDate, formatNoteDate, formatNoteDateTime, type DueState } from '@/lib/note-date'
import { Pill, QUIET_ACTION, SHEET_SURFACE, type PillTone } from './ui'
import { EditField, Field, FieldBox, FIELD_INPUT, ReadonlyField } from './field-box'
import { Tabs } from './tabs'
import { ActivityFeed } from './activity-feed'
import { EmailTool } from './email-tool'
import { PostBody } from './post-body'
import { useServerState } from './use-server-state'
import { PriorityGlyph, PriorityPicker } from './priority-picker'
import {
  CalendarIcon,
  ChevronDownIcon,
  DocumentPlusIcon,
  EnvelopeIcon,
  HourglassIcon,
  PathwayIcon,
  PlusIcon,
  SignatureIcon,
  SmsIcon,
  StarIcon,
  WorkflowIcon,
} from './icons'

const INPUT =
  'w-full rounded-md border border-neutral-300 bg-white px-2.5 py-1.5 text-sm text-neutral-900 outline-none transition-colors placeholder:text-neutral-400 focus:border-brand-300 focus:ring-2 focus:ring-brand/15'
const LABEL = 'text-xs font-medium text-neutral-600'

/**
 * Green for live work, neutral for work that has stopped.
 *
 * This is the same rule the WORKFLOW's status pill follows — `in_progress` is
 * green there and `complete` is neutral — and until 8 September the task pill
 * had it backwards: a done task was green while a completed workflow was grey,
 * so the two screens disagreed about what green meant. An **open** task is the
 * live one: it is the work still to do. A done task is finished, which is not a
 * state to draw the eye to, and a cancelled one is not either.
 *
 * Done and cancelled are both neutral, and that is fine: the WORD carries the
 * difference and the colour only reinforces it, the same rule the overdue chip
 * follows. The green tick inside a task's checkbox is a different thing — that
 * is the control's own accent for "ticked", not a status mark.
 */
const TASK_STATUS_TONE: Record<TaskStatus, PillTone> = {
  open: 'success',
  done: 'neutral',
  cancelled: 'neutral',
}

type Staff = { id: string; name: string }
/** The signed-in staff member, for the optimistic entry a post makes before the server answers. */
type Viewer = { id: string; name: string; email: string; canRemoveAnyImage: boolean }

/**
 * The centre column of the workflow detail page: the work itself, as a list of
 * tasks under a header.
 *
 * The header's left is the workflow TEMPLATE's name — which does not exist yet,
 * and the placeholder says so in so many words rather than showing a guess.
 * Its right is the one action: add a task.
 *
 * Every task is a checkbox, because every task today is of the one kind there
 * is: a boolean selection, done or not done. Ticking it is optimistic and
 * reverted with the server's reason on refusal, the same contract as every
 * other control on this page.
 */
export function WorkflowTasks({
  workflowId,
  workflowName,
  groupName,
  tasks: initial,
  posts,
  actions,
  recipient,
  staff,
  entities,
  viewer,
}: {
  workflowId: string
  /** The workflow's name, and the client group it is for. Both named in the panel — see TaskPanel. */
  workflowName: string
  groupName: string
  tasks: WorkflowTask[]
  /** Every post on the workflow; the panel shows a task's own. */
  posts: WorkflowPost[]
  /** Every recorded action on the workflow; the panel's History shows a task's own. */
  actions: TaskAction[]
  /** Who an email from this workflow prefills to, or null when nobody is on file. */
  recipient: { email: string; name: string | null } | null
  staff: Staff[]
  /** What `#` may name in a post. Passed through to the feed in the task panel. */
  entities?: EntityChoice[]
  viewer: Viewer
}) {
  /* Seeded from the server and RE-seeded when the server sends new rows. A
     task added through the dialog below revalidates this page, and without
     this the list would go on showing the array it mounted with. */
  const [tasks, setTasks] = useServerState(initial)
  const [error, setError] = useState<string | null>(null)
  const [, start] = useTransition()

  /* ONE panel for the whole list, not one per row. A closed <dialog> keeps its
     contents in the document, so a dialog per task would put every task's
     detail on the page at once — the mistake the member panel made and the
     file-notes picker was built to avoid. The selected id is state; the panel
     reads the task out of the same array the rows do, so it cannot show a
     stale copy after a revalidation. */
  const panelRef = useRef<HTMLDialogElement>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const selected = tasks.find((t) => t.id === selectedId) ?? null

  function openTask(id: string) {
    setSelectedId(id)
    panelRef.current?.showModal()
  }

  useEffect(() => {
    const el = panelRef.current
    if (!el) return
    // Escape and the backdrop both close a native dialog without going through
    // our handler, so the id is cleared from the element's own close event.
    const onClose = () => setSelectedId(null)
    el.addEventListener('close', onClose)
    return () => el.removeEventListener('close', onClose)
  }, [])

  function toggle(task: WorkflowTask) {
    const next = task.status === 'done' ? 'open' : 'done'
    const before = tasks
    setError(null)
    setTasks((ts) => ts.map((t) => (t.id === task.id ? { ...t, status: next } : t)))
    start(async () => {
      const result = await setWorkflowTaskStatus(task.id, next, workflowId)
      if (result && 'error' in result) {
        setTasks(before)
        setError(result.error)
      }
    })
  }

  /* The same optimistic contract as ticking: the glyph changes at once and is
     put back with the server's reason if refused. The first caller of
     set_workflow_task_priority(), which had waited in the database with no
     caller since the column arrived. */
  function reprioritise(task: WorkflowTask, next: Priority) {
    const before = tasks
    setError(null)
    setTasks((ts) => ts.map((t) => (t.id === task.id ? { ...t, priority: next } : t)))
    start(async () => {
      const result = await setWorkflowTaskPriority(task.id, next, workflowId)
      if (result && 'error' in result) {
        setTasks(before)
        setError(result.error)
      }
    })
  }

  const done = tasks.filter((t) => t.status === 'done').length
  const live = tasks.filter((t) => t.status !== 'cancelled').length

  return (
    <div>
      <div className="mb-3 flex items-center justify-between gap-3">
        {/* A placeholder that names what it is standing in for. Templates do
            not exist yet; when they do, this is where the template's name goes. */}
        <span
          data-slot="placeholder"
          className="inline-flex items-center rounded-md border border-dashed border-neutral-300 px-2 py-1 text-sm text-neutral-400"
        >
          Workflow template name
        </span>
        <AddTaskModal workflowId={workflowId} staff={staff} />
      </div>

      {error ? (
        <p role="alert" className="mb-3 text-sm text-red-600">
          {error}
        </p>
      ) : null}

      {tasks.length ? (
        <>
          {/* SHEET_SURFACE, not SHEET: the sheet's clip would cut the last row's
              priority menu off at the sheet's edge — the board's cards learned
              the same lesson. Without the clip, the rows round their own outer
              corners so a hovered first or last row still meets the edge. */}
          <div className={SHEET_SURFACE}>
            <ul className="divide-y divide-neutral-200/80">
              {tasks.map((t) => {
                const isDone = t.status === 'done'
                const cancelled = t.status === 'cancelled'
                const finished = isDone || cancelled
                return (
                  <li
                    key={t.id}
                    className="flex items-start gap-3 px-3.5 py-3 transition-colors first:rounded-t-lg last:rounded-b-lg hover:bg-neutral-50"
                  >
                    {/* The checkbox IS the task's status, and it is a SIBLING of
                        the button below rather than inside it: a control inside
                        a control is invalid, and a tick must not also open the
                        panel. */}
                    <input
                      type="checkbox"
                      checked={isDone}
                      disabled={cancelled}
                      onChange={() => toggle(t)}
                      aria-label={`${isDone ? 'Reopen' : 'Mark done'}: ${t.subject}`}
                      className="mt-0.5 h-4 w-4 shrink-0 rounded border-neutral-300 accent-emerald-600 outline-none focus-visible:ring-2 focus-visible:ring-brand/30 disabled:opacity-40"
                    />

                    {/* The text opens the panel. A button rather than a click
                        handler on the row, so it is reachable by keyboard and
                        announced as something that does something. Its
                        accessible name is the subject alone — the row's full
                        text would make a paragraph of it. The subject leads:
                        nothing sits in front of it, so the eye lands on what
                        the task is. */}
                    <button
                      type="button"
                      onClick={() => openTask(t.id)}
                      aria-label={`Open task: ${t.subject}`}
                      className="-m-1 min-w-0 flex-1 rounded-md p-1 text-left outline-none focus-visible:ring-2 focus-visible:ring-brand/30"
                    >
                      <span className="flex items-center gap-2">
                        {/* Wraps to two lines rather than truncating. The
                            subject is the task's NAME, and a name you cannot
                            read is the one thing a list must not do — the same
                            reason the workflow's own title wraps. It began as
                            `truncate`, which was safe at the centre column's
                            old width and started cutting a long subject the
                            moment the column narrowed to 5. Clamped, not
                            unbounded, so a row stays a row. */}
                        <span
                          className={`line-clamp-2 text-sm font-semibold ${
                            finished ? 'text-neutral-400 line-through' : 'text-neutral-900'
                          }`}
                        >
                          {t.subject}
                        </span>
                        {cancelled ? <Pill tone="neutral">Cancelled</Pill> : null}
                      </span>

                      {t.description ? (
                        /* Two lines at most. A row is scanned, not read; the
                           panel has the whole text. Clamping also keeps a long
                           description from stretching the row into a paragraph
                           at this column's width. */
                        <span className="mt-0.5 line-clamp-2 text-xs leading-snug text-neutral-500">
                          {t.description}
                        </span>
                      ) : null}

                      {/* The footer, set off from the description above it so
                          the two do not read as one paragraph. 12px, up from 8:
                          at 8 the two still read as one block, and the footer
                          is a different kind of thing from the description —
                          who has it, not what it is.

                          No task-type pill. There is one type, so a pill that
                          said "Checkbox" on every row said nothing that told
                          one row from another. The enum stays in the data for
                          the second kind to arrive; the display waits for it. */}
                      <span className="mt-3 flex flex-wrap items-center gap-2 text-xs text-neutral-500">
                        {t.assigned_to_name ? (
                          <span>Assigned to {t.assigned_to_name}</span>
                        ) : (
                          /* Named, not left blank: an unassigned task is the
                             one most likely to be missed, and "Unassigned" is
                             the word the board's filter and the workflow's own
                             owner picker use for the same state. */
                          <span className="text-neutral-400">Unassigned</span>
                        )}
                      </span>

                    </button>

                    {/* The row's right edge: when it is due, and how much it
                        matters. Both are OUTSIDE the button — the picker is a
                        control, and a control inside a control is invalid —
                        and both sit on the subject's line, which is why the
                        cluster is nudged up 2px to centre a 24px button on a
                        20px line. */}
                    <span className="-my-0.5 flex shrink-0 items-center gap-1.5">
                      {t.due_at ? (
                        /* A finished task is not late and is not due today; it
                           is finished. Its date is kept, in the quiet tone. */
                        <DueChip dueAt={t.due_at} state={finished ? null : dueState(t.due_at)} />
                      ) : null}
                      <PriorityPicker
                        value={t.priority}
                        name={t.subject}
                        onChange={(p) => reprioritise(t, p)}
                        menuAlign="end"
                      />
                    </span>
                  </li>
                )
              })}
            </ul>
          </div>
          <p className="mt-2 text-xs text-neutral-400">
            {done} of {live} done
            {tasks.length !== live ? ` · ${tasks.length - live} cancelled` : ''}
          </p>
        </>
      ) : (
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-neutral-200 bg-neutral-50/60 px-6 py-10 text-center">
          <span className="flex h-9 w-9 items-center justify-center rounded-full bg-white text-neutral-400 ring-1 ring-neutral-200">
            <PlusIcon className="h-4 w-4" />
          </span>
          <p className="mt-3 text-sm font-medium text-neutral-700">No tasks yet</p>
          <p className="mt-1 max-w-xs text-xs leading-relaxed text-neutral-500">
            Tasks will be generated from the workflow template. Until then, add them here.
          </p>
        </div>
      )}

      {/* The panel. The same drawer as the member record panel — a native
          dialog, so the background really is inert and focus really is held —
          and the same width, because it holds the same kind of thing: one
          record, read at length. */}
      <dialog
        ref={panelRef}
        aria-labelledby="task-panel-title"
        onClick={(e) => {
          // A backdrop click lands on the dialog itself; a click inside the
          // panel lands on the panel.
          if (e.target === panelRef.current) panelRef.current?.close()
        }}
        className="qw-drawer w-full border-l border-neutral-200 bg-white p-0 shadow-2xl shadow-neutral-900/20 sm:w-lg lg:w-[40%] lg:min-w-lg lg:max-w-2xl"
      >
        {selected ? (
          <TaskPanel
            task={selected}
            workflowId={workflowId}
            workflowName={workflowName}
            groupName={groupName}
            onToggleStatus={() => toggle(selected)}
            posts={posts}
            actions={actions}
            recipient={recipient}
            staff={staff}
            entities={entities}
            viewer={viewer}
            onClose={() => panelRef.current?.close()}
          />
        ) : null}
      </dialog>
    </div>
  )
}

/**
 * When a task is due, as a chip: a calendar glyph and the date.
 *
 * The word carries the meaning and the colour reinforces it — never the colour
 * alone, which would leave the fact invisible to a reader who cannot tell red
 * from grey. So an overdue task says **Overdue** and its date in red; a task due
 * today says **Due today** in amber, with the date a hover away; anything else
 * is the date in the quiet tone, with "Due" spoken to a screen reader but not
 * printed — on a task list, a calendar glyph and a date at the right of the
 * row already say "due" to the eye, and printing the word on every row would
 * make the one row that says Overdue harder to pick out.
 *
 * Always the full date, year included. A firm that gives advice does not
 * abbreviate a deadline.
 */
function DueChip({ dueAt, state }: { dueAt: string; state: DueState | null }) {
  const date = formatCalendarDate(dueAt)
  const glyph = <CalendarIcon className="-ml-0.5 mr-1 h-3 w-3 shrink-0" />
  if (state === 'overdue') {
    return (
      <Pill tone="danger">
        {glyph}
        Overdue <span className="ml-1 tabular-nums">{date}</span>
      </Pill>
    )
  }
  if (state === 'today') {
    return (
      <Pill tone="warning" title={`Due ${date}`}>
        {glyph}
        Due today
      </Pill>
    )
  }
  return (
    <Pill tone="neutral">
      {glyph}
      <span className="sr-only">Due </span>
      <span className="tabular-nums">{date}</span>
    </Pill>
  )
}

/**
 * One task, at length.
 *
 * The panel is the record; the row is the summary. So the row carries what a
 * list is scanned for and this carries everything else — and since 8 September
 * it carries the write paths too.
 *
 * **The fields sit in a box with a pencil, and so does the comment.** That is
 * `FieldBox`, the same shell as the workflow detail page's field box and the
 * member record panel's editable sections, and it is now the standard layout
 * for a group of fields anywhere on the site. Each box submits only its own
 * fields, which is exactly what makes one patch function safe for both: key
 * presence decides, so the Details box cannot clear the comment and the
 * Completion box cannot clear the description.
 *
 * **Tabs below the fields**, the same component and the same configuration as
 * the individual's record: `fill` so the strip stays put and the active panel
 * scrolls beneath it, because a strip that scrolls out of reach inside a panel
 * is a dead end.
 *
 * Two things are deliberately NOT editable here. The **subject** is the panel's
 * heading rather than a field — renaming a task is a different act from
 * correcting its details, and the database function refuses it. The
 * **priority** is display-only, because the row's own picker is two inches away
 * and a second control for one value is a second thing to keep in step.
 *
 * **The status IS changeable here**, since 9 September. The panel is where a
 * task is read at length, and reading a thread is how somebody decides the
 * task is finished — but the only tick was on the row, behind an inert
 * backdrop, so finishing meant closing the record and finding it again in the
 * list. Mark done / Reopen in the header goes through the same `toggle` as the
 * row's checkbox, so the two cannot disagree about what a status change is.
 */
function TaskPanel({
  task,
  workflowId,
  workflowName,
  groupName,
  posts,
  actions,
  recipient,
  staff,
  entities,
  viewer,
  onToggleStatus,
  onClose,
}: {
  task: WorkflowTask
  workflowId: string
  workflowName: string
  groupName: string
  posts: WorkflowPost[]
  /** Every recorded action on the workflow; the History tab filters to this task. */
  actions: TaskAction[]
  /** Who an email prefills to: the group's primary contact, or null. */
  recipient: { email: string; name: string | null } | null
  staff: Staff[]
  entities?: EntityChoice[]
  viewer: Viewer
  /** The row's tick, reachable from the record. Not offered for a cancelled task. */
  onToggleStatus: () => void
  onClose: () => void
}) {
  const priority = PRIORITIES.find((p) => p.id === task.priority)!
  const finished = task.status === 'done' || task.status === 'cancelled'
  /* The Email tool exists only while it is open, so the dialog mounts fresh
     each time and comes up with the task's own subject rather than whatever
     was typed and abandoned last time. */
  const [emailOpen, setEmailOpen] = useState(false)

  /* Named on both boxes, and rendered only while editing — a box being read
     carries nothing a submit could send. The workflow's id rides along so the
     action knows which page to revalidate; it never reaches the patch. */
  const identity = (
    <>
      <input type="hidden" name="task_id" value={task.id} />
      <input type="hidden" name="workflow_id" value={workflowId} />
    </>
  )

  return (
    <div className="flex h-full flex-col">
      <header className="flex shrink-0 items-start justify-between gap-3 px-5 pb-4 pt-5">
        <div className="min-w-0">
          {/* The eyebrow says WHERE the task is, not what it is. It read "Task"
              until 9 September — a word the drawer's shape already said — while
              the client sat at the end of the marks row in the quietest type on
              it, and the workflow's name was nowhere. The panel covers 40% of
              the screen and hides the page behind it, so the one place both
              names are worth repeating is the one place you cannot see them. */}
          <p
            className="truncate text-[11px] font-semibold uppercase tracking-widest text-brand"
            title={`${groupName} · ${workflowName}`}
          >
            {groupName} · {workflowName}
          </p>
          <h2
            id="task-panel-title"
            className="mt-1 text-2xl font-semibold tracking-tight text-neutral-900"
          >
            {task.subject}
          </h2>
          {/* Two pills, one idiom. The row held four facts in three treatments
              — two pills, a bare glyph and a grey sentence — and the one task
              type, "Checkbox", was a pill that said the same thing on every
              task. Status and priority are the two states a task has; drawn
              the same way, they read as a pair. */}
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            {/* One pill driven by a map rather than three conditionals, so a
                fourth status could not arrive without a tone. */}
            <Pill tone={TASK_STATUS_TONE[task.status]}>{TASK_STATUS_LABEL[task.status]}</Pill>
            <Pill tone="neutral">
              <PriorityGlyph priority={task.priority} className="-ml-0.5 mr-1 h-3 w-3" />
              {priority.label}
            </Pill>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {/* The row's tick, from inside the record — see the component note.
              Not for a cancelled task: the row's checkbox is disabled for one
              too, and reviving cancelled work is not a click's decision. */}
          {task.status !== 'cancelled' ? (
            <button
              type="button"
              onClick={onToggleStatus}
              className="rounded-md border border-neutral-300 bg-white px-2.5 py-1 text-xs font-medium text-neutral-800 outline-none transition-colors hover:bg-neutral-50 focus-visible:ring-2 focus-visible:ring-brand/30"
            >
              {task.status === 'done' ? 'Reopen' : 'Mark done'}
            </button>
          ) : null}
          <button
            type="button"
            onClick={onClose}
            aria-label="Close panel"
            className="-mr-1 shrink-0 rounded-md p-1.5 text-neutral-400 outline-none transition-colors hover:bg-neutral-100 hover:text-neutral-700 focus-visible:ring-2 focus-visible:ring-brand/30"
          >
            <svg viewBox="0 0 16 16" className="h-4 w-4" aria-hidden="true">
              <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" fill="none" />
            </svg>
          </button>
        </div>
      </header>

      {/* The fields, above the tabs — the tab strip sits below the last of them,
          the description. Capped and scrollable rather than simply shrink-0: a
          description of a few sentences is the ordinary case and fits, but a very
          long one must not push the tabs off the bottom of the panel.

          55vh, not 40: the box is at its tallest while EDITING — four stacked
          rows including a four-line textarea, measured at 368px, 384 with the
          gutter — and at 40vh of a 950px window that is 380, so it clipped its
          own bottom border just above the tab strip. Measured again at 55vh:
          the region takes the 384 it needs, does not scroll, and the box's
          bottom edge is visible. */}
      <div className="max-h-[55vh] shrink-0 overflow-y-auto px-5 pb-4">
        <FieldBox
          title="Details"
          action={saveWorkflowTaskDetails}
          identity={identity}
          view={
            /* Three across the top row, then the description across all of it.
               Three-across is the layout that FAILED on the workflow's own
               field box, where the column is 248px and a cell is 72px — too
               narrow for a real name. Here the box is 607px and a cell is
               about 180px, which fits "Clinton Hatcher" (100px) and an overdue
               chip with room to spare. The same layout, opposite verdict,
               because the width is different — which is why it was measured
               rather than assumed either time. */
            <dl className="grid grid-cols-3 gap-x-4 gap-y-4">
              {/* "Unassigned" rather than an em-dash, the word the board's
                  filter and this box's own picker use for the same state. No
                  initials tile: the task row dropped its own on 8 September
                  because the name already says who, and the panel should not
                  reintroduce the mark the list just lost. */}
              <Field
                label="Assigned to"
                value={task.assigned_to_name ?? 'Unassigned'}
                muted={!task.assigned_to_name}
              />
              <Field label="Added" value={formatNoteDate(task.created_at)} />
              {/* Rightmost, and the same chip as the row — so the fact the
                  reader clicked on is the fact they land on. A finished task
                  shows its date in the quiet tone: it is not late, it is
                  finished. */}
              <Field
                label="Due date"
                value={
                  task.due_at ? (
                    <DueChip dueAt={task.due_at} state={finished ? null : dueState(task.due_at)} />
                  ) : null
                }
              />
              <Field label="Description" value={task.description} wrap span />
              {/* Only once it has happened: for an open task "Completed —"
                  says nothing the Open pill above has not, and the Activity
                  tab it used to live in is now the feed. */}
              {task.completed_at ? (
                <Field label="Completed" value={formatNoteDate(task.completed_at)} span />
              ) : null}
            </dl>
          }
          edit={
            <div className="flex flex-col gap-3">
              <EditField label="Assigned to">
                <select
                  name="assigned_to_staff_id"
                  defaultValue={task.assigned_to_staff_id ?? ''}
                  className={FIELD_INPUT}
                >
                  <option value="">Unassigned</option>
                  {staff.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                  {/* An assignee the directory no longer lists — someone who has
                      left — stays selectable rather than being silently
                      reassigned to nobody by the next save. The same guard the
                      workflow's owner picker and the member panel's dropdowns
                      needed. */}
                  {task.assigned_to_staff_id &&
                  !staff.some((s) => s.id === task.assigned_to_staff_id) ? (
                    <option value={task.assigned_to_staff_id}>
                      {task.assigned_to_name ?? 'Current assignee'}
                    </option>
                  ) : null}
                </select>
              </EditField>

              <EditField label="Due date">
                {/* type="date" hands back YYYY-MM-DD, which is what a `date`
                    column takes. Empty clears it. */}
                <input
                  type="date"
                  name="due_at"
                  defaultValue={task.due_at ?? ''}
                  className={FIELD_INPUT}
                />
              </EditField>

              <ReadonlyField label="Added" value={formatNoteDate(task.created_at)} />

              <EditField label="Description">
                <textarea
                  name="description"
                  rows={4}
                  defaultValue={task.description ?? ''}
                  placeholder="What this task is."
                  className={FIELD_INPUT}
                />
              </EditField>

              {task.completed_at ? (
                <ReadonlyField label="Completed" value={formatNoteDate(task.completed_at)} />
              ) : null}
            </div>
          }
        />
      </div>

      <Tabs
        fill
        gutter={5}
        flushTop={false}
        bleed={false}
        alignFirst
        label={`${task.subject} task`}
        items={[
          {
            id: 'activity',
            label: 'Activity',
            panel: (
              /* A READING COLUMN, not a full-width pane.

                 The composer and the posts are prose that people write and
                 read, so the column is capped rather than left to fill a panel
                 that runs to 42rem. `max-w-xl` sets it at 36rem and `mx-auto`
                 centres it, so the slack on a wide panel becomes even margins
                 instead of an over-long line.

                 `px-5` never comes off: it is the FLOOR for a narrow panel,
                 where the cap is wider than the space available and therefore
                 does nothing at all. Padding alone would take the same bite at
                 every size — cramping the 32rem panel to fix the 42rem one —
                 which is why both levers are here rather than one.

                 px-5, the panel's own gutter, not px-6. At 6 the composer's
                 left border sat 4px inside the Details box's directly above it
                 — and 4px is not an inset, it is a near-miss, which reads as a
                 mistake. Now the header text, the box border, the first tab
                 label, the composer border and the other two tabs' content all
                 share one left edge at 20px.

                 They sit on SEPARATE elements deliberately. Tailwind's box
                 model is border-box, so `max-w-xl px-5` on one element would
                 cap the whole thing at 36rem and leave the padding eating into
                 the measure rather than sitting outside it. The column is a
                 scale step inside the panel's: xl in 2xl. */
              <div className="px-5 pb-6">
                <div className="mx-auto w-full max-w-xl">
                  {/* The feed replaced the comment field on 8 September. A post
                      is what a comment was trying to be — who said what, when —
                      with the two things a single column could never hold: more
                      than one of them, and a relationship to the workflow's
                      timeline as well as to this task. */}
                  <ActivityFeed
                    workflowId={workflowId}
                    taskId={task.id}
                    posts={posts}
                    staff={staff}
                    entities={entities}
                    viewer={viewer}
                  />
                </div>
              </div>
            ),
          },
          {
            id: 'history',
            label: 'History',
            panel: (
              <div className="px-5 pb-6">
                <TaskHistory
                  actions={actions.filter((a) => a.task_id === task.id)}
                  viewerId={viewer.id}
                />
              </div>
            ),
          },
          {
            id: 'tools',
            label: 'Tools',
            panel: (
              <div className="px-5 pb-6">
                <TaskTools onEmail={() => setEmailOpen(true)} />
              </div>
            ),
          },
        ]}
      />

      {emailOpen ? (
        <EmailTool
          workflowId={workflowId}
          taskId={task.id}
          taskSubject={task.subject}
          recipient={recipient}
          sender={viewer.email}
          senderName={viewer.name}
          onClose={() => setEmailOpen(false)}
        />
      ) : null}
    </div>
  )
}

/**
 * The Tools tab: what a person can DO from this task, in two sections.
 *
 * **Every tile is inactive**, and that is the point of building it now — the
 * set can be argued about before any of it is wired, which is cheaper than
 * arguing after. Each becomes live as its action is built.
 *
 * **A tile is a square with a glyph, and a label beneath it.** The whole cell
 * is the button rather than just the square: one click target, one accessible
 * name, and a disabled state that covers the label too. A glyph-only square
 * would have been closer to the request, but "How long will my money last" is
 * not a thing anyone recognises from an hourglass — and a tooltip is not a
 * label, because it needs a pointer to find.
 *
 * **Dashed, not dimmed.** The house already uses a dashed border for a
 * placeholder that names what it stands in for: the workflow-template chip
 * above the task list, the blank region beside a group's workflow cards, the
 * `Unbuilt` box below. Dimming seven tiles to 40% would read as broken;
 * dashed reads as planned. When one is wired it takes a solid border, so
 * going live is visible rather than silent.
 */
type Tool = {
  id: string
  name: string
  /** What the app does, for a name that does not say. Shown under the name. */
  detail?: string
  Glyph: (props: { className?: string }) => ReactNode
  /** Absent means the tile is inactive — nothing is wired to it yet. */
  onOpen?: () => void
}

/* Things done TO the client or the file — a verb each. Email and SMS reuse the
   file-note glyphs, because an email is an email wherever it is met. */
const TASK_ACTIONS: Tool[] = [
  { id: 'email', name: 'Email', Glyph: EnvelopeIcon },
  { id: 'sms', name: 'SMS', Glyph: SmsIcon },
  { id: 'docusign', name: 'DocuSign', detail: 'Send to sign', Glyph: SignatureIcon },
  { id: 'generate-document', name: 'Generate document', Glyph: DocumentPlusIcon },
  { id: 'launch-workflow', name: 'Launch workflow', Glyph: WorkflowIcon },
]

/* Separate tools opened from a task, not actions taken on it — which is why
   they are their own section rather than four more Actions. Each carries what
   it models, because the names do not say on their own. */
const TASK_APPS: Tool[] = [
  { id: 'pathway-to-wealth', name: 'Pathway to Wealth', detail: 'Wealth modelling', Glyph: PathwayIcon },
  { id: 'money-last', name: 'How long will my money last', detail: 'Projection modelling', Glyph: HourglassIcon },
  { id: 'star-calculator', name: 'STAR Calculator', detail: 'Investment modelling', Glyph: StarIcon },
]

function TaskTools({ onEmail }: { onEmail: () => void }) {
  /* Email is live; the other seven are not. The set is written once above and
     the one wired action is attached here, so a tile becomes active by gaining
     a handler rather than by being moved into a different list. */
  const actions = TASK_ACTIONS.map((t) => (t.id === 'email' ? { ...t, onOpen: onEmail } : t))
  const live = actions.filter((t) => t.onOpen).length

  return (
    <div className="flex flex-col gap-6">
      <p className="text-xs leading-relaxed text-neutral-500">
        What can be done from this task.{' '}
        <span className="font-medium text-neutral-700">
          {live === 1 ? 'One tile is live; the rest are inactive' : `${live} tiles are live`}
        </span>{' '}
        — the inactive ones are here so the set can be judged before anything is wired, and each
        becomes live as its action is built.
      </p>
      <ToolSection title="Actions" tools={actions} />
      <ToolSection title="Apps" tools={TASK_APPS} />
    </div>
  )
}

/**
 * `h3`, and the same small-caps treatment as a `FieldBox` title — the panel's
 * own heading is the `h2`, so these sit one level under it and read as the
 * same kind of divider the Details box uses.
 */
function ToolSection({ title, tools }: { title: string; tools: Tool[] }) {
  return (
    <section>
      <h3 className="text-xs font-semibold uppercase tracking-wider text-neutral-500">{title}</h3>
      {/* CELLS PACKED FROM THE LEFT; CONTENT CENTRED INSIDE EACH ONE. Two
          different alignments, and they are doing different jobs.

          A grid divided the whole column into equal shares, which at 565px
          made each 132px and left the tiles evenly spaced but aligned to
          nothing. Fixed-width items that wrap pack against the left instead
          and leave the slack at the right, where it reads as room rather than
          as gaps — and wrapping does the responsive work, so no breakpoint is
          needed: five fit the 565px column, four fit a narrow panel, three fit
          a phone.

          96px an item, not 112: it is what lets all five Actions sit on one
          row (5 x 96 + 4 x 12 of gap = 528 of 565), and it keeps the label
          close enough under its own glyph to read as belonging to it. The cost
          is that a 64px tile centred in 96px sits 16px in from the panel's
          gutter rather than flush against it — accepted, because a label
          centred under its icon is what was asked for and a left-aligned label
          under a centred one looks like a mistake. */}
      <ul className="mt-3 flex flex-wrap gap-x-3 gap-y-5">
        {tools.map((tool) => (
          <li key={tool.id} className="w-24">
            <ToolTile tool={tool} />
          </li>
        ))}
      </ul>
    </section>
  )
}

function ToolTile({ tool }: { tool: Tool }) {
  const { name, detail, Glyph, onOpen } = tool
  const live = Boolean(onOpen)
  return (
    <button
      type="button"
      /* A real `disabled` on an unwired tile, not `aria-disabled`: it leaves
         the tab order, so a keyboard user is not walked through controls that
         do nothing. */
      disabled={!live}
      /* The reason belongs in the name, because "dimmed" on its own does not
         say whether this is broken, forbidden, or simply not built yet. */
      aria-label={live ? name : `${name}${detail ? ` — ${detail}` : ''} — not built yet`}
      title={live ? name : 'Not built yet'}
      onClick={onOpen}
      className={`flex w-full flex-col items-center gap-2 text-center ${
        live ? 'group cursor-pointer' : 'cursor-not-allowed'
      }`}
    >
      {/* SOLID for a live tile, dashed for one that is not. Dashed is this
          app's placeholder mark — the template-name chip, the blank beside a
          group's workflow cards — so a tile going live is visible rather than
          silent, which is the whole reason the inactive ones were drawn that
          way in the first place. */}
      <span
        className={`flex h-16 w-16 items-center justify-center rounded-xl border transition-colors ${
          live
            ? 'border-neutral-300 bg-white text-neutral-600 group-hover:border-brand-300 group-hover:bg-brand-50 group-hover:text-brand-700'
            : 'border-dashed border-neutral-300 bg-neutral-50/60 text-neutral-400'
        }`}
      >
        <Glyph className="h-6 w-6" />
      </span>
      <span className="flex flex-col gap-0.5">
        {/* Clamped, not truncated: the longest of these is a sentence, and a
            name you cannot read is the one thing a launcher must not do. */}
        <span
          className={`line-clamp-2 text-xs font-medium leading-snug ${
            live ? 'text-neutral-800' : 'text-neutral-600'
          }`}
        >
          {name}
        </span>
        {detail ? (
          <span className="line-clamp-2 text-[11px] leading-snug text-neutral-400">{detail}</span>
        ) : null}
      </span>
    </button>
  )
}

/**
 * The History tab: what has happened to this task.
 *
 * It said "changes to this task are not recorded yet" from the day it was
 * built, because `workflow_tasks` carries no audit trigger. It now has a real
 * source for HALF the answer — the actions taken from the Tools tab — and the
 * empty state says plainly which half is still missing, rather than implying
 * nothing is recorded at all.
 *
 * Newest first, like the feed: history is scanned from the top. Every entry
 * opens CLOSED, so the tab is a list of what happened rather than a stack of
 * messages — see ActionEntry.
 */
function TaskHistory({ actions, viewerId }: { actions: TaskAction[]; viewerId: string }) {
  return (
    <div className="flex flex-col gap-4">
      {actions.length ? (
        <ol aria-label="Recorded actions" className="flex flex-col divide-y divide-neutral-200/80">
          {actions.map((action) => (
            <li key={action.id} className="py-2.5 first:pt-0">
              <ActionEntry action={action} viewerId={viewerId} />
            </li>
          ))}
        </ol>
      ) : (
        <p className="text-xs leading-relaxed text-neutral-400">
          Nothing recorded yet. An action taken from the Tools tab appears here.
        </p>
      )}

      {/* The other half, still missing, and named rather than implied. */}
      <Unbuilt title="Field changes are not recorded yet">
        The audit trail covers twenty tables and names whoever made every change, but{' '}
        <code className="text-neutral-600">workflow_tasks</code> is not one of them — it was
        created after the trail was set up. So an assignee, a due date or a status changing
        leaves no trace here yet. Attaching the trigger is one line per table, and is logged as
        a decision rather than done in passing.
      </Unbuilt>
    </div>
  )
}

const ACTION_LABEL: Record<TaskActionKind, string> = { email: 'Email' }

/**
 * What each kind of action READS as under the subject.
 *
 * A phrase per kind rather than one hardcoded sentence, because the second kind
 * is SMS and "sent an email" would then be wrong on every text message. The
 * preposition is separate so an action with no recipient still forms a
 * sentence rather than trailing off with a dangling "to".
 *
 * **These say "sent", and nothing is sent.** That wording was asked for on
 * 9 September and it is a deliberate departure from the rule the rest of this
 * feature was built on — the record is kept out of the client's file precisely
 * so the file cannot claim a client was contacted when they were not. This line
 * is internal to the task, not part of the client's record, which is the reason
 * the departure is confined to here. If the wording matters again, this map and
 * the test that pins it are the two places to change.
 */
const ACTION_SENTENCE: Record<TaskActionKind, { verb: string; preposition: string }> = {
  email: { verb: 'sent an email', preposition: 'to' },
}

/**
 * A glyph per kind, so the pill is recognisable before it is read.
 *
 * The SAME glyph the Tools tab launches the action with — an Email in the
 * history and the Email tile that produced it must not be two different marks,
 * or the history stops reading as a record of what was done here.
 */
const ACTION_GLYPH: Record<TaskActionKind, (props: { className?: string }) => ReactNode> = {
  email: EnvelopeIcon,
}

/**
 * One recorded action, CLOSED by default.
 *
 * **The shape is the summary, and the summary is four facts**: what kind of
 * thing it was, what it was about, when, and who did it to whom. Kind as a pill
 * with its glyph, subject under it, the moment on the right — so a column of
 * entries lines up on all three and can be scanned down rather than read — and
 * then the sentence.
 *
 * **"You", but only when it was you.** The actor is compared with the signed-in
 * staff member, because an action recorded by a colleague read back as "You
 * sent an email" would be plainly false to whoever is looking at it. Everyone
 * else is named, and someone who has since left is described rather than named,
 * as the feed does.
 *
 * **The sentence says "sent" although nothing is.** See ACTION_SENTENCE for
 * what that costs and why it is confined to this line.
 *
 * **The addresses and the message are behind a gate.** An email body is a
 * paragraph or more, and left open it means one entry fills the panel and the
 * history stops being a history. Closed, ten entries fit; the gate is the whole
 * summary row, so the target is the entry rather than a chevron. The detail is
 * not rendered at all while closed, which is why `aria-controls` is only set
 * when there is something for it to point at.
 */
function ActionEntry({ action, viewerId }: { action: TaskAction; viewerId: string }) {
  const [open, setOpen] = useState(false)
  const detailId = `task-action-${action.id}-detail`
  const Glyph = ACTION_GLYPH[action.kind]
  const sentence = ACTION_SENTENCE[action.kind]
  const who =
    action.actor_staff_id === viewerId
      ? 'You'
      : (action.actor_name ?? 'Someone no longer on staff')

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((was) => !was)}
        aria-expanded={open}
        aria-controls={open ? detailId : undefined}
        className="group flex w-full items-start gap-2 rounded-md text-left outline-none focus-visible:ring-2 focus-visible:ring-brand/30"
      >
        <ChevronDownIcon
          className={`mt-1 h-4 w-4 shrink-0 text-neutral-400 transition-transform group-hover:text-neutral-600 ${
            open ? '' : '-rotate-90'
          }`}
        />
        <span className="min-w-0 flex-1">
          {/* Kind on the left, moment on the right, on one row. */}
          <span className="flex items-center justify-between gap-2">
            <Pill tone="neutral">
              {Glyph ? <Glyph className="-ml-0.5 mr-1 h-3 w-3" /> : null}
              {ACTION_LABEL[action.kind] ?? action.kind}
            </Pill>
            <span className="shrink-0 text-[11px] text-neutral-400">
              {formatNoteDateTime(action.occurred_at)}
            </span>
          </span>

          {/* Truncated, not clamped: a subject line is a title, and a column of
              entries only lines up if each takes exactly one row. The whole
              subject is in the detail below once the entry is open. */}
          <span
            className={`mt-1 block truncate text-sm font-medium ${
              action.subject ? 'text-neutral-900' : 'font-normal text-neutral-400'
            }`}
          >
            {action.subject || 'No subject'}
          </span>

          {/* Truncated for the same reason as the subject: one row per entry,
              or a column of them stops lining up. A recipient list can be
              several addresses long. */}
          <span className="mt-0.5 block truncate text-xs text-neutral-500">
            {who} {sentence ? sentence.verb : `recorded a ${action.kind}`}
            {action.recipient && sentence ? (
              <>
                {' '}
                {sentence.preposition}{' '}
                <span className="text-neutral-700">{action.recipient}</span>
              </>
            ) : null}
          </span>
        </span>
      </button>

      {open ? (
        <div id={detailId} className="mt-2 flex flex-col gap-1 pl-6">
          {action.subject ? (
            <p className="text-xs text-neutral-500">
              Subject <span className="text-neutral-700">{action.subject}</span>
            </p>
          ) : null}

          {/* Only the SENDER. The recipient moved into the summary sentence on
              9 September, and repeating it two lines below was noise. */}
          {action.sender ? (
            <p className="text-xs text-neutral-500">
              From <span className="text-neutral-700">{action.sender}</span>
            </p>
          ) : null}

          {/* The message as it was written. The same renderer the feed uses,
              which draws only what it knows — and an email body is a narrower
              list than a post, so there is nothing here it has not already
              been taught. */}
          {action.body ? (
            <div className="mt-1 rounded-md border border-neutral-200 bg-neutral-50/60 px-3 py-2">
              <PostBody doc={action.body} mentioned={[]} />
            </div>
          ) : (
            <p className="text-xs text-neutral-400">No message was recorded.</p>
          )}
        </div>
      ) : null}
    </div>
  )
}

/**
 * A tab panel that is honest about being empty.
 *
 * Dashed, muted, and it names what is missing and why — the same treatment the
 * member panel's Activity tab uses for the record changes it cannot yet show,
 * and the same principle as the template-name chip above the task list. A
 * half-built screen that says what belongs in it reads as a plan; one that
 * shows nothing reads as broken.
 */
function Unbuilt({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed border-neutral-200 bg-neutral-50/60 px-4 py-6">
      <p className="text-sm font-medium text-neutral-700">{title}</p>
      <p className="mt-1 text-xs leading-relaxed text-neutral-500">{children}</p>
    </div>
  )
}

/**
 * The Add task dialog. The same native <dialog> as every other add modal:
 * focus held, Escape handled, background inert.
 *
 * Subject, description, due date, priority and assignee. No comment field: a
 * comment is what the person doing the task says when they do it, not something
 * the person creating it writes. Setting one belongs with marking the task done.
 */
export function AddTaskModal({ workflowId, staff }: { workflowId: string; staff: Staff[] }) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const formRef = useRef<HTMLFormElement>(null)
  const [open, setOpen] = useState(false)
  const [state, formAction, pending] = useActionState<NoteState, FormData>(createWorkflowTask, null)

  function show() {
    setOpen(true)
    dialogRef.current?.showModal()
  }
  function hide() {
    setOpen(false)
    dialogRef.current?.close()
  }

  useEffect(() => {
    if (state && 'ok' in state && state.ok && open) {
      formRef.current?.reset()
      hide()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state])

  useEffect(() => {
    const el = dialogRef.current
    if (!el) return
    const onClose = () => setOpen(false)
    el.addEventListener('close', onClose)
    return () => el.removeEventListener('close', onClose)
  }, [])

  return (
    <>
      <button
        type="button"
        onClick={show}
        className={QUIET_ACTION}
      >
        <PlusIcon className="h-3.5 w-3.5" />
        Add task
      </button>
      <dialog
        ref={dialogRef}
        aria-labelledby="add-task-title"
        onClick={(e) => {
          if (e.target === dialogRef.current) hide()
        }}
        className="qw-modal m-auto w-[min(28rem,calc(100vw-2rem))] rounded-xl border border-neutral-200 bg-white p-0 shadow-2xl shadow-neutral-900/10"
      >
        <form ref={formRef} action={formAction} className="flex flex-col">
          <input type="hidden" name="workflow_id" value={workflowId} />
          <div className="border-b border-neutral-100 px-5 py-4">
            <h2 id="add-task-title" className="text-base font-semibold tracking-tight text-neutral-900">
              Add task
            </h2>
            <p className="mt-0.5 text-xs text-neutral-500">
              One thing to be done as part of this workflow.
            </p>
          </div>

          <div className="flex flex-col gap-4 px-5 py-4">
            <label className="flex flex-col gap-1.5">
              <span className={LABEL}>Subject</span>
              <input name="subject" required placeholder="e.g. Collect signed authority" className={INPUT} />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className={LABEL}>Description</span>
              <textarea name="description" rows={3} className={INPUT} />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className={LABEL}>Due date</span>
              <input type="date" name="due_at" className={INPUT} />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className={LABEL}>Priority</span>
              {/* Medium by default, for the reason on the Data Model page: an
                  unprioritised task is unremarkable, not low. */}
              <select name="priority" defaultValue="medium" className={INPUT}>
                {PRIORITIES.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1.5">
              <span className={LABEL}>Assign to</span>
              <select name="assigned_to_staff_id" defaultValue="" className={INPUT}>
                <option value="">Unassigned</option>
                {staff.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>

            {state && 'error' in state ? (
              <p role="alert" className="text-sm text-red-600">
                {state.error}
              </p>
            ) : null}
          </div>

          <div className="flex justify-end gap-2 border-t border-neutral-100 bg-neutral-50/60 px-5 py-3">
            <button
              type="button"
              onClick={hide}
              className="rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-sm font-medium text-neutral-800 outline-none transition-colors hover:bg-neutral-50 focus-visible:ring-2 focus-visible:ring-brand/30"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={pending}
              className="rounded-md bg-brand px-3 py-1.5 text-sm font-medium text-white outline-none transition-colors hover:bg-brand-600 disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-brand/40"
            >
              {pending ? 'Adding…' : 'Add task'}
            </button>
          </div>
        </form>
      </dialog>
    </>
  )
}
