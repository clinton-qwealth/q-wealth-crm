'use client'

import { saveWorkflowDetails } from '@/app/(shell)/groups/actions'
import { formatCalendarDate, formatNoteDate } from '@/lib/note-date'
import { EditField, Field, FieldBox, FIELD_INPUT, ReadonlyField } from './field-box'
import { InitialsTile } from './ui'

/**
 * The workflow's fields, as a boxed section with a pencil.
 *
 * The box itself is `FieldBox` — the shared shell, which is also what the task
 * panel's sections use. This component owns only what a workflow's fields are;
 * the border, the title, the pencil, Cancel and Save, the "nothing submittable
 * while reading" rule and the close-on-save behaviour all live in one place.
 *
 * Three of the five fields are editable. **Date started is not**, because it
 * is `created_at` — a record of when the row was made, not a property of the
 * work. **Nor is the client group**, added 15 September: `workflows.group_id`
 * is set when the work is created and `set_workflow_details()` does not accept
 * it, so moving a piece of work to a different client is not a detail
 * correction and must not travel on this save. Both render as values in either
 * mode, and the absence of an input is the answer.
 */
export function WorkflowDetails({
  id,
  ownerStaffId,
  ownerName,
  groupName,
  createdAt,
  dueAt,
  description,
  staff,
}: {
  id: string
  ownerStaffId: string | null
  ownerName: string | null
  /** Whose work this is. Read-only here — see the note above. */
  groupName: string
  /** A timestamptz — an instant. Rendered in the reader's timezone. */
  createdAt: string
  /** A `date` — a calendar day. Rendered by splitting the string. */
  dueAt: string | null
  description: string | null
  staff: { id: string; name: string }[]
}) {
  return (
    <FieldBox
      title="Details"
      /* h2: this box follows the page's one h1, the workflow's name. */
      as="h2"
      action={saveWorkflowDetails}
      identity={<input type="hidden" name="workflow_id" value={id} />}
      view={
        /* Owner on its own row, the two dates side by side beneath it, the
           description last. Three across was tried and measured: at this
           column's width a cell is 72–77px, and a 14px name only fits if it is
           short — "Sarah Chen" did, "Clinton Hatcher" (about 105px) never did.
           A date is always about 66px, so the pair share a row safely. Names
           vary; dates do not.

           "Unassigned", not an em-dash: it is the word the board's filter and
           this box's own picker use for the same state, and unowned work is a
           fact worth naming rather than a gap. The initials tile is the site's
           mark for a person, so the owner reads as who, not what.

           **The client group sits directly under the owner**, added
           15 September, and takes a full row for the same reason the owner
           does: two across gives a cell about 120px, and "Testsmith Household"
           does not fit that any more than "Clinton Hatcher" did.

           It is a SEPARATE labelled field rather than a second line under the
           owner's name, and that is what makes the pair readable: a staff
           member's name with a household's beneath it and no label between
           them reads as though the adviser belongs to the client. The labels
           keep "who is running this" and "whose work it is" apart — and the
           owner's was renamed from "Owner" to "Workflow owner" the same day
           for exactly that reason. Sentence case, like the three labels
           beside it. */
        <dl className="grid grid-cols-2 gap-x-4 gap-y-4">
          <Field
            label="Workflow owner"
            value={ownerName ?? 'Unassigned'}
            muted={!ownerName}
            span
            leading={
              ownerName ? (
                <span className="[&>span]:h-6 [&>span]:w-6 [&>span]:text-[10px]">
                  <InitialsTile name={ownerName} />
                </span>
              ) : undefined
            }
          />
          <Field label="Client group" value={groupName} span />
          <Field label="Date started" value={formatNoteDate(createdAt)} />
          <Field label="Due date" value={dueAt ? formatCalendarDate(dueAt) : null} />
          <Field label="Description" value={description} wrap span />
        </dl>
      }
      edit={
        /* Stacked while editing, one field per row. Three inputs across this
           column would give each about 78px, and a date input cannot be read or
           used at that width. The read-only view keeps them in one row because
           a rendered date needs only its own text. */
        <div className="flex flex-col gap-3">
          <EditField label="Workflow owner">
            <select name="owner_staff_id" defaultValue={ownerStaffId ?? ''} className={FIELD_INPUT}>
              <option value="">Unassigned</option>
              {staff.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
              {/* A stored owner the directory does not list — an inactive staff
                  member — stays selectable rather than being silently
                  reassigned to nobody by the next save. */}
              {ownerStaffId && !staff.some((s) => s.id === ownerStaffId) ? (
                <option value={ownerStaffId}>{ownerName ?? 'Current owner'}</option>
              ) : null}
            </select>
          </EditField>

          {/* Read-only in edit mode, like Date started: the group is not a
              detail of the work, it is which client the work is for, and
              `set_workflow_details()` does not accept it. Rendering it without
              an input is the honest answer — leaving it out entirely would make
              the box look like it holds fewer facts than it does. */}
          <ReadonlyField label="Client group" value={groupName} />

          <ReadonlyField label="Date started" value={formatNoteDate(createdAt)} />

          <EditField label="Due date">
            {/* type="date" so the browser hands back YYYY-MM-DD, which is what
                a `date` column takes. Empty clears it. */}
            <input type="date" name="due_at" defaultValue={dueAt ?? ''} className={FIELD_INPUT} />
          </EditField>

          <EditField label="Description">
            <textarea
              name="description"
              rows={4}
              defaultValue={description ?? ''}
              placeholder="What this piece of work is."
              className={FIELD_INPUT}
            />
          </EditField>
        </div>
      }
    />
  )
}
