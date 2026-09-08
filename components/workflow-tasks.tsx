'use client'

import { useActionState, useEffect, useRef, useState, useTransition } from 'react'
import {
  createWorkflowTask,
  setWorkflowTaskStatus,
  type NoteState,
} from '@/app/(shell)/groups/actions'
import {
  PRIORITIES,
  TASK_TYPE_LABEL,
  type WorkflowTask,
} from '@/lib/workflow-board'
import { formatCalendarDate, formatNoteDate, isOverdue } from '@/lib/note-date'
import { Pill, SHEET } from './ui'
import { useServerState } from './use-server-state'
import { PriorityGlyph } from './priority-picker'
import { PlusIcon } from './icons'

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
          <div className={SHEET}>
            <ul className="divide-y divide-neutral-200/80">
              {tasks.map((t) => {
                const isDone = t.status === 'done'
                const cancelled = t.status === 'cancelled'
                // Only work still to be done can be overdue. A finished task
                // was late or it was not; either way it is not a thing to
                // chase, so it is not marked.
                const late = t.status === 'open' && isOverdue(t.due_at)
                return (
                  <li key={t.id} className="flex items-start gap-3 px-3.5 py-3">
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

                    {/* Everything else opens the panel. A button rather than a
                        click handler on the row, so it is reachable by keyboard
                        and announced as something that does something. Its
                        accessible name is the subject alone — the row's full
                        text would make a paragraph of it. */}
                    <button
                      type="button"
                      onClick={() => openTask(t.id)}
                      aria-label={`Open task: ${t.subject}`}
                      className="-my-1 flex min-w-0 flex-1 items-start gap-3 rounded-md px-1 py-1 text-left outline-none transition-colors hover:bg-neutral-50 focus-visible:ring-2 focus-visible:ring-brand/30"
                    >
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-2">
                          {/* Display only. The row is a button, so a picker here
                              would be a control inside a control — a task's
                              priority is changed in the panel. */}
                          <PriorityGlyph priority={t.priority} className="h-3.5 w-3.5" />
                          <span
                            className={`truncate text-sm font-semibold ${
                              isDone || cancelled ? 'text-neutral-400 line-through' : 'text-neutral-900'
                            }`}
                          >
                            {t.subject}
                          </span>
                          {cancelled ? <Pill tone="neutral">Cancelled</Pill> : null}
                        </span>

                        {t.description ? (
                          <span className="mt-0.5 block text-xs leading-snug text-neutral-500">
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
                          <span className="mt-1 block text-xs italic leading-snug text-neutral-400">
                            “{t.comment}”
                          </span>
                        ) : null}
                      </span>

                      {t.due_at ? (
                        /* The label carries the meaning and the colour
                           reinforces it — never the colour alone, which would
                           leave the fact invisible to a reader who cannot
                           distinguish red from grey. */
                        <span
                          className={`shrink-0 text-xs ${
                            late ? 'font-semibold text-red-600' : 'text-neutral-500'
                          }`}
                        >
                          {late ? 'Overdue' : 'Due date'}{' '}
                          <span className="tabular-nums">{formatCalendarDate(t.due_at)}</span>
                        </span>
                      ) : null}
                    </button>
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
