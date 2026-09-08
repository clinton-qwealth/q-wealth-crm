import { notFound, redirect } from 'next/navigation'
import { getCurrentStaff } from '@/lib/staff'
import { getStaffChoices, getWorkflow, getWorkflowPosts, getWorkflowTasks } from '@/lib/workflows'
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
  /* One wave: the row, the staff list, the tasks and the posts need nothing
     from each other, so asking for them together costs one round trip rather
     than four. */
  const [workflow, staffChoices, tasks, posts] = await Promise.all([
    getWorkflow(id),
    getStaffChoices(),
    getWorkflowTasks(id),
    getWorkflowPosts(id),
  ])
  if (!workflow) notFound()

  return (
    <WorkflowWorkspace
      workflow={workflow}
      staff={staffChoices}
      tasks={tasks}
      posts={posts}
      /* `manage_staff` is what current_staff_has('admin') reads, so this is
         the same question the database asks when it decides who may take an
         image off somebody else's post. Sent down so the feed offers the
         control only where it would succeed. */
      viewer={{
        id: staff.id,
        name: staff.full_name,
        canRemoveAnyImage: staff.access_profiles.manage_staff,
      }}
    />
  )
}
