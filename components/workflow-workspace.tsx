import type { ReactNode } from 'react'
import type { WorkflowDetail } from '@/lib/workflow-board'
import {
  PRIORITIES,
  WORKFLOW_STATUS_LABEL,
  WORKFLOW_TYPE_LABEL,
  workflowProgress,
} from '@/lib/workflow-board'
import type { WorkflowStatus } from '@/lib/notes'
import { Card, Pill, Placeholder, type PillTone } from './ui'
import { PriorityGlyph } from './priority-picker'
import { formatCalendarDate, formatNoteDate } from '@/lib/note-date'

/* Blocked is the one worth noticing, so it is the one that gets amber; under
   review takes the brand tone; finished and unstarted work stay neutral. The
   same mapping the group ledger used before it became cards. */
const STATUS_TONE: Record<WorkflowStatus, PillTone> = {
  not_started: 'neutral',
  in_progress: 'success',
  blocked: 'warning',
  under_review: 'brand',
  complete: 'neutral',
  cancelled: 'neutral',
}

const SPAN: Record<3 | 4 | 5, string> = {
  3: 'lg:col-span-3',
  4: 'lg:col-span-4',
  5: 'lg:col-span-5',
}

/**
 * The workflow detail page's body: three columns, **4 / 5 / 3** of twelve at
 * `lg`, one column below.
 *
 * It began on the group page's 3 / 6 / 3 and moved off it deliberately. This
 * page has no header band of its own — the workflow's name and marks live in
 * the left card, which is the column that describes the record — so the left
 * column carries a title, a field row, a description and a progress bar, and
 * needs the room. The width came out of the centre; the right column still
 * lines up with the group page's third column.
 *
 * Rendered by the page after the staff check and the fetch, and by a preview
 * with fixture data — which is why it takes a record and not an id.
 */
export function WorkflowWorkspace({ workflow: w }: { workflow: WorkflowDetail }) {
  const priority = PRIORITIES.find((p) => p.id === w.priority)!

  return (
    <>
      {/* Left — what the workflow is, headed by its name.

          There is no PageHeading on this page. The eyebrow, 24px h1 and marks
          are PageHeading's own treatment reproduced inside the card, so the
          workflow's name still reads as a page title — the standing rule that
          the largest type on a page is its title, at the same size on every
          screen — while sitting with the record it names. */}
      <Column span={4}>
        <p className="text-[11px] font-semibold uppercase tracking-widest text-brand">Workflow</p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight text-neutral-900">{w.name}</h1>
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <Pill tone="neutral">{WORKFLOW_TYPE_LABEL[w.workflow_type]}</Pill>
          <Pill tone={STATUS_TONE[w.status]}>{WORKFLOW_STATUS_LABEL[w.status]}</Pill>
          {/* Glyph and word together: the glyph is how priority reads on a
              card, the word is what it means. Neither alone is enough here. */}
          <span className="inline-flex items-center gap-1 text-xs text-neutral-600">
            <PriorityGlyph priority={w.priority} className="h-3.5 w-3.5" />
            {priority.label}
          </span>
        </div>

        {/* Three fields across one row, label stacked over value — the same
            treatment as the group page's profile card, so the two read as the
            same kind of thing.

            The two dates are formatted by OPPOSITE rules, side by side in one
            row, which is exactly why both live in one module. created_at is a
            timestamptz — an instant — so it converts to the reader's timezone.
            due_at is a `date`: a day, not a moment, so it is split from the
            string and never put through `new Date()`, which would render the
            day before anywhere west of Greenwich. See lib/note-date.ts. */}
        <dl className="mt-5 grid grid-cols-3 gap-x-4 gap-y-4">
          <Field label="Owner" value={w.owner_name} />
          <Field label="Date started" value={formatNoteDate(w.created_at)} />
          <Field label="Due date" value={w.due_at ? formatCalendarDate(w.due_at) : null} />
        </dl>

        <dl className="mt-4">
          <Field label="Description" value={w.description} wrap />
        </dl>

        <Progress status={w.status} />
      </Column>

      {/* Centre — the work itself */}
      <Column span={5}>
        <Placeholder className="h-96">
          The working area. Steps and activity for this workflow go here, in tabs like the
          group page.
        </Placeholder>
      </Column>

      {/* Right — the notes filed under it */}
      <Column span={3}>
        <Placeholder className="h-64">File notes filed under this workflow go here.</Placeholder>
      </Column>
    </>
  )
}

/**
 * How far the work has come, as a green bar the width of the card.
 *
 * The status is above it as a pill already, and it is repeated here as the
 * bar's left-hand label on purpose: an unlabelled bar makes the reader work out
 * what the percentage is a percentage OF. The figure sits at the right, so the
 * two ends of the row answer "where is this up to" and "how far is that".
 *
 * The percentage is derived from the status, not stored — see workflowProgress.
 * Cancelled work shows an em-dash rather than a figure, because how far it got
 * was never recorded and 0% would be a claim.
 *
 * role="progressbar" with aria-valuetext, so a screen reader hears "In
 * progress, 33% complete" rather than a bare number — and hears "Cancelled"
 * where there is no number to hear.
 */
function Progress({ status }: { status: WorkflowStatus }) {
  const { percent, label } = workflowProgress(status)
  return (
    <div className="mt-5">
      <div className="mb-1.5 flex items-baseline justify-between gap-3">
        <span className="text-xs font-medium text-neutral-700">{label}</span>
        <span className="text-xs font-semibold tabular-nums text-neutral-900">
          {percent === null ? '—' : `${percent}%`}
        </span>
      </div>
      {/* emerald-600 on a 70% neutral-200 track measures 3.2:1 — a bar is a
          non-text graphic, so its fill has to clear 3:1 against the track it
          sits in or the "how far" is invisible to some readers. emerald-500,
          the brighter first choice, measured 2.0:1 and was rejected. */}
      <div
        role="progressbar"
        aria-label="Progress"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent ?? undefined}
        aria-valuetext={percent === null ? label : `${label}, ${percent}% complete`}
        className="h-1.5 w-full overflow-hidden rounded-full bg-neutral-200/70"
      >
        <div
          className={`h-full rounded-full ${percent === null ? 'bg-neutral-300' : 'bg-emerald-600'}`}
          style={{ width: `${percent ?? 0}%` }}
        />
      </div>
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
function Field({ label, value, wrap = false }: { label: string; value: string | null; wrap?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs leading-snug text-neutral-500">{label}</dt>
      <dd
        className={`mt-0.5 text-sm leading-snug text-neutral-900 ${
          wrap ? 'leading-relaxed' : 'truncate'
        }`}
      >
        {value ?? <span className="text-neutral-400">—</span>}
      </dd>
    </div>
  )
}

/** One of the three columns, so a span is written once rather than per column. */
function Column({ span, children }: { span: 3 | 4 | 5; children: ReactNode }) {
  return (
    <div className={`col-span-full flex flex-col gap-4 ${SPAN[span]}`}>
      <Card>{children}</Card>
    </div>
  )
}
