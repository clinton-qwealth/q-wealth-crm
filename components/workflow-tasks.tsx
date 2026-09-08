'use client'

import { useActionState, useEffect, useRef, useState, useTransition } from 'react'
import {
  createWorkflowTask,
  setWorkflowTaskPriority,
  setWorkflowTaskStatus,
  type NoteState,
} from '@/app/(shell)/groups/actions'
import {
  PRIORITIES,
  TASK_TYPE_LABEL,
  type Priority,
  type WorkflowTask,
} from '@/lib/workflow-board'
import { dueState, formatCalendarDate, formatNoteDate, isOverdue, type DueState } from '@/lib/note-date'
import { Pill, SHEET_SURFACE } from './ui'
import { useServerState } from './use-server-state'
import { PriorityGlyph, PriorityPicker } from './priority-picker'
import { CalendarIcon, PlusIcon } from './icons'

const INPUT =
  'w-full rounded-md border border-neutral-300 bg-white px-2.5 py-1.5 text-sm text-neutral-900 outline-none transition-colors placeholder:text-neutral-400 focus:border-brand-300 focus:ring-2 focus:ring-brand/15'
const LABEL = 'text-xs font-medium text-neutral-600'

type Staff = { id: string; name: string }

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
  tasks: initial,
  staff,
}: {
  workflowId: string
  tasks: WorkflowTask[]
  staff: Staff[]
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
                        <span
                          className={`truncate text-sm font-semibold ${
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
                          the two do not read as one paragraph. */}
                      <span className="mt-2 flex flex-wrap items-center gap-2 text-xs text-neutral-500">
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

                      {t.comment ? (
                        <span className="mt-1 line-clamp-2 text-xs italic leading-snug text-neutral-400">
                          “{t.comment}”
                        </span>
                      ) : null}
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
        className="qw-drawer w-full border-l border-neutral-200 bg-white p-0 shadow-2xl shadow-neutral-900/20 sm:w-[34rem] lg:w-[45%] lg:min-w-[34rem] lg:max-w-[46rem]"
      >
        {selected ? (
          <TaskPanel task={selected} onClose={() => panelRef.current?.close()} />
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
 * Read-only for now: what belongs in here is being decided, and inventing
 * sections ahead of that would be guessing. What it shows is the record —
 * every column the list has room only to summarise.
 */
function TaskPanel({ task, onClose }: { task: WorkflowTask; onClose: () => void }) {
  const priority = PRIORITIES.find((p) => p.id === task.priority)!
  const late = task.status === 'open' && isOverdue(task.due_at)

  return (
    <div className="flex h-full flex-col">
      <header className="flex shrink-0 items-start justify-between gap-3 px-5 pb-3 pt-5">
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
            {task.status === 'done' ? <Pill tone="success">Done</Pill> : null}
            {task.status === 'cancelled' ? <Pill tone="neutral">Cancelled</Pill> : null}
            {task.status === 'open' ? <Pill tone="neutral">Open</Pill> : null}
            <span className="inline-flex items-center gap-1 text-xs text-neutral-600">
              <PriorityGlyph priority={task.priority} className="h-3.5 w-3.5" />
              {priority.label}
            </span>
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

      <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-6">
        <dl className="grid grid-cols-2 gap-x-6 gap-y-4">
          <PanelField label="Assigned to" value={task.assigned_to_name} absent="Unassigned" />
          <PanelField
            label={late ? 'Overdue' : 'Due date'}
            value={task.due_at ? formatCalendarDate(task.due_at) : null}
            tone={late ? 'late' : undefined}
          />
          <PanelField label="Added" value={formatNoteDate(task.created_at)} />
          <PanelField
            label="Completed"
            value={task.completed_at ? formatNoteDate(task.completed_at) : null}
          />
          <PanelField label="Description" value={task.description} span wrap />
          <PanelField label="Comment" value={task.comment} span wrap />
        </dl>
      </div>
    </div>
  )
}

function PanelField({
  label,
  value,
  absent,
  span = false,
  wrap = false,
  tone,
}: {
  label: string
  value: string | null
  /** A word to show in place of an em-dash when the absence has a name. */
  absent?: string
  span?: boolean
  wrap?: boolean
  tone?: 'late'
}) {
  return (
    <div className={`min-w-0 ${span ? 'col-span-2' : ''}`}>
      <dt className={`text-xs leading-snug ${tone === 'late' ? 'font-semibold text-red-600' : 'text-neutral-500'}`}>
        {label}
      </dt>
      <dd
        className={`mt-0.5 text-sm ${wrap ? 'leading-relaxed' : 'leading-snug'} ${
          tone === 'late' ? 'font-semibold text-red-600' : 'text-neutral-900'
        }`}
      >
        {value ?? <span className="text-neutral-400">{absent ?? '—'}</span>}
      </dd>
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
