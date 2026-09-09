'use client'

import { useEffect, useRef, useState } from 'react'
import type { Editor } from '@tiptap/react'
import { recordTaskAction } from '@/app/(shell)/groups/actions'
import { AddressField } from './address-field'
import { MessageEditor } from './message-editor'
import { isEmailAddress, joinAddresses, type PostDoc } from '@/lib/workflow-board'

const INPUT =
  'w-full rounded-md border border-neutral-300 bg-white px-2.5 py-1.5 text-sm text-neutral-900 outline-none transition-colors placeholder:text-neutral-400 focus:border-brand-300 focus:ring-2 focus:ring-brand/15'
const LABEL = 'text-xs font-medium text-neutral-600'

/**
 * Compose an email from a task.
 *
 * **NOTHING IS SENT.** Send records what was composed against the task and
 * closes; the message goes nowhere. That is why the button says what it does
 * under it, and why the recorded row is a task action rather than a file note
 * in the client's record — a note saying the client was emailed, when no
 * message left the building, is a compliance problem and not a feature. The
 * reasoning is in the migration and on the _Task Panel_ page.
 *
 * **To is prefilled and editable.** It arrives as the email of the primary
 * contact of the workflow's client group, which is the person this work is
 * about; it is an input rather than a fixed line because the right recipient is
 * sometimes the accountant, and a prefill that cannot be corrected is a prefill
 * people work around. What is RECORDED is whatever it said on Send — a record
 * has to say where the thing actually went.
 *
 * **From is not editable at all.** It is the signed-in staff member's own
 * profile address. An email that could claim to come from a colleague is the
 * kind of thing this app refuses everywhere else — a post's author is the
 * session, never a parameter — so the sender is shown as text and sent from the
 * page rather than typed.
 */
