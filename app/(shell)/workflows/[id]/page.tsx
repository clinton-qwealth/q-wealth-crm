import { notFound, redirect } from 'next/navigation'
import { getCurrentStaff } from '@/lib/staff'
import { getWorkflow } from '@/lib/workflows'
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
  const workflow = await getWorkflow(id)
  if (!workflow) notFound()

  return <WorkflowWorkspace workflow={workflow} />
}
