import type { ReactNode } from 'react'
import type { EntityChoice, TaskAction, WorkflowDetail, WorkflowPost, WorkflowTask } from '@/lib/workflow-board'
import type { NoteHeader } from '@/lib/notes'
import { Card } from './ui'
import { Tabs } from './tabs'
import { WorkflowState } from './workflow-state'
import { WorkflowDetails } from './workflow-details'
import { WorkflowTasks } from './workflow-tasks'
import { WorkflowNotes } from './workflow-notes'
import { AddNoteModal } from './add-note-modal'

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
  actions,
  recipient,
  notes,
  entities,
  viewer,
}: {
  workflow: WorkflowDetail
  /** Active staff, for the owner and assignee pickers and the @ menu. Empty in a preview. */
  staff: { id: string; name: string }[]
  tasks: WorkflowTask[]
  /** Every post on the workflow, newest first. */
  posts: WorkflowPost[]
  /** Every recorded action on the workflow, newest first. */
  actions: TaskAction[]
  /** Who an email from this workflow prefills to, or null when nobody is on file. */
  recipient: { email: string; name: string | null } | null
  /** The file notes filed under this workflow, newest first. */
  notes: NoteHeader[]
  /** What `#` may name: this workflow's group, its members, its sibling workflows. */
  entities?: EntityChoice[]
  /** The signed-in staff member — the author of anything posted from here. */
  viewer: { id: string; name: string; email: string; canRemoveAnyImage: boolean }
}) {
  /**
   * Add file note, from the workflow's own page.
   *
   * **The workflow is the only option the select offers, and it is
   * pre-selected.** A note added from this tab that was not filed under this
   * workflow would save and then not appear in the list it was added from,
   * which reads as a broken button. Offering the group's OTHER workflows here
   * would mean a second query for a choice nobody makes on this screen — you
   * are on this workflow's page — so the list is this one plus "Not part of a
   * workflow", which is the opt-out and is worth keeping.
   *
   * `WorkflowDetail` already carries everything a `WorkflowOption` needs, so
   * this costs nothing.
   *
   * **Not offered on finished work, and that is the point of the guard.** A
   * complete or cancelled workflow cannot take a new note — filing one would
   * quietly reopen closed work, which the modal already refuses by filtering it
   * out of the select. But refusing it there just means the note is filed under
   * NOTHING and never appears in the list it was added from. So the button goes
   * instead of misleading: no control is better than one that saves something
   * and then does not show it.
   */
  const takesNotes = w.status !== 'complete' && w.status !== 'cancelled'
  const addNote = (variant: 'quiet' | 'primary') =>
    takesNotes ? (
      <AddNoteModal
        groupId={w.group_id}
        workflows={[
          { id: w.id, name: w.name, workflow_type: w.workflow_type, status: w.status },
        ]}
        defaultWorkflowId={w.id}
        triggerVariant={variant}
      />
    ) : undefined

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
          workflowName={w.name}
          groupName={w.group_name}
          tasks={tasks}
          posts={posts}
          actions={actions}
          recipient={recipient}
          staff={staff}
          entities={entities}
          viewer={viewer}
        />
      </Column>

      {/* Right — the record's own history, in tabs.

          Two of them to begin with, and the strip is what makes this column a
          place things can be added to rather than one thing with a heading. It
          replaced a single dashed placeholder that had said "file notes filed
          under this workflow go here" since 7 September; the data had been
          there the whole time, on `notes.workflow_id`.

          `gutter={6}` because these columns are `Card padding="roomy"` — 24px,
          where the group page's centre card is 16px. The strip cancels its
          container's padding with a negative margin to cap the card, so the
          step has to match or the hairline stops short of the edges. That
          option was added to `Tabs` for this, rather than making this one
          instance sit inset while every other strip on the site caps its
          card. */}
      <Column span={4}>
        <Tabs
          ground
          gutter={6}
          label="Workflow record"
          items={[
            {
              id: 'notes',
              label: 'File Notes',
              panel: (
                <WorkflowNotes
                  notes={notes}
                  action={addNote('quiet')}
                  emptyAction={addNote('primary')}
                />
              ),
            },
            {
              id: 'history',
              label: 'Activity History',
              /* Named, not guessed. What belongs here is being decided; a
                 dashed blank that says so beats inventing a timeline and
                 dressing the guess up as a feature — the same treatment the
                 Tools tab's unbuilt tiles and the group page's blank beside
                 the workflow cards take. */
              panel: (
                <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-neutral-200 bg-neutral-50/60 px-6 py-10 text-center">
                  <p className="text-sm font-medium text-neutral-700">
                    Activity history is not built yet
                  </p>
                  <p className="mt-1 max-w-xs text-xs leading-relaxed text-neutral-500">
                    What this shows is still being decided. The workflow’s posts and its
                    recorded actions both exist and both carry their workflow, so the data is
                    already there.
                  </p>
                </div>
              ),
            },
          ]}
        />
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
