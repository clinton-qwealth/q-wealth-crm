'use client'

import { useEffect, useRef, useState, useTransition } from 'react'
import {
  attachNoteToWorkflow,
  fileNoteUnderNewWorkflow,
} from '@/app/(shell)/groups/actions'
import type { NoteHeader, WorkflowOption, WorkflowStatus, WorkflowType } from '@/lib/notes'
import { DataRow, DataSection } from './data-section'
import { AddNoteModal, NOTE_TYPE_LABEL } from './add-note-modal'
import { Pill } from './ui'
import { PlusIcon } from './icons'

export const WORKFLOW_TYPE_LABEL: Record<WorkflowType, string> = {
  onboarding: 'Onboarding',
  annual_review: 'Annual review',
  advice_production: 'Advice production',
  insurance_claim: 'Insurance claim',
  ad_hoc: 'Ad hoc',
}

export const WORKFLOW_STATUS_LABEL: Record<WorkflowStatus, string> = {
  not_started: 'Not started',
  in_progress: 'In progress',
  blocked: 'Blocked',
  complete: 'Complete',
  cancelled: 'Cancelled',
}

const FIELD =
  'w-full rounded-md border border-neutral-300 bg-white px-2.5 py-1.5 text-sm text-neutral-900 outline-none transition-colors placeholder:text-neutral-400 focus:border-brand-300 focus:ring-2 focus:ring-brand/15'
const LABEL = 'text-xs font-medium text-neutral-600'

/**
 * A note's date, rendered in the reader's timezone.
 *
 * DELIBERATELY NOT the formatDate() used for a date of birth, and the
 * difference is not cosmetic. A date of birth is a calendar date with no
 * timezone, so that helper splits the string and never touches Date — putting
 * it through `new Date()` renders the previous day west of Greenwich.
 *
 * `occurred_at` is a timestamptz: an instant. The calendar date it falls on
 * genuinely depends on where you are standing, and the adviser's own timezone
 * is the right answer. Splitting the string here would show the UTC date, which
 * in Sydney is the previous day for the first ten hours of every morning.
 *
 * Same-looking problem, opposite fix.
 */
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