export function EmailTool({
  workflowId,
  taskId,
  taskSubject,
  recipient,
  sender,
  senderName,
  onClose,
}: {
  workflowId: string
  taskId: string
  /** Seeds the subject line, so the commonest email needs no typing. */
  taskSubject: string
  /** The group's primary contact, or null when there is nobody on file. */
  recipient: { email: string; name: string | null } | null
  /** The signed-in staff member's own address. */
  sender: string
  senderName: string
  onClose: () => void
}) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const editorRef = useRef<Editor | null>(null)
  /* A LIST, and the text still being typed alongside it. Both live here rather
     than inside the field, because Send has to be able to count an address
     that was typed and never finished — see `send()` and AddressField. */
  const [to, setTo] = useState<string[]>(recipient?.email ? [recipient.email] : [])
  const [toDraft, setToDraft] = useState('')
  const [subject, setSubject] = useState(taskSubject)
  const [sending, setSending] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)

  /* Opened by rendering, not by a click: the Tools tab decides when this
     exists, so the dialog shows itself on mount and the tab drops it on close. */
  useEffect(() => {
    dialogRef.current?.showModal()
  }, [])

  useEffect(() => {
    const el = dialogRef.current
    if (!el) return
    // Escape and a backdrop click both close a native dialog without going
    // through our handler, so the parent is told from the element's own event.
    el.addEventListener('close', onClose)
    return () => el.removeEventListener('close', onClose)
  }, [onClose])

  async function send() {
    if (sending) return
    setProblem(null)

    /* Whatever is still being typed counts. Somebody who types an address and
       goes straight for Send has finished it, and losing it because it never
       became a pill would be this field failing at the only job it has. It is
       NAMED rather than dropped when it is not an address — the alternative is
       recording an email to fewer people than the writer thinks. */
    const pending = toDraft.trim()
    if (pending && !isEmailAddress(pending)) {
      setProblem(`“${pending}” does not look like an email address.`)
      return
    }
    const list = pending && !to.includes(pending) ? [...to, pending] : to
    if (!list.length) {
      setProblem('An email needs a recipient.')
      return
    }
    /* Committed before the call, so a REFUSED record leaves the box in the
       state the writer sees rather than with a pill's worth of text back in
       the input. */
    setTo(list)
    setToDraft('')

    setSending(true)
    try {
      /* Through JSON and back, for the reason the feed's composer does it:
         ProseMirror builds a node's attrs with Object.create(null), and React's
         Server Action serialiser turns a null-prototype object into an opaque
         reference rather than data — the server then throws on first access. */
      const raw = editorRef.current?.getJSON()
      const body = raw ? (JSON.parse(JSON.stringify(raw)) as PostDoc) : null
      const result = await recordTaskAction(
        workflowId,
        taskId,
        'email',
        joinAddresses(list),
        sender,
        subject,
        body,
      )
      if (result && 'error' in result) {
        /* The box stays open with everything still in it. The same contract the
           feed's composer has: a refusal never costs the writer their words. */
        setProblem(result.error)
        return
      }
      dialogRef.current?.close()
    } catch {
      setProblem('That could not be recorded. Nothing was sent.')
    } finally {
      setSending(false)
    }
  }

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby="email-tool-title"
      onClick={(e) => {
        if (e.target === dialogRef.current) dialogRef.current?.close()
      }}
      className="qw-modal m-auto w-[min(38rem,calc(100vw-2rem))] rounded-xl border border-neutral-200 bg-white p-0 shadow-2xl shadow-neutral-900/10"
    >
      {/* Capped at the window, with only the FIELDS scrolling. The content box
          grew to ten lines, which on a short laptop window would otherwise
          push Send below the fold — and Send is the point of the dialog, so it
          is the one thing that must never need scrolling to. */}
      <div className="flex max-h-[calc(100vh-4rem)] flex-col">
        {/* The title alone. The template picker was here for part of 9 September
            and has moved to the footer — see the note on that row. */}
        <div className="shrink-0 border-b border-neutral-100 px-5 py-4">
          <h2 id="email-tool-title" className="text-base font-semibold tracking-tight text-neutral-900">
            Email
          </h2>
          <p className="mt-0.5 text-xs text-neutral-500">
            Composed against this task.{' '}
            <span className="font-medium text-neutral-700">Nothing is sent yet.</span>
          </p>
        </div>

        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-5 py-4">
          {/* From is text, not an input. An email that could claim to come from
              a colleague is what the rest of this app refuses by construction. */}
          <div className="flex flex-col gap-1.5">
            <span className={LABEL}>From</span>
            <p className="text-sm text-neutral-900">
              {senderName} <span className="text-neutral-500">· {sender}</span>
            </p>
          </div>

          {/* The hint is DESCRIBED BY, not part of the name. Wrapping label
              text and hint in one <label> made the field's accessible name
              "To Jane Testsmith, the primary contact for…" — a description
              being read out as a label.

              MORE THAN ONE RECIPIENT is allowed, and the hint says so, because
              a field showing a single pill gives no sign that a second address
              would be accepted. Every address is recorded on the one row: a
              record says where the thing went, which is one fact about one
              action. */}
          <div className="flex flex-col gap-1.5">
            <label className={LABEL} htmlFor="email-to">
              To
            </label>
            <AddressField
              id="email-to"
              addresses={to}
              draft={toDraft}
              onChange={setTo}
              onDraftChange={setToDraft}
              describedBy="email-to-hint"
              placeholder="nobody@example.com"
            />
            {recipient ? (
              <span id="email-to-hint" className="text-[11px] text-neutral-400">
                {recipient.name ? `${recipient.name}, the ` : 'The '}primary contact for this
                workflow’s client group. Type another address and press Enter to add it.
              </span>
            ) : (
              /* Named rather than left blank: a group with no primary contact,
                 or one with no email on file, is an ordinary state and the
                 adviser should know why the field came up empty. */
              <span id="email-to-hint" className="text-[11px] text-amber-700">
                This workflow’s client group has no primary contact with an email on file, so
                there was nothing to prefill.
              </span>
            )}
          </div>

          <div className="flex flex-col gap-1.5">
            <label className={LABEL} htmlFor="email-subject">
              Subject
            </label>
            <input
              id="email-subject"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              className={INPUT}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <span className={LABEL}>Content</span>
            <MessageEditor size="tall" ariaLabel="Message" onReady={(e) => (editorRef.current = e)} />
          </div>
        </div>

        {/* The template picker sits at the BOTTOM RIGHT, beside Cancel and Send.
            It was in the header for part of 9 September, which put it opposite
            the title where it read as part of the dialog's identity rather than
            as something to choose. Down here it is what it is: one control on
            the row of controls, and the content box keeps the height it gained
            when the picker left the fields.

            Wrapping rather than shrinking. Derived, not measured — there is no
            browser pass over this yet: a 608px dialog leaves 566px inside the
            footer's padding, and the note, the picker, the rule and the two
            buttons want about 525px of it. So it fits with roughly 40px spare,
            and a refusal message longer than the note drops the controls to a
            second line rather than squeezing them. The footer is `shrink-0`,
            so it takes the extra height off the scrolling fields. */}
        <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-neutral-100 px-5 py-3">
          {problem ? (
            <p role="alert" className="mr-auto text-xs text-red-600">
              {problem}
            </p>
          ) : (
            <p className="mr-auto text-[11px] text-neutral-400">Send records; it does not deliver.</p>
          )}
          <div className="flex shrink-0 items-center gap-2">
            <label className={LABEL} htmlFor="email-template">
              Template
            </label>
            <select
              id="email-template"
              disabled
              aria-label="Template — not built yet"
              title="Not built yet"
              className="w-36 cursor-not-allowed rounded-md border border-dashed border-neutral-300 bg-white px-2 py-1 text-xs text-neutral-400"
            >
              <option>No templates yet</option>
            </select>
          </div>
          {/* A choice on the left of it, actions on the right. Without the rule
              the picker reads as a third button. */}
          <span aria-hidden="true" className="h-5 w-px shrink-0 bg-neutral-200" />
          <button
            type="button"
            onClick={() => dialogRef.current?.close()}
            className="rounded-md px-2.5 py-1.5 text-xs font-medium text-neutral-600 outline-none transition-colors hover:bg-neutral-100 hover:text-neutral-900 focus-visible:ring-2 focus-visible:ring-brand/30"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={send}
            disabled={sending}
            className="rounded-md bg-brand px-3 py-1.5 text-xs font-medium text-white outline-none transition-colors hover:bg-brand-600 disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-brand/40"
          >
            {sending ? 'Recording…' : 'Send'}
          </button>
        </div>
      </div>
    </dialog>
  )
}
