'use client'

import { useEffect, useRef, useState, useTransition, type ReactNode } from 'react'
import {
  attachNoteToWorkflow,
  fileNoteUnderNewWorkflow,
} from '@/app/(shell)/groups/actions'
import type { NoteHeader, WorkflowOption, WorkflowType } from '@/lib/notes'
import { DataSection } from './data-section'
import { AddNoteModal, NOTE_TYPE_LABEL } from './add-note-modal'
import { NoteTypeGlyph, Pill } from './ui'
import { ChevronDownIcon, PlusIcon } from './icons'
import { WORKFLOW_STATUS_LABEL, WORKFLOW_TYPE_LABEL } from '@/lib/workflow-board'
import { formatNoteDate } from '@/lib/note-date'

/* Re-exported for the client components that always imported them from here.
   The definitions moved to lib so a Server Component can read them too. */
export { WORKFLOW_STATUS_LABEL, WORKFLOW_TYPE_LABEL } from '@/lib/workflow-board'
export { formatNoteDate } from '@/lib/note-date'

const FIELD =
  'w-full rounded-md border border-neutral-300 bg-white px-2.5 py-1.5 text-sm text-neutral-900 outline-none transition-colors placeholder:text-neutral-400 focus:border-brand-300 focus:ring-2 focus:ring-brand/15'
const LABEL = 'text-xs font-medium text-neutral-600'


/** Who added it — and an honest answer when the answer is "nobody did". */
function byline(note: NoteHeader) {
  if (note.author_name) return note.author_name
  return note.source === 'integration' ? 'Added by an integration' : 'Author not recorded'
}

/**
 * The workflow a note belongs to, or the way to give it one.
 *
 * Both states occupy the same slot, so the list does not reflow as notes get
 * filed — and since 10 September that slot is a line of its own beneath the
 * tile and the title, which is what lets a long workflow name show in full.
 * The pill is a button in both cases: without that, a note filed under the
 * wrong workflow could never be moved, and set_note_workflow accepts null
 * precisely so it can be taken back out.
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
        /* `max-w-full`, not the 10rem this carried while it shared the row with
           the title. On its own line the constraint is the column, so the cap
           is the column — and `truncate` inside the pill stays as the backstop
           for a name longer than even that. */
        className="max-w-full rounded-full outline-none focus-visible:ring-2 focus-visible:ring-brand/30"
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
 * One file note, CLOSED by default.
 *
 * The same shape as a task's History entry, deliberately: kind as a pill with
 * its glyph, the moment opposite it, the title under that, and a disclosure
 * onto what the note says. Two lists in the same product showing the same kind
 * of record should not be two designs, and the History tab's version had
 * already been through the argument.
 *
 * **The summary is three facts and the gate holds the words.** A column of
 * notes is scanned for the one somebody wants, so the closed row carries only
 * what identifies it. A file note's body is a paragraph or several; left open
 * it would mean one note fills the column and the list stops being a list.
 *
 * **The excerpt is 255 characters and it is not the note.** The database cuts
 * it, at a word boundary, and says separately whether there is more. Where
 * there is, the row offers Read more — and says plainly that reading a note in
 * full is not built yet, rather than pretending the excerpt is the whole thing.
 * See `note_excerpt()` and the 10 September migration for what does and does
 * not travel.
 *
 * **The workflow pill stays OUTSIDE the gate.** It is the row's one action, and
 * an action hidden behind a disclosure is an action nobody finds. It also has
 * to be outside the gate's own button, because a button inside a button is not
 * valid HTML.
 */