export function formatNoteDate(iso: string) {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  /* getDate/getMonth/getFullYear read the LOCAL calendar parts of the instant,
     which is the conversion this needs. The month name is then taken from a
     fixed list rather than from toLocaleDateString: `month: 'short'` renders
     "Jul" in a browser and "July" under Node's ICU in the test runner, and a
     date format that changes with the runtime is one nobody can assert on. */
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`
}

/** Who added it — and an honest answer when the answer is "nobody did". */
function byline(note: NoteHeader) {
  if (note.author_name) return note.author_name
  return note.source === 'integration' ? 'Added by an integration' : 'Author not recorded'
}

/**
 * The workflow a note belongs to, or the way to give it one.
 *
 * Both states occupy the same slot on the row, so the list does not reflow as
 * notes get filed. The pill is a button in both cases: without that, a note
 * filed under the wrong workflow could never be moved, and set_note_workflow
 * accepts null precisely so it can be taken back out.
 */
function WorkflowCell({ note, onPick }: { note: NoteHeader; onPick: () => void }) {
  if (note.workflow_id && note.workflow_name) {
    // Brand marks a label — something that identifies the row. A workflow that
    // has finished is no longer live work, so it drops to neutral rather than
    // continuing to read as active.
    const finished = note.workflow_status === 'complete' || note.workflow_status === 'cancelled'
    return (
      <button
        type="button"
        onClick={onPick}
        title={`Workflow: ${note.workflow_name}. Change or remove.`}
        className="max-w-[10rem] rounded-full outline-none focus-visible:ring-2 focus-visible:ring-brand/30"
      >
        <Pill tone={finished ? 'neutral' : 'brand'}>
          <span className="truncate">{note.workflow_name}</span>
        </Pill>
      </button>
    )
  }

  return (
    <button
      type="button"
      onClick={onPick}
      className="inline-flex items-center gap-1 rounded-full border border-dashed border-neutral-300 px-2 py-0.5 text-[11px] font-medium text-neutral-500 outline-none transition-colors hover:border-brand-300 hover:bg-brand-50/60 hover:text-brand-700 focus-visible:ring-2 focus-visible:ring-brand/30"
    >
      <PlusIcon className="h-3 w-3" />
      Add to workflow
    </button>
  )
}

/**
 * The picker. ONE dialog for the whole list, opened with whichever note was
 * clicked — not one dialog per row.
 *
 * Per-row dialogs are how the member panel is built and it has cost real time:
 * every closed <dialog> still has its contents in the DOM, so anything looking
 * for text on the page keeps finding copies inside panels nobody has opened.
 */
function WorkflowPicker({
  note,
  groupId,
  workflows,
  onDone,
}: {
  note: NoteHeader | null
  groupId: string
  workflows: WorkflowOption[]
  onDone: () => void
}) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const [pending, start] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [type, setType] = useState<WorkflowType>('annual_review')

  /* Clearing the previous note's error and half-typed workflow name is a
     render-time adjustment, not an effect. Doing it in the effect below would
     paint the new note's dialog once carrying the old note's error before
     correcting itself — and React's compiler-based lint rule refuses it for
     exactly that reason. `opened` is the note this dialog was last set up for. */
  const [opened, setOpened] = useState<NoteHeader | null>(null)
  if (note !== opened) {
    setOpened(note)
    if (note) {
      setError(null)
      setName('')
    }
  }

  useEffect(() => {
    const el = dialogRef.current
    if (!el) return
    if (note && !el.open) el.showModal()
    if (!note && el.open) el.close()
  }, [note])

  useEffect(() => {
    const el = dialogRef.current
    if (!el) return
    const onClose = () => onDone()
    el.addEventListener('close', onClose)
    return () => el.removeEventListener('close', onClose)
  }, [onDone])

  function run(work: () => Promise<{ error: string } | { ok: true } | null>) {
    setError(null)
    start(async () => {
      const result = await work()
      if (result && 'error' in result) {
        setError(result.error)
        return
      }
      dialogRef.current?.close()
    })
  }

  // Finished work does not take new notes: filing one under a closed review
  // would quietly reopen it. The note's current workflow is kept in the list
  // even if it has finished, so it can still be seen and removed.
  const choosable = workflows.filter(
    (w) =>
      (w.status !== 'complete' && w.status !== 'cancelled') || w.id === note?.workflow_id,
  )

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby="workflow-picker-title"
      onClick={(e) => {
        if (e.target === dialogRef.current) dialogRef.current?.close()
      }}
      className="qw-modal m-auto w-[min(26rem,calc(100vw-2rem))] rounded-xl border border-neutral-200 bg-white p-0 shadow-2xl shadow-neutral-900/10"
    >
      <div className="border-b border-neutral-100 px-5 py-4">
        <h2
          id="workflow-picker-title"
          className="text-base font-semibold tracking-tight text-neutral-900"
        >
          File under a workflow
        </h2>
        <p className="mt-0.5 truncate text-xs text-neutral-500">
          {note?.title ?? (note ? NOTE_TYPE_LABEL[note.note_type] : '')}
        </p>
      </div>

      <div className="flex flex-col gap-4 px-5 py-4">
        {choosable.length ? (
          <div className="flex flex-col gap-1.5">
            <span className={LABEL}>Existing work</span>
            <ul className="flex flex-col gap-1.5">
              {choosable.map((w) => {
                const current = w.id === note?.workflow_id
                return (
                  <li key={w.id}>
                    <button
                      type="button"
                      disabled={pending || current}
                      onClick={() => run(() => attachNoteToWorkflow(note!.note_id, w.id))}
                      className="flex w-full items-center justify-between gap-3 rounded-md border border-neutral-200 bg-white px-3 py-2 text-left outline-none transition-colors hover:border-brand-300 hover:bg-brand-50/40 disabled:cursor-default disabled:opacity-60 focus-visible:ring-2 focus-visible:ring-brand/30"
                    >
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-medium text-neutral-900">
                          {w.name}
                        </span>
                        <span className="block truncate text-xs text-neutral-400">
                          {WORKFLOW_TYPE_LABEL[w.workflow_type]} ·{' '}
                          {WORKFLOW_STATUS_LABEL[w.status]}
                        </span>
                      </span>
                      {current ? <Pill tone="success">Current</Pill> : null}
                    </button>
                  </li>
                )
              })}
            </ul>
          </div>
        ) : (
          <p className="text-xs leading-relaxed text-neutral-500">
            No workflows have been started for this group yet. Starting one here files
            this note under it.
          </p>
        )}

        <div className="flex flex-col gap-2 border-t border-neutral-100 pt-4">
          <span className={LABEL}>Start a new one</span>
          <div className="grid grid-cols-2 gap-2">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Name, e.g. Annual review 2026"
              className={`${FIELD} col-span-2`}
            />
            <select
              value={type}
              onChange={(e) => setType(e.target.value as WorkflowType)}
              className={FIELD}
            >
              {(Object.keys(WORKFLOW_TYPE_LABEL) as WorkflowType[]).map((t) => (
                <option key={t} value={t}>
                  {WORKFLOW_TYPE_LABEL[t]}
                </option>
              ))}
            </select>
            <button
              type="button"
              disabled={pending || !name.trim()}
              onClick={() =>
                run(() => fileNoteUnderNewWorkflow(note!.note_id, groupId, name, type))
              }
              className="rounded-md bg-brand px-3 py-1.5 text-sm font-medium text-white outline-none transition-colors hover:bg-brand-600 disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-brand/40"
            >
              Start and file
            </button>
          </div>
        </div>

        {error ? (
          <p role="alert" className="text-sm text-red-600">
            {error}
          </p>
        ) : null}
      </div>

      <div className="flex justify-between gap-2 border-t border-neutral-100 bg-neutral-50/60 px-5 py-3">
        {note?.workflow_id ? (
          <button
            type="button"
            disabled={pending}
            onClick={() => run(() => attachNoteToWorkflow(note.note_id, null))}
            className="rounded-md px-2 py-1.5 text-sm font-medium text-neutral-600 outline-none transition-colors hover:bg-neutral-100 hover:text-neutral-900 disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-brand/30"
          >
            Remove from workflow
          </button>
        ) : (
          <span />
        )}
        <button
          type="button"
          onClick={() => dialogRef.current?.close()}
          className="rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-sm font-medium text-neutral-800 outline-none transition-colors hover:bg-neutral-50 focus-visible:ring-2 focus-visible:ring-brand/30"
        >
          Close
        </button>
      </div>
    </dialog>
  )
}

/**
 * The group's file notes: header and metadata only.
 *
 * Built from the same DataSection and DataRow as the accounts and insurance
 * lists, so the third column reads as the same kind of thing as the second
 * rather than as a different design that happens to sit beside it.
 *
 * There is no note body here, and there is none in the view behind it either.
 */
export function FileNotes({
  groupId,
  notes,
  workflows,
}: {
  groupId: string
  notes: NoteHeader[]
  workflows: WorkflowOption[]
}) {
  const [picking, setPicking] = useState<NoteHeader | null>(null)

  return (
    <>
      <DataSection
        title="File Notes"
        addLabel="Add file note"
        countLabel={notes.length ? `${notes.length} note${notes.length === 1 ? '' : 's'}` : undefined}
        action={<AddNoteModal groupId={groupId} workflows={workflows} triggerVariant="quiet" />}
        emptyAction={<AddNoteModal groupId={groupId} workflows={workflows} />}
        empty={{
          title: 'No file notes yet',
          description:
            'File notes, meeting summaries and call records for this group appear here, newest first.',
        }}
      >
        {notes.length
          ? notes.map((n) => (
              <DataRow
                key={n.note_id}
                /* An untitled note is not nameless — its kind is the next most
                   useful thing to read, and every note has one. */
                primary={n.title ?? NOTE_TYPE_LABEL[n.note_type] ?? 'Note'}
                secondary={`${formatNoteDate(n.occurred_at)} · ${byline(n)}`}
                meta={<WorkflowCell note={n} onPick={() => setPicking(n)} />}
              />
            ))
          : null}
      </DataSection>

      <WorkflowPicker
        note={picking}
        groupId={groupId}
        workflows={workflows}
        onDone={() => setPicking(null)}
      />
    </>
  )
}
