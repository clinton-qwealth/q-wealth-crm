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
      {/* The board fills the window even when it is nearly empty: a board that
          ends where its last card ends looks like a list. min-height is the
          viewport less everything above and below the card — nav (3rem),
          main's padding (1.75rem top and bottom at lg), the heading block
          (4.875rem with a one-line description) and the grid gap (1.5rem) —
          so the card's bottom edge lands on the page's bottom padding rather
          than at an arbitrary 90vh. Measured: bottom edge 28px above the
          window at 760, 900 and 1200px tall, no scrollbar. If the description
          ever wraps to two lines the card runs ~20px long, which is harmless. */}
      <Card className="col-span-full flex min-h-[calc(100dvh-12.875rem)] flex-col">
        <KanbanBoard cards={cards} cancelled={cancelled} />
      </Card>
    </>
  )
}
