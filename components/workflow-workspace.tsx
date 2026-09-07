import type { ReactNode } from 'react'
import type { BoardCard } from '@/lib/workflow-board'
import { PRIORITIES, WORKFLOW_STATUS_LABEL, WORKFLOW_TYPE_LABEL } from '@/lib/workflow-board'
import type { WorkflowStatus } from '@/lib/notes'
import { Card, PageHeading, Pill, Placeholder, type PillTone } from './ui'
import { PriorityGlyph } from './priority-picker'
import { formatNoteDate } from '@/lib/note-date'

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

/**
 * The workflow detail page's body: the same three columns as the group page —
 * 3 / 6 / 3 of twelve at `lg`, one column below — so a workflow is worked on in
 * the same frame a group is.
 *
 * Started 7 September 2026 as placeholders. Each column says in words what is
 * going to live in it, and nothing more, so the frame can be judged before
 * anything is built into it. The one real thing on the page is the header:
 * the name, the group it is for, its kind, status and priority, and its owner.
 *
 * Rendered by the page after the staff check and the fetch, and by a preview
 * with fixture data — which is why it takes a card and not an id.
 */
export function WorkflowWorkspace({ workflow: w }: { workflow: BoardCard }) {
  const priority = PRIORITIES.find((p) => p.id === w.priority)!
  const when =
    w.status === 'complete' && w.completed_at
      ? `Completed ${formatNoteDate(w.completed_at)}`
      : w.started_at
        ? `Started ${formatNoteDate(w.started_at)}`
        : 'Not started yet'

  return (
    <>
      <PageHeading
        eyebrow="Workflow"
        title={w.name}
        meta={
          <>
            <Pill tone="neutral">{WORKFLOW_TYPE_LABEL[w.workflow_type]}</Pill>
            <Pill tone={STATUS_TONE[w.status]}>{WORKFLOW_STATUS_LABEL[w.status]}</Pill>
            {/* Glyph and word together: the glyph is how priority reads on a
                card, the word is what it means. Neither alone is enough here. */}
            <span className="inline-flex items-center gap-1 text-xs text-neutral-600">
              <PriorityGlyph priority={w.priority} className="h-3.5 w-3.5" />
              {priority.label}
            </span>
          </>
        }
        description={[w.group_name, w.owner_name ? `Owner ${w.owner_name}` : 'No owner', when].join(' · ')}
      />

      {/* Left — what the workflow is */}
      <Column span={3} title="Workflow profile">
        <Placeholder className="h-64">
          Kind, status, priority, owner and dates go here, alongside a link to the group.
        </Placeholder>
      </Column>

      {/* Centre — the work itself */}
      <Column span={6}>
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
 * One of the three columns: the same grid classes the group page uses inline,
 * named once here so the two pages cannot drift apart by a span.
 */
function Column({ span, title, children }: { span: 3 | 6; title?: string; children: ReactNode }) {
  return (
    <div className={`col-span-full flex flex-col gap-4 ${span === 3 ? 'lg:col-span-3' : 'lg:col-span-6'}`}>
      <Card>
        {title ? (
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-neutral-500">{title}</h2>
        ) : null}
        {children}
      </Card>
    </div>
  )
}
