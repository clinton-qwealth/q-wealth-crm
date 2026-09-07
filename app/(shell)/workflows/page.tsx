import { redirect } from 'next/navigation'
import { getCurrentStaff } from '@/lib/staff'
import { getGroupChoices, getWorkflowBoard } from '@/lib/workflows'
import { Card, PageHeading } from '@/components/ui'
import { KanbanBoard } from '@/components/kanban-board'
import { StartWorkflowModal } from '@/components/workflow-section'

export const metadata = { title: 'Workflows · Q Wealth CRM' }

/**
 * Every piece of work across every group the caller can see, as a board.
 *
 * Two fetches, one wave: the board and the group picker need nothing from each
 * other. Visibility is the database's — the view behind the board is
 * security_invoker, so an adviser sees the work for their groups and nobody
 * else's, exactly as on the group page.
 */
export default async function WorkflowsPage() {
  const staff = await getCurrentStaff()
  if (!staff) redirect('/login')

  const [{ cards, cancelled }, groups] = await Promise.all([getWorkflowBoard(), getGroupChoices()])

  return (
    <>
      <PageHeading
        eyebrow="Workflows"
        title="Workflows"
        description="Every piece of work under way, across every group you can see. Drag a card to move it along."
        actions={<StartWorkflowModal groups={groups} />}
      />
      <Card className="col-span-full">
        <KanbanBoard cards={cards} cancelled={cancelled} />
      </Card>
    </>
  )
}
