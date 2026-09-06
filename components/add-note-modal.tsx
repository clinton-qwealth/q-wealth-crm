'use client'

import { useActionState, useEffect, useRef, useState } from 'react'
import { createFileNote, type NoteState } from '@/app/(shell)/groups/actions'
import type { WorkflowOption } from '@/lib/notes'
import { PlusIcon } from './icons'

const FIELD =
  'w-full rounded-md border border-neutral-300 bg-white px-2.5 py-1.5 text-sm text-neutral-900 outline-none transition-colors placeholder:text-neutral-400 focus:border-brand-300 focus:ring-2 focus:ring-brand/15'
const LABEL = 'text-xs font-medium text-neutral-600'

export const NOTE_TYPE_LABEL: Record<string, string> = {
  file_note: 'File note',
  meeting_summary: 'Meeting summary',
  phone_call: 'Phone call',
  email_record: 'Email record',
  task_note: 'Task note',
  other: 'Note',
}

/** Today, in the browser's own timezone — not `toISOString()`, which is UTC and
 *  so gives yesterday's date in Sydney for the first ten hours of every day. */
function todayLocal() {
  const now = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}

/**
 * Add-file-note dialog.
 *
 * Same native <dialog> as the account and policy modals, for the same reasons:
 * focus trapping, Escape and an inert background are all easy to get subtly
 * wrong by hand.
 *
 * The note is written against the GROUP. A note about one named member belongs
 * on that member's record, where the panel knows who is being looked at; from
 * here, the subject is the household.
 */
export function AddNoteModal({
  groupId,
  workflows,
  triggerVariant = 'primary',
}: {
  groupId: string
  workflows: WorkflowOption[]
  triggerVariant?: 'primary' | 'quiet'
}) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const formRef = useRef<HTMLFormElement>(null)
  const [open, setOpen] = useState(false)
  const [state, formAction, pending] = useActionState<NoteState, FormData>(createFileNote, null)

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

  // <dialog> closes itself on Escape without telling React.
  useEffect(() => {
    const el = dialogRef.current
    if (!el) return
    const onClose = () => setOpen(false)
    el.addEventListener('close', onClose)
    return () => el.removeEventListener('close', onClose)
  }, [])

  // Only work that is still running can take a new note. Filing one under a
  // finished review would quietly reopen a closed piece of work.
  const openWorkflows = workflows.filter(
    (w) => w.status !== 'complete' && w.status !== 'cancelled',
  )

  const trigger =
    triggerVariant === 'primary' ? (
      <button
        type="button"
        onClick={show}
        className="inline-flex items-center gap-1.5 rounded-md bg-brand px-3 py-1.5 text-sm font-medium text-white outline-none transition-colors hover:bg-brand-600 focus-visible:ring-2 focus-visible:ring-brand/40"
      >
        <PlusIcon className="h-4 w-4" />
        Add file note
      </button>
    ) : (
      <button
        type="button"
        onClick={show}
        className="inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-1 text-xs font-medium text-brand outline-none transition-colors hover:bg-brand-50 hover:text-brand-700 focus-visible:ring-2 focus-visible:ring-brand/30"
      >
        <PlusIcon className="h-3.5 w-3.5" />
        Add file note
      </button>
    )

  return (
    <>
      {trigger}

      <dialog
        ref={dialogRef}
        aria-labelledby="add-note-title"
        onClick={(e) => {
          if (e.target === dialogRef.current) hide()
        }}
        className="qw-modal m-auto w-[min(32rem,calc(100vw-2rem))] rounded-xl border border-neutral-200 bg-white p-0 shadow-2xl shadow-neutral-900/10"
      >
        <form ref={formRef} action={formAction} className="flex flex-col">
          <input type="hidden" name="group_id" value={groupId} />

          <div className="border-b border-neutral-100 px-5 py-4">
            <h2
              id="add-note-title"
              className="text-base font-semibold tracking-tight text-neutral-900"
            >
              Add file note
            </h2>
            <p className="mt-0.5 text-xs text-neutral-500">
              Notes cannot be edited or deleted once saved. A correction is a new note.
            </p>
          </div>

          <div className="flex flex-col gap-4 px-5 py-4">
            <label className="flex flex-col gap-1.5">
              <span className={LABEL}>Title</span>
              <input name="title" placeholder="Optional" className={FIELD} />
            </label>

            <div className="grid grid-cols-2 gap-3">
              <label className="flex flex-col gap-1.5">
                <span className={LABEL}>Kind</span>
                <select name="note_type" defaultValue="file_note" className={FIELD}>
                  {['file_note', 'meeting_summary', 'phone_call', 'email_record', 'task_note', 'other'].map(
                    (t) => (
                      <option key={t} value={t}>
                        {NOTE_TYPE_LABEL[t]}
                      </option>
                    ),
                  )}
                </select>
              </label>
              <label className="flex flex-col gap-1.5">
                <span className={LABEL}>Occurred</span>
                <input type="date" name="occurred_on" defaultValue={todayLocal()} className={FIELD} />
              </label>
            </div>

            <label className="flex flex-col gap-1.5">
              <span className={LABEL}>Note</span>
              <textarea name="body" rows={5} required className={`${FIELD} resize-y`} />
            </label>

            {openWorkflows.length ? (
              <label className="flex flex-col gap-1.5">
                <span className={LABEL}>Workflow</span>
                <select name="workflow_id" defaultValue="" className={FIELD}>
                  <option value="">Not part of a workflow</option>
                  {openWorkflows.map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.name}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}

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
              {pending ? 'Saving…' : 'Add file note'}
            </button>
          </div>
        </form>
      </dialog>
    </>
  )
}
