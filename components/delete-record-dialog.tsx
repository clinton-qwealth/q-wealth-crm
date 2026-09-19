'use client'

import { useEffect, useRef, useState, useTransition, type ReactNode } from 'react'
import { FIELD_INPUT } from './field-box'
import type { RecordDetailState } from '@/app/(shell)/groups/actions'

/**
 * "Delete this record?" — the one destructive confirmation in the product that
 * asks the reader to type a word. Built for accounts on 19 September and
 * generalised the same day when policies asked for it: the SECOND copy is the
 * moment `field-box.tsx` says to extract, and this is what the extraction
 * looks like. The dialog owns the gate, the outcome and the focus; the panel
 * that opens it supplies the record's name, the sentence about what will go,
 * and the action to call.
 *
 * ## Why a dialog over the drawer, and why it is mounted only while confirming
 *
 * Asked for as a popup on 19 September. The two other irreversible actions here
 * confirm in place (`RemoveMember`, `RemovableMedia`), and that would have been
 * the house answer; a typed word wants room and undivided attention, which a
 * modal gives it. It is rendered ONLY while the reader is confirming: both
 * drawer tests hold the list to exactly one `<dialog>` at rest, and the e2e spec
 * locates `dialog[open]` in strict mode. A dialog that exists only between the
 * press and the outcome keeps both of those honest without loosening either.
 *
 * ## What the typed word is, and is not
 *
 * `Delete`, exactly — capital D, no trailing space. It is an ARMING GATE: it
 * stops a slip of the hand on a red button, and that is all. It is not sent to
 * the server and nothing there checks it. The rules that decide whether the
 * delete happens are the database's — the caller's access, and the trigger that
 * refuses any account a feed maintains — and those bind the MCP and psql, which
 * type nothing. Say this to the next person who wants to add a `p_confirmation`
 * argument: it would imply the server had checked something it had not.
 *
 * ## The refusal outlives the confirmation it came from
 *
 * `RemoveMember`'s rule, and the reason the dialog stays open on an error with
 * the typed word still in the field: a dialog that snapped shut and reappeared
 * as a plain button dropped its own message on the same render, and the press
 * "looked like it had done nothing at all." Here the sentence sits under the
 * field, the confirm stays armed, and the reader chooses.
 *
 * ## Focus
 *
 * The browser gives the field initial focus (`autoFocus` inside `showModal()`)
 * and, on Cancel or Escape, returns it to the footer's Delete button, which
 * still exists. On success the parent unmounts this AND closes the drawer, so
 * there is nothing to return to; `AccountList` moves focus to its status line
 * instead. This component does not call `close()` on success: it would fire
 * the `close` listener and report a cancellation a beat before the success.
 * Today the parent reaches the same state either way — a mutation adding the
 * call survived every test, which is how that was learned — so this is
 * tidiness rather than a guard, and is recorded as exactly that.
 */
export function DeleteRecordDialog({
  record,
  label,
  children,
  onDelete,
  onCancel,
  onDeleted,
}: {
  /** The noun on the red button — "Delete account", "Delete policy". */
  record: 'account' | 'policy'
  /** The record's own name, for the title and the notice afterwards. */
  label: string
  /** The warning: what goes with it and what stays. The panel knows; this does not. */
  children: ReactNode
  /** The server action, already bound to the record's id. */
  onDelete: () => Promise<RecordDetailState>
  /** Escape, backdrop, Cancel — any close that is not a deletion. */
  onCancel: () => void
  /** The record is gone. The parent closes the drawer and says so. */
  onDeleted: (label: string) => void
}) {
  const ref = useRef<HTMLDialogElement>(null)
  const [typed, setTyped] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, start] = useTransition()

  /* Exact. `.toLowerCase()` or `.trim()` here would each be a mutation the
     tests catch, and each would make the gate a little less of one. */
  const armed = typed === 'Delete'

  useEffect(() => {
    const el = ref.current
    if (!el) return
    /* Guarded like `Drawer`'s: `showModal()` on an open dialog throws in a real
       browser and is silent in jsdom. */
    if (!el.open) el.showModal()
    const bubble = () => onCancel()
    el.addEventListener('close', bubble)
    return () => {
      el.removeEventListener('close', bubble)
      if (el.open) el.close()
    }
  }, [onCancel])

  function confirm() {
    if (!armed || busy) return
    setError(null)
    start(async () => {
      let result: RecordDetailState
      try {
        result = await onDelete()
      } catch {
        result = { error: `The ${record} could not be deleted. Nothing was changed — try again.` }
      }
      if (result && 'error' in result) {
        setError(result.error)
        return
      }
      onDeleted(label)
    })
  }

  const titleId = 'delete-record-title'

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      data-slot="delete-record-dialog"
      data-record={record}
      onClick={(e) => {
        /* A backdrop click lands on the dialog itself; a click inside lands on
           the panel. The identity test is what tells them apart. */
        if (e.target === ref.current) ref.current?.close()
      }}
      className="qw-modal m-auto w-[min(32rem,calc(100vw-2rem))] rounded-xl border border-neutral-200 bg-white p-0 shadow-2xl shadow-neutral-900/10"
    >
      <div className="flex flex-col">
        <div className="border-b border-neutral-100 px-5 py-4">
          <h2 id={titleId} className="text-base font-semibold tracking-tight text-neutral-900">
            Delete {label}?
          </h2>
        </div>

        <div className="space-y-4 px-5 py-4">
          <p data-slot="delete-warning" className="text-sm leading-relaxed text-neutral-700">
            {children}
          </p>

          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-semibold uppercase tracking-wider text-neutral-500">
              Type <span className="normal-case tracking-normal text-neutral-900">Delete</span> to confirm
            </span>
            <input
              autoFocus
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  confirm()
                }
              }}
              autoComplete="off"
              spellCheck={false}
              aria-label="Type Delete to confirm"
              className={FIELD_INPUT}
            />
          </label>

          {error ? (
            <p role="alert" className="text-sm text-red-600">
              {error}
            </p>
          ) : null}
        </div>

        <div className="flex justify-end gap-2 border-t border-neutral-100 bg-neutral-50/60 px-5 py-3">
          <button
            type="button"
            onClick={() => ref.current?.close()}
            className="rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-sm font-medium text-neutral-800 outline-none transition-colors hover:bg-neutral-50 focus-visible:ring-2 focus-visible:ring-brand/30"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={confirm}
            disabled={!armed || busy}
            className="rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white outline-none transition-colors hover:bg-red-700 disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-red-500/40"
          >
            {busy ? 'Deleting…' : `Delete ${record}`}
          </button>
        </div>
      </div>
    </dialog>
  )
}
