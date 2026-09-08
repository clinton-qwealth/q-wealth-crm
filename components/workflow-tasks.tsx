'use client'

import { useActionState, useEffect, useRef, useState, useTransition } from 'react'
import {
  createWorkflowTask,
  setWorkflowTaskStatus,
  type NoteState,
} from '@/app/(shell)/groups/actions'
import type { WorkflowTask } from '@/lib/workflow-board'
import { formatCalendarDate } from '@/lib/note-date'
import { InitialsTile, Pill, SHEET } from './ui'
import { useServerState } from './use-server-state'
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
                return (
                  <li key={t.id} className="flex items-start gap-3 px-3.5 py-3">
                    {/* The checkbox IS the task's status. Labelled by what it
                        does to which task, so a screen reader hears more than
                        "checkbox, not checked". */}
                    <input
                      type="checkbox"
                      checked={isDone}
                      disabled={cancelled}
                      onChange={() => toggle(t)}
                      aria-label={`${isDone ? 'Reopen' : 'Mark done'}: ${t.subject}`}
                      className="mt-0.5 h-4 w-4 shrink-0 rounded border-neutral-300 accent-emerald-600 outline-none focus-visible:ring-2 focus-visible:ring-brand/30 disabled:opacity-40"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2">
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
                      {/* Who owns it, in words rather than initials alone. The
                          tile is the site's mark for a person and gives the
                          line an anchor; the name is what makes it readable
                          without hovering. On its own line because names vary
                          in width and a right-hand column would reflow with
                          them — the lesson the detail page's field row taught. */}
                      <span className="mt-1 flex items-center gap-1.5 text-xs text-neutral-500">
                        {t.assigned_to_name ? (
                          <>
                            <span className="[&>span]:h-5 [&>span]:w-5 [&>span]:text-[9px]">
                              <InitialsTile name={t.assigned_to_name} />
                            </span>
                            Assigned to {t.assigned_to_name}
                          </>
                        ) : (
                          /* Named, not left blank: an unassigned task is the
                             one most likely to be missed, and "Unassigned" is
                             the word the board's filter and the workflow's own
                             owner picker use for the same state. */
                          <span className="text-neutral-400">Unassigned</span>
                        )}
                      </span>
                      {t.comment ? (
                        <span className="mt-1 block text-xs italic leading-snug text-neutral-400">
                          “{t.comment}”
                        </span>
                      ) : null}
                    </span>
                    {t.due_at ? (
                      <span className="shrink-0 text-xs tabular-nums text-neutral-500">
                        {formatCalendarDate(t.due_at)}
                      </span>
                    ) : null}
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
    </div>
  )
}

/**
 * The Add task dialog. The same native <dialog> as every other add modal:
 * focus held, Escape handled, background inert.
 *
 * Subject, description, due date and assignee. No comment field: a comment is
 * what the person doing the task says when they do it, not something the
 * person creating it writes. Setting one belongs with marking the task done.
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
