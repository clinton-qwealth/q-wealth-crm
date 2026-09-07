'use client'

import { useActionState, useState, type ReactNode } from 'react'
import { saveWorkflowDetails, type NoteState } from '@/app/(shell)/groups/actions'
import { formatCalendarDate, formatNoteDate } from '@/lib/note-date'
import { PencilIcon } from './icons'

const INPUT =
  'w-full rounded-md border border-neutral-300 bg-white px-2.5 py-1.5 text-sm text-neutral-900 outline-none transition-colors placeholder:text-neutral-400 focus:border-brand-300 focus:ring-2 focus:ring-brand/15'

/**
 * The workflow's fields, as a boxed section with a pencil — the same object as
 * an editable section in the member record panel, and deliberately so: a
 * bordered card carrying its own title, a pencil at the right that turns the
 * section editable, Cancel and Save in the pencil's place while it is.
 *
 * The whole box is the form, so the header's Save submits it without reaching
 * across the tree; and **nothing submittable is rendered while reading**, which
 * keeps "reading a record cannot change it" true of the DOM rather than merely
 * of intent. Both of those are the member panel's rules, applied here.
 *
 * Three of the four fields are editable. **Date started is not**, because it is
 * `created_at` — a record of when the row was made, not a property of the work.
 * Editing it would be falsifying the record, so it renders as a value in both
 * modes and the absence of an input is the answer.
 */
export function WorkflowDetails({
  id,
  ownerStaffId,
  ownerName,
  createdAt,
  dueAt,
  description,
  staff,
}: {
  id: string
  ownerStaffId: string | null
  ownerName: string | null
  /** A timestamptz — an instant. Rendered in the reader's timezone. */
  createdAt: string
  /** A `date` — a calendar day. Rendered by splitting the string. */
  dueAt: string | null
  description: string | null
  staff: { id: string; name: string }[]
}) {
  const [editing, setEditing] = useState(false)
  const [state, action, pending] = useActionState<NoteState, FormData>(saveWorkflowDetails, null)

  /* A save closes the section back to its read-only form — the server has
     already revalidated the values behind it. Adjusted during render rather
     than in an effect, so the edit form never paints once more after a
     successful save. `handled` is the state already acted on, because
     useActionState hands back a new object on every submission. */
  const [handled, setHandled] = useState<NoteState>(null)
  if (state !== handled) {
    setHandled(state)
    if (state && 'ok' in state) setEditing(false)
  }
  const error = state && 'error' in state ? state.error : null

  return (
    <form action={action} className="rounded-lg border border-neutral-200 px-4 py-4">
      {/* Only while editing, for the same reason the fields are: a section being
          read carries nothing that a submit could send. */}
      {editing ? <input type="hidden" name="workflow_id" value={id} /> : null}

      <div className="flex items-center justify-between gap-3">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-neutral-500">Details</h2>
        {editing ? (
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setEditing(false)}
              className="rounded-md px-2 py-1 text-xs font-medium text-neutral-600 outline-none transition-colors hover:bg-neutral-100 hover:text-neutral-900 focus-visible:ring-2 focus-visible:ring-brand/30"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={pending}
              className="rounded-md bg-brand px-2.5 py-1 text-xs font-medium text-white outline-none transition-colors hover:bg-brand-600 disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-brand/40"
            >
              {pending ? 'Saving…' : 'Save'}
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setEditing(true)}
            aria-label="Edit details"
            title="Edit details"
            className="rounded-md p-1 text-neutral-400 outline-none transition-colors hover:bg-neutral-100 hover:text-neutral-700 focus-visible:ring-2 focus-visible:ring-brand/30"
          >
            <PencilIcon className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      <div className="mt-3.5">
        {editing ? (
          /* Stacked while editing, one field per row. Three inputs across this
             column would give each about 78px, and a date input cannot be read
             or used at that width. The read-only view keeps them in one row
             because a rendered date needs only its own text. */
          <div className="flex flex-col gap-3">
            <label className="flex flex-col gap-1">
              <span className="text-xs text-neutral-500">Owner</span>
              <select name="owner_staff_id" defaultValue={ownerStaffId ?? ''} className={INPUT}>
                <option value="">Unassigned</option>
                {staff.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
                {/* A stored owner the directory does not list — an inactive
                    staff member — stays selectable rather than being silently
                    reassigned to nobody by the next save. */}
                {ownerStaffId && !staff.some((s) => s.id === ownerStaffId) ? (
                  <option value={ownerStaffId}>{ownerName ?? 'Current owner'}</option>
                ) : null}
              </select>
            </label>

            <Readonly label="Date started" value={formatNoteDate(createdAt)} />

            <label className="flex flex-col gap-1">
              <span className="text-xs text-neutral-500">Due date</span>
              {/* type="date" so the browser hands back YYYY-MM-DD, which is what
                  a `date` column takes. Empty clears it. */}
              <input type="date" name="due_at" defaultValue={dueAt ?? ''} className={INPUT} />
            </label>

            <label className="flex flex-col gap-1">
              <span className="text-xs text-neutral-500">Description</span>
              <textarea
                name="description"
                rows={4}
                defaultValue={description ?? ''}
                placeholder="What this piece of work is."
                className={INPUT}
              />
            </label>
          </div>
        ) : (
          <>
            <dl className="grid grid-cols-3 gap-x-4 gap-y-4">
              <Field label="Owner" value={ownerName} />
              <Field label="Date started" value={formatNoteDate(createdAt)} />
              <Field label="Due date" value={dueAt ? formatCalendarDate(dueAt) : null} />
            </dl>
            <dl className="mt-4">
              <Field label="Description" value={description} wrap />
            </dl>
          </>
        )}
      </div>

      {error ? (
        <p role="alert" className="mt-3 text-sm text-red-600">
          {error}
        </p>
      ) : null}
    </form>
  )
}

/** A value shown in edit mode that cannot be edited. */
function Readonly({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span className="block text-xs text-neutral-500">{label}</span>
      <span className="mt-0.5 block text-sm text-neutral-900">{value}</span>
    </div>
  )
}

/**
 * One label-over-value field.
 *
 * An absent value is an em-dash, not a blank — the same rule as the group
 * page's profile card. A blank space is ambiguous: it could mean nothing was
 * recorded, or that the field failed to render.
 */
function Field({
  label,
  value,
  wrap = false,
}: {
  label: string
  value: string | null
  wrap?: boolean
}): ReactNode {
  return (
    <div className="min-w-0">
      <dt className="text-xs leading-snug text-neutral-500">{label}</dt>
      <dd
        className={`mt-0.5 text-sm text-neutral-900 ${wrap ? 'leading-relaxed' : 'truncate leading-snug'}`}
      >
        {value ?? <span className="text-neutral-400">—</span>}
      </dd>
    </div>
  )
}
