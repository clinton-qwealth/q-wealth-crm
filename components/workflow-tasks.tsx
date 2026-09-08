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
  TASK_TYPE_LABEL,
  type Priority,
  type TaskStatus,
  type EntityChoice,
  type WorkflowPost,
  type WorkflowTask,
} from '@/lib/workflow-board'
import { dueState, formatCalendarDate, formatNoteDate, type DueState } from '@/lib/note-date'
import { Pill, SHEET_SURFACE, type PillTone } from './ui'
import { EditField, Field, FieldBox, FIELD_INPUT, ReadonlyField } from './field-box'
import { Tabs } from './tabs'
import { ActivityFeed } from './activity-feed'
import { useServerState } from './use-server-state'
import { PriorityGlyph, PriorityPicker } from './priority-picker'
import { CalendarIcon, PlusIcon } from './icons'

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
type Viewer = { id: string; name: string; canRemoveAnyImage: boolean }

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
  groupName,
  tasks: initial,
  posts,
  staff,
  entities,
  viewer,
}: {
  workflowId: string
  /** The client group the workflow is for. Named in the panel — see TaskPanel. */
  groupName: string
  tasks: WorkflowTask[]
  /** Every post on the workflow; the panel shows a task's own. */
  posts: WorkflowPost[]
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
                          who has it and what kind it is, not what it is. */}
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
                        <Pill tone="neutral">{TASK_TYPE_LABEL[t.task_type]}</Pill>
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
            groupName={groupName}
            posts={posts}
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
 */
function TaskPanel({
  task,
  workflowId,
  groupName,
  posts,
  staff,
  entities,
  viewer,
  onClose,
}: {
  task: WorkflowTask
  workflowId: string
  groupName: string
  posts: WorkflowPost[]
  staff: Staff[]
  entities?: EntityChoice[]
  viewer: Viewer
  onClose: () => void
}) {
  const priority = PRIORITIES.find((p) => p.id === task.priority)!
  const finished = task.status === 'done' || task.status === 'cancelled'

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
          <p className="text-[11px] font-semibold uppercase tracking-widest text-brand">Task</p>
          <h2
            id="task-panel-title"
            className="mt-1 text-2xl font-semibold tracking-tight text-neutral-900"
          >
            {task.subject}
          </h2>
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <Pill tone="neutral">{TASK_TYPE_LABEL[task.task_type]}</Pill>
            {/* One pill driven by a map rather than three conditionals, so a
                fourth status could not arrive without a tone. */}
            <Pill tone={TASK_STATUS_TONE[task.status]}>{TASK_STATUS_LABEL[task.status]}</Pill>
            <span className="inline-flex items-center gap-1 text-xs text-neutral-600">
              <PriorityGlyph priority={task.priority} className="h-3.5 w-3.5" />
              {priority.label}
            </span>
            {/* Who the work is for, set off from the marks by a real gap: these
                are properties of the task, that is the client it belongs to.
                Every task in this panel is for the same group — but the panel
                covers 40% of the screen and hides the page behind it, so the
                one place the client's name is worth repeating is the one place
                you cannot see it. */}
            <span className="ml-2 text-xs text-neutral-500">For {groupName}</span>
          </div>
        </div>
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

                 `px-6` never comes off: it is the FLOOR for a narrow panel,
                 where the cap is wider than the space available and therefore
                 does nothing at all. Padding alone would take the same bite at
                 every size — cramping the 32rem panel to fix the 42rem one —
                 which is why both levers are here rather than one.

                 They sit on SEPARATE elements deliberately. Tailwind's box
                 model is border-box, so `max-w-xl px-6` on one element would
                 cap the whole thing at 36rem and leave 33rem of content, the
                 padding eating into the measure rather than sitting outside
                 it. The column is a scale step inside the panel's: xl in 2xl. */
              <div className="px-6 pb-6">
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
                <Unbuilt title="Changes to this task are not recorded yet">
                  The audit trail covers twenty tables and names whoever made every
                  change, but <code className="text-neutral-600">workflow_tasks</code> is
                  not one of them — it was created after the trail was set up. Attaching
                  the trigger is one line per table, and is logged as a decision rather
                  than done in passing.
                </Unbuilt>
              </div>
            ),
          },
          {
            id: 'tools',
            label: 'Tools',
            panel: (
              <div className="px-5 pb-6">
                <Unbuilt title="No tools yet">
                  Actions belonging to one task rather than to the list would sit here.
                  Nothing is built, and nothing has been decided about what belongs — so
                  this says so rather than showing a guess.
                </Unbuilt>
              </div>
            ),
          },
        ]}
      />
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
        className="inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-1 text-xs font-medium text-brand outline-none transition-colors hover:bg-brand-50 hover:text-brand-700 focus-visible:ring-2 focus-visible:ring-brand/30"
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
