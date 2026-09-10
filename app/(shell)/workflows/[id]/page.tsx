import { notFound, redirect } from 'next/navigation'
import { getCurrentStaff } from '@/lib/staff'
import {
  getStaffChoices,
  getWorkflow,
  getWorkflowEntityChoices,
  getWorkflowPosts,
  getWorkflowRecipient,
  getWorkflowTaskActions,
  getWorkflowTasks,
} from '@/lib/workflows'
import { getWorkflowNotes } from '@/lib/notes'
import { WorkflowWorkspace } from '@/components/workflow-workspace'

export const metadata = { title: 'Workflow · Q Wealth CRM' }

/**
 * One workflow, in the group page's three-column frame.
 *
 * Reached from a card's name on the board or on a group's Workflows tab. The
 * row comes through the security_invoker board view, so a workflow the caller
 * may not see is a 404 — the same answer as one that does not exist, on
 * purpose: an adviser should not be able to tell the two apart.
 */
export default async function WorkflowPage({ params }: { params: Promise<{ id: string }> }) {
  const staff = await getCurrentStaff()
  if (!staff) redirect('/login')

  const { id } = await params
  /* One wave: the row, the staff list, the tasks, the posts, the recorded
     actions and now the file notes need nothing from each other, so asking for
     them together costs one round trip rather than eight. The recipient lookup
     is the one that is not a single query — workflow, then group, then contact
     points — but it still joins this wave rather than adding one of its own.

     The notes join it for the same reason, which is also why they are fetched
     by WORKFLOW rather than by group: filtering on the group would mean knowing
     the workflow's group first, and the workflow row is in this same wave. See
     getWorkflowNotes for what that costs instead. */
  const [workflow, staffChoices, tasks, posts, entityChoices, actions, recipient, notes] =
    await Promise.all([
      getWorkflow(id),
      getStaffChoices(),
      getWorkflowTasks(id),
      getWorkflowPosts(id),
      getWorkflowEntityChoices(id),
      getWorkflowTaskActions(id),
      getWorkflowRecipient(id),
      getWorkflowNotes(id),
    ])
  if (!workflow) notFound()

  return (
    <WorkflowWorkspace
      workflow={workflow}
      staff={staffChoices}
      tasks={tasks}
      posts={posts}
      actions={actions}
      recipient={recipient}
      notes={notes}
      entities={entityChoices}
      /* `manage_staff` is what current_staff_has('admin') reads, so this is
         the same question the database asks when it decides who may take an
         image off somebody else's post. Sent down so the feed offers the
         control only where it would succeed. */
      viewer={{
        id: staff.id,
        name: staff.full_name,
        /* The address an email is sent FROM. Their own profile email, never
           typed: an email that could claim to come from a colleague is what
           the rest of this app refuses by construction. */
        email: staff.email,
        canRemoveAnyImage: staff.access_profiles.manage_staff,
      }}
    />
  )
}
