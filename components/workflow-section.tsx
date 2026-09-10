'use client'

import { useActionState, useEffect, useRef, useState } from 'react'
import { startWorkflow, type NoteState } from '@/app/(shell)/groups/actions'
import type { WorkflowType } from '@/lib/notes'
import type { BoardCard } from '@/lib/workflow-board'
import { PlusIcon } from './icons'
import { formatNoteDate, WORKFLOW_TYPE_LABEL } from './file-notes'
import { ReservedColumn, TAB_SPLIT } from './ui'
import { WorkflowCard } from './workflow-card'
import { useWorkflowCards } from './use-workflow-cards'

const FIELD =
  'w-full rounded-md border border-neutral-300 bg-white px-2.5 py-1.5 text-sm text-neutral-900 outline-none transition-colors placeholder:text-neutral-400 focus:border-brand-300 focus:ring-2 focus:ring-brand/15'
const LABEL = 'text-xs font-medium text-neutral-600'

export function StartWorkflowModal({
  groupId,
  groups,
  triggerVariant = 'primary',
}: {
  /** The group the work is for, when the caller already knows it. */
  groupId?: string
  /**
   * Offered instead when the caller does not — the cross-group board. The
   * form then carries a select named `group_id`, so the server action reads
   * the same field either way and does not know which caller it served.
   */
  groups?: { id: string; name: string }[]
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
          {groupId ? <input type="hidden" name="group_id" value={groupId} /> : null}
          <div className="border-b border-neutral-100 px-5 py-4">
            <h2
              id="start-workflow-title"
              className="text-base font-semibold tracking-tight text-neutral-900"
            >
              Start workflow
            </h2>
            <p className="mt-0.5 text-xs text-neutral-500">
              A piece of work being done for {groups ? 'a client group' : 'this group'}. File notes
              can be filed under it.
            </p>
          </div>

          <div className="flex flex-col gap-4 px-5 py-4">
            {groups ? (
              <label className="flex flex-col gap-1.5">
                <span className={LABEL}>Client group</span>
                <select name="group_id" required defaultValue="" className={FIELD}>
                  <option value="" disabled>
                    Choose a group
                  </option>
                  {groups.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.name}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
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
 * The card's second line on the group page. The board puts the group's name
 * there; on the group's own page that is the page title, so the line carries
 * something the board does not show — when the work started or finished.
 */
export function cardSubtitle(c: BoardCard): string {
  if (c.status === 'complete' && c.completed_at) return `Completed ${formatNoteDate(c.completed_at)}`
  if (c.status === 'cancelled') return 'Cancelled'
  if (c.started_at) return `Started ${formatNoteDate(c.started_at)}`
  return 'Not started yet'
}

/**
 * The work being done for this group, as the same cards the board shows.
 *
 * Laid out as one lane at the board's lane width — the cards are the board's
 * cards, so they should be met at the board's size — with the rest of the tab
 * left deliberately empty. That space is a placeholder: something will go
 * there once it is clear what a group's workflows need beside them, and an
 * honest blank is better than a guess dressed up as a feature.
 *
 * Moving and reprioritising work here exactly as on the board, through the
 * same hook, so the two screens cannot disagree about what a change does.
 */
export function WorkflowSection({
  groupId,
  workflows,
}: {
  groupId: string
  workflows: BoardCard[]
}) {
  const { cards, error, move, reprioritise } = useWorkflowCards(workflows)
  const live = cards.filter((c) => c.status !== 'cancelled')
  const cancelled = cards.length - live.length

  if (!live.length) {
    return (
      <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-neutral-200 bg-neutral-50/60 px-6 py-10 text-center">
        <span className="flex h-9 w-9 items-center justify-center rounded-full bg-white text-neutral-400 ring-1 ring-neutral-200">
          <PlusIcon className="h-4 w-4" />
        </span>
        <p className="mt-3 text-sm font-medium text-neutral-700">No workflows running</p>
        <p className="mt-1 max-w-xs text-xs leading-relaxed text-neutral-500">
          Onboarding, annual reviews and advice production appear here once started.
        </p>
        <div className="mt-4">
          <StartWorkflowModal groupId={groupId} />
        </div>
        {cancelled ? (
          <p className="mt-4 text-xs text-neutral-400">
            {cancelled} cancelled workflow{cancelled === 1 ? ' is' : 's are'} not shown.
          </p>
        ) : null}
      </div>
    )
  }

  return (
    <div>
      <div className="mb-2.5 flex items-center justify-between gap-3">
        <h3 className="truncate text-xs font-semibold uppercase tracking-wider text-neutral-500">
          Workflows
        </h3>
        <p className="text-xs text-neutral-500">
          {live.length} workflow{live.length === 1 ? '' : 's'}
        </p>
        <StartWorkflowModal groupId={groupId} triggerVariant="quiet" />
      </div>

      {error ? (
        <p role="alert" className="mb-3 text-sm text-red-600">
          {error}
        </p>
      ) : null}

      {/* The cards take 55% of the tab and the reserved half 45%. The split
          itself lives in `TAB_SPLIT` — the Accounts tab was asked for exactly
          the same one on 10 September, so the measurements and the reasoning
          moved there rather than being copied. There is no inner well around
          the stack: the tab body is already the well (same token), and a well
          inside a well of the same tone is invisible, so it would only inset
          the cards past the heading's edge. */}
      <div className={TAB_SPLIT}>
        <section aria-label="Workflow cards">
          <ul className="flex flex-col gap-2">
            {live.map((c) => (
              <li key={c.id}>
                <WorkflowCard
                  card={c}
                  subtitle={cardSubtitle(c)}
                  onMove={(to) => move(c.id, to)}
                  onPriority={(p) => reprioritise(c.id, p)}
                />
              </li>
            ))}
          </ul>
        </section>
        <ReservedColumn />
      </div>

      {cancelled ? (
        <p className="mt-3 text-xs text-neutral-400">
          {cancelled} cancelled workflow{cancelled === 1 ? ' is' : 's are'} not shown.
        </p>
      ) : null}
    </div>
  )
}
