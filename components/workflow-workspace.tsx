import type { ReactNode } from 'react'
import type { WorkflowDetail, WorkflowPost, WorkflowTask } from '@/lib/workflow-board'
import { Card, Placeholder } from './ui'
import { WorkflowState } from './workflow-state'
import { WorkflowDetails } from './workflow-details'
import { WorkflowTasks } from './workflow-tasks'

const SPAN: Record<3 | 4 | 5, string> = {
  3: 'lg:col-span-3',
  4: 'lg:col-span-4',
  5: 'lg:col-span-5',
}

/**
 * The workflow detail page's body: three columns, **3 / 5 / 4** of twelve at
 * `lg`, one column below.
 *
 * The right column was widened by one step on 8 September and the centre gave
 * up the point, which is the second half of the same question the task list's
 * width raised: the centre measured comfortable but slightly loose at 6, and
 * the right column has file notes coming to it. So the page no longer matches
 * the group page's 3 / 6 / 3 — a deliberate divergence, because this page's
 * right column is a record's notes and the group page's centre is a tabbed
 * working area.
 *
 * The left column has been 3 throughout except for part of one day at 4, when
 * the page's header moved into it; it moved back once the fields went into a
 * boxed section, which reads as a contained object at the width the group
 * page's profile card does.
 *
 * Rendered by the page after the staff check and the fetch, and by a preview
 * with fixture data — which is why it takes a record and not an id.
 */
export function WorkflowWorkspace({
  workflow: w,
  staff,
  tasks,
  posts,
  viewer,
}: {
  workflow: WorkflowDetail
  /** Active staff, for the owner and assignee pickers and the @ menu. Empty in a preview. */
  staff: { id: string; name: string }[]
  tasks: WorkflowTask[]
  /** Every post on the workflow, newest first. */
  posts: WorkflowPost[]
  /** The signed-in staff member — the author of anything posted from here. */
  viewer: { id: string; name: string }
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

      {/* Centre — the work itself: the tasks under this workflow */}
      <Column span={5}>
        <WorkflowTasks
          workflowId={w.id}
          groupName={w.group_name}
          tasks={tasks}
          posts={posts}
          staff={staff}
          viewer={viewer}
        />
      </Column>

      {/* Right — the notes filed under it */}
      <Column span={4}>
        <Placeholder className="h-64">File notes filed under this workflow go here.</Placeholder>
      </Column>
    </>
  )
}

/**
 * One of the three columns, so a span is written once rather than per column.
 *
 * All three cards take the roomy 24px padding, not only the left one that
 * asked for it: three cards in a row with two gutters read as a mistake, and
 * the other two will be built into the same frame.
 */
function Column({ span, children }: { span: 3 | 4 | 5; children: ReactNode }) {
  return (
    <div className={`col-span-full flex flex-col gap-4 ${SPAN[span]}`}>
      <Card padding="roomy">{children}</Card>
    </div>
  )
}
