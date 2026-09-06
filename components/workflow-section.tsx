'use client'

import { useActionState, useEffect, useRef, useState } from 'react'
import { startWorkflow, type NoteState } from '@/app/(shell)/groups/actions'
import type { WorkflowOption, WorkflowStatus, WorkflowType } from '@/lib/notes'
import { DataRow, DataSection } from './data-section'
import { Pill, type PillTone } from './ui'
import { PlusIcon } from './icons'
import { WORKFLOW_STATUS_LABEL, WORKFLOW_TYPE_LABEL } from './file-notes'

const FIELD =
  'w-full rounded-md border border-neutral-300 bg-white px-2.5 py-1.5 text-sm text-neutral-900 outline-none transition-colors placeholder:text-neutral-400 focus:border-brand-300 focus:ring-2 focus:ring-brand/15'
const LABEL = 'text-xs font-medium text-neutral-600'

/* Blocked is the one worth noticing, so it is the one that gets amber.
   In progress is the ordinary state and stays quiet — badging every row the
   same way would make none of them stand out. */
const STATUS_TONE: Record<WorkflowStatus, PillTone> = {
  not_started: 'neutral',
  in_progress: 'success',
  blocked: 'warning',
  complete: 'neutral',
  cancelled: 'neutral',
}

function StartWorkflowModal({
  groupId,
  triggerVariant = 'primary',
}: {
  groupId: string
  triggerVariant?: 'primary' | 'quiet'
}) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const formRef = useRef<HTMLFormElement>(null)
  const [open, setOpen] = useState(false)
  const [state, formAction, pending] = useActionState<NoteState, FormData>(startWorkflow, null)

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

  const trigger =
    triggerVariant === 'primary' ? (
      <button
        type="button"
        onClick={show}
        className="inline-flex items-center gap-1.5 rounded-md bg-brand px-3 py-1.5 text-sm font-medium text-white outline-none transition-colors hover:bg-brand-600 focus-visible:ring-2 focus-visible:ring-brand/40"
      >
        <PlusIcon className="h-4 w-4" />
        Start workflow
      </button>
    ) : (
      <button
        type="button"
        onClick={show}
        className="inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-1 text-xs font-medium text-brand outline-none transition-colors hover:bg-brand-50 hover:text-brand-700 focus-visible:ring-2 focus-visible:ring-brand/30"
      >
        <PlusIcon className="h-3.5 w-3.5" />
        Start workflow
      </button>
    )

  return (
    <>
      {trigger}
      <dialog
        ref={dialogRef}
        aria-labelledby="start-workflow-title"
        onClick={(e) => {
          if (e.target === dialogRef.current) hide()
        }}
        className="qw-modal m-auto w-[min(28rem,calc(100vw-2rem))] rounded-xl border border-neutral-200 bg-white p-0 shadow-2xl shadow-neutral-900/10"
      >
        <form ref={formRef} action={formAction} className="flex flex-col">
          <input type="hidden" name="group_id" value={groupId} />
          <div className="border-b border-neutral-100 px-5 py-4">
            <h2
              id="start-workflow-title"
              className="text-base font-semibold tracking-tight text-neutral-900"
            >
              Start workflow
            </h2>
            <p className="mt-0.5 text-xs text-neutral-500">
              A piece of work being done for this group. File notes can be filed under it.
            </p>
          </div>

          <div className="flex flex-col gap-4 px-5 py-4">
            <label className="flex flex-col gap-1.5">
              <span className={LABEL}>Name</span>
              <input
                name="name"
                required
                placeholder="e.g. Annual review 2026"
                className={FIELD}
              />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className={LABEL}>Kind</span>
              <select name="workflow_type" defaultValue="annual_review" className={FIELD}>
                {(Object.keys(WORKFLOW_TYPE_LABEL) as WorkflowType[]).map((t) => (
                  <option key={t} value={t}>
                    {WORKFLOW_TYPE_LABEL[t]}
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
              {pending ? 'Starting…' : 'Start workflow'}
            </button>
          </div>
        </form>
      </dialog>
    </>
  )
}

/**
 * The work being done for this group.
 *
 * Minimal on purpose, and the empty state says as much: there are no steps, no
 * due dates and no assignment beyond an owner yet. What exists is enough for a
 * file note to say which piece of work it belongs to, which is what it was
 * built for.
 */
export function WorkflowSection({
  groupId,
  workflows,
}: {
  groupId: string
  workflows: WorkflowOption[]
}) {
  return (
    <DataSection
      title="Workflows"
      addLabel="Start workflow"
      countLabel={
        workflows.length
          ? `${workflows.length} workflow${workflows.length === 1 ? '' : 's'}`
          : undefined
      }
      action={<StartWorkflowModal groupId={groupId} triggerVariant="quiet" />}
      emptyAction={<StartWorkflowModal groupId={groupId} />}
      empty={{
        title: 'No workflows running',
        description:
          'Onboarding, annual reviews and advice production appear here once started.',
      }}
    >
      {workflows.length
        ? workflows.map((w) => (
            <DataRow
              key={w.id}
              primary={w.name}
              secondary={WORKFLOW_TYPE_LABEL[w.workflow_type]}
              meta={<Pill tone={STATUS_TONE[w.status]}>{WORKFLOW_STATUS_LABEL[w.status]}</Pill>}
            />
          ))
        : null}
    </DataSection>
  )
}
