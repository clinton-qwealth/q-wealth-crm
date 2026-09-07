import type { ReactNode } from 'react'
import type { BoardCard } from '@/lib/workflow-board'
import { PRIORITIES, WORKFLOW_STATUS_LABEL, WORKFLOW_TYPE_LABEL } from '@/lib/workflow-board'
import type { WorkflowStatus } from '@/lib/notes'
import { Card, Pill, Placeholder, type PillTone } from './ui'
import { PriorityGlyph } from './priority-picker'

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
 * column carries a title rather than a field list and needs the room. The
 * width came out of the centre; the right column still lines up with the group
 * page's third column.
 *
 * Started 7 September 2026 as placeholders. Each column says in words what is
 * going to live in it, so the frame can be judged before anything is built
 * into it.
 *
 * Rendered by the page after the staff check and the fetch, and by a preview
 * with fixture data — which is why it takes a card and not an id.
 */
export function WorkflowWorkspace({ workflow: w }: { workflow: BoardCard }) {
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
        {/* The group, the owner and the dates came off the page with the header
            band. They are named here rather than kept in a stray line, because
            this card is where they are going. */}
        <Placeholder className="mt-4 h-56">
          The client group, the owner and the dates go here, with a link through to the group.
        </Placeholder>
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

/** One of the three columns, so a span is written once rather than per column. */
function Column({ span, children }: { span: 3 | 4 | 5; children: ReactNode }) {
  return (
    <div className={`col-span-full flex flex-col gap-4 ${SPAN[span]}`}>
      <Card>{children}</Card>
    </div>
  )
}
