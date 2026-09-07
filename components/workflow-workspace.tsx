import type { ReactNode } from 'react'
import type { WorkflowDetail } from '@/lib/workflow-board'
import { Card, Placeholder } from './ui'
import { WorkflowState } from './workflow-state'
import { WorkflowDetails } from './workflow-details'

const SPAN: Record<3 | 6, string> = {
  3: 'lg:col-span-3',
  6: 'lg:col-span-6',
}

/**
 * The workflow detail page's body: three columns, **3 / 6 / 3** of twelve at
 * `lg`, one column below.
 *
 * The same spans as the group page. They were briefly 4 / 5 / 3 — the left
 * column was widened by one step when the page's header moved into it — and
 * moved back once the fields went into a boxed section, which reads as a
 * contained object at any width where the group page's profile card does.
 *
 * Rendered by the page after the staff check and the fetch, and by a preview
 * with fixture data — which is why it takes a record and not an id.
 */
export function WorkflowWorkspace({
  workflow: w,
  staff,
}: {
  workflow: WorkflowDetail
  /** Active staff, for the owner picker. Empty in a preview. */
  staff: { id: string; name: string }[]
}) {
  return (
    <>
      {/* Left — what the workflow is, headed by its name.

          There is no PageHeading on this page. The eyebrow, 24px h1 and marks
          are PageHeading's own treatment reproduced inside the card, so the
          workflow's name still reads as a page title — the standing rule that
          the largest type on a page is its title, at the same size on every
          screen — while sitting with the record it names. */}
      <Column span={3}>
        <p className="text-[11px] font-semibold uppercase tracking-widest text-brand">Workflow</p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight text-neutral-900">{w.name}</h1>

        {/* The marks and the progress bar, together and editable — they share a
            status, so they share a component. See WorkflowState. */}
        <WorkflowState
          id={w.id}
          name={w.name}
          workflowType={w.workflow_type}
          status={w.status}
          priority={w.priority}
        />

        {/* A rule, not just space. Above it the card is about where the work
            stands — a state anyone can change in two clicks. Below it are the
            recorded facts of the piece of work, behind a pencil. Two different
            kinds of thing, so there is a line between them. */}
        <hr className="my-6 border-t border-neutral-200" />

        <WorkflowDetails
          id={w.id}
          ownerStaffId={w.owner_staff_id}
          ownerName={w.owner_name}
          createdAt={w.created_at}
          dueAt={w.due_at}
          description={w.description}
          staff={staff}
        />
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

/** One of the three columns, so a span is written once rather than per column. */
function Column({ span, children }: { span: 3 | 6; children: ReactNode }) {
  return (
    <div className={`col-span-full flex flex-col gap-4 ${SPAN[span]}`}>
      <Card>{children}</Card>
    </div>
  )
}
