'use client'

import { useState, useTransition } from 'react'
import { setWorkflowPriority, setWorkflowStatus } from '@/app/(shell)/groups/actions'
import type { WorkflowStatus, WorkflowType } from '@/lib/notes'
import {
  WORKFLOW_STATUS_LABEL,
  WORKFLOW_STATUSES,
  WORKFLOW_TYPE_LABEL,
  workflowProgress,
  type Priority,
} from '@/lib/workflow-board'
import { MenuPicker } from './menu-picker'
import { PriorityPicker } from './priority-picker'
import { Pill, type PillTone } from './ui'
import { ChevronDownIcon } from './icons'

/* Blocked is the one worth noticing, so it is the one that gets amber; under
   review takes the brand tone; finished and unstarted work stay neutral. */
const STATUS_TONE: Record<WorkflowStatus, PillTone> = {
  not_started: 'neutral',
  in_progress: 'success',
  blocked: 'warning',
  under_review: 'brand',
  complete: 'neutral',
  cancelled: 'neutral',
}

/**
 * The workflow's state: its marks, and the progress bar underneath them.
 *
 * These are one component because **the bar is derived from the status the
 * marks edit.** Splitting them would mean two copies of the status, and the
 * moment one was editable the other would be a stale number sitting inches
 * below it. Here, changing the status moves the bar in the same render.
 *
 * Optimistic and reverted on refusal, the same contract as the board: the mark
 * changes the moment it is chosen, and goes back with the server's reason if
 * the server says no. This is the single-record twin of `useWorkflowCards`,
 * which does the same for an array of cards; the shapes are different enough
 * that sharing the code would mean pretending a page is a board.
 */
export function WorkflowState({
  id,
  name,
  workflowType,
  status: initialStatus,
  priority: initialPriority,
}: {
  id: string
  name: string
  workflowType: WorkflowType
  status: WorkflowStatus
  priority: Priority
}) {
  const [status, setStatus] = useState(initialStatus)
  const [priority, setPriority] = useState(initialPriority)
  const [error, setError] = useState<string | null>(null)
  const [, start] = useTransition()

  function changeStatus(next: WorkflowStatus) {
    const before = status
    setError(null)
    setStatus(next)
    start(async () => {
      const result = await setWorkflowStatus(id, next)
      if (result && 'error' in result) {
        setStatus(before)
        setError(result.error)
      }
    })
  }

  function changePriority(next: Priority) {
    const before = priority
    setError(null)
    setPriority(next)
    start(async () => {
      const result = await setWorkflowPriority(id, next)
      if (result && 'error' in result) {
        setPriority(before)
        setError(result.error)
      }
    })
  }

  const { percent, label } = workflowProgress(status)

  return (
    <>
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        {/* The kind is not editable: changing what a piece of work *is* is not
            a status change, and there is no rule yet for what it would mean. */}
        <Pill tone="neutral">{WORKFLOW_TYPE_LABEL[workflowType]}</Pill>

        {/* The status pill IS the control. It keeps the pill's look, so the
            page does not grow a second vocabulary for the same fact, and
            carries a chevron so it reads as something that opens. */}
        <MenuPicker
          value={status}
          options={WORKFLOW_STATUSES.map((s) => ({ id: s, label: WORKFLOW_STATUS_LABEL[s] }))}
          onChange={changeStatus}
          trigger={
            <Pill tone={STATUS_TONE[status]}>
              {WORKFLOW_STATUS_LABEL[status]}
              <ChevronDownIcon className="-mr-0.5 ml-0.5 h-3 w-3 opacity-70" />
            </Pill>
          }
          triggerAriaLabel={`Status: ${WORKFLOW_STATUS_LABEL[status]}. Change status of ${name}`}
          triggerTitle={`Status: ${WORKFLOW_STATUS_LABEL[status]}`}
          menuAriaLabel={`Status of ${name}`}
          triggerClassName="rounded-full"
        />

        <PriorityPicker value={priority} onChange={changePriority} name={name} withLabel />
      </div>

      {error ? (
        <p role="alert" className="mt-2 text-sm text-red-600">
          {error}
        </p>
      ) : null}

      {/* Space either side of the bar, so it reads as its own band rather than
          as a rule attached to the marks above or the fields below. */}
      <div className="mt-6">
        <div className="mb-2 flex items-baseline justify-between gap-3">
          <span className="text-xs font-medium text-neutral-700">{label}</span>
          <span className="text-xs font-semibold tabular-nums text-neutral-900">
            {percent === null ? '—' : `${percent}%`}
          </span>
        </div>
        {/* emerald-600 on a 70% neutral-200 track measures 3.11:1 — a bar is a
            non-text graphic, so its fill has to clear 3:1 against the track it
            sits in or the "how far" is invisible to some readers. emerald-500,
            the brighter first choice, measured 2.01:1 and was rejected. */}
        <div
          role="progressbar"
          aria-label="Progress"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={percent ?? undefined}
          aria-valuetext={percent === null ? label : `${label}, ${percent}% complete`}
          className="h-2 w-full overflow-hidden rounded-full bg-neutral-200/70"
        >
          <div
            className={`h-full rounded-full transition-[width] duration-300 ${
              percent === null ? 'bg-neutral-300' : 'bg-emerald-600'
            }`}
            style={{ width: `${percent ?? 0}%` }}
          />
        </div>
      </div>
    </>
  )
}