export function NoteRecord({
  note,
  action,
}: {
  note: NoteHeader
  /**
   * The row's one action, rendered under the summary and outside the gate.
   *
   * A SLOT rather than a flag, because the two screens that show a note record
   * want different things there. On a group's page it is the workflow the note
   * is filed under — the fact that tells one row from another. On a workflow's
   * own page **every note is filed under this workflow**, so the same control
   * would read the same on every row: exactly the one-value pill the task list
   * removed on 9 September. That screen passes nothing.
   */
  action?: ReactNode
}) {
  const [open, setOpen] = useState(false)
  const bodyId = `note-${note.note_id}-body`
  /* An untitled note is not nameless — its kind is the next most useful thing
     to read, and every note has one. */
  const title = note.title ?? NOTE_TYPE_LABEL[note.note_type] ?? 'Note'
  const hasWords = note.body_excerpt.length > 0

  return (
    <li className="px-3.5 py-3">
      <button
        type="button"
        onClick={() => setOpen((was) => !was)}
        aria-expanded={open}
        aria-controls={open ? bodyId : undefined}
        className="group flex w-full items-start gap-2 rounded-md text-left outline-none focus-visible:ring-2 focus-visible:ring-brand/30"
      >
        <ChevronDownIcon
          className={`mt-1 h-4 w-4 shrink-0 text-neutral-400 transition-transform group-hover:text-neutral-600 ${
            open ? '' : '-rotate-90'
          }`}
        />
        <span className="min-w-0 flex-1">
          {/* Kind on the left, the moment on the right, on one row. */}
          <span className="flex items-center justify-between gap-2">
            <Pill tone="neutral">
              <NoteTypeGlyph type={note.note_type} className="-ml-0.5 mr-1 h-3 w-3" />
              {NOTE_TYPE_LABEL[note.note_type] ?? note.note_type}
            </Pill>
            <span className="shrink-0 text-[11px] text-neutral-400">
              {formatNoteDate(note.occurred_at)}
            </span>
          </span>

          {/* Truncated, not clamped: a column of records only lines up if each
              summary takes exactly one row. */}
          <span className="mt-1 block truncate text-sm font-semibold text-neutral-900">
            {title}
          </span>

          <span className="mt-0.5 block truncate text-xs text-neutral-500">{byline(note)}</span>
        </span>
      </button>

      {/* The row's one action, outside the gate so it is always reachable —
          when there is one. */}
      {action ? <div className="mt-1.5 pl-6">{action}</div> : null}

      {open ? (
        <div id={bodyId} className="mt-2 pl-6">
          {hasWords ? (
            <>
              {/* No `whitespace-pre-line`: note_flat() has already collapsed every run
                  of whitespace to a single space, so the excerpt is one line by
                  construction and the class would only imply otherwise. */}
              <p className="rounded-md border border-neutral-200 bg-neutral-50/60 px-3 py-2 text-xs leading-relaxed text-neutral-700">
                {note.body_excerpt}
                {note.body_is_truncated ? <span className="text-neutral-400">…</span> : null}
              </p>
              {note.body_is_truncated ? (
                /* Dashed and disabled, the same treatment the Tools tab gives a
                   tile that has no action yet. A live-looking control that did
                   nothing would be worse than one that says what it is. */
                <button
                  type="button"
                  disabled
                  title="Not built yet — reading a note in full is its own path"
                  className="mt-1.5 cursor-not-allowed rounded-full border border-dashed border-neutral-300 px-2 py-0.5 text-[11px] font-medium text-neutral-400"
                >
                  Read more — not built yet
                </button>
              ) : null}
            </>
          ) : (
            <p className="text-xs text-neutral-400">This note has no written body.</p>
          )}
        </div>
      ) : null}
    </li>
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
 * Built on the same DataSection as the accounts and insurance lists, so the
 * sheet, the header and the empty state are the same furniture. The ROWS are
 * not DataRows any more: a note record is a disclosure, and DataRow's primary
 * and secondary are strings with nowhere to put one.
 *
 * The rows follow a task's History entry instead — see NoteRecord — so the two
 * places this product lists a record of something that happened look like one
 * design rather than two.
 *
 * There is no full note body here, and none in the view behind it either. There
 * is a 255-character excerpt, as of 10 September.
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
              <NoteRecord
                key={n.note_id}
                note={n}
                action={<WorkflowCell note={n} onPick={() => setPicking(n)} />}
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
