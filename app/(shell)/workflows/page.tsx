import { Card, PageHeading } from '@/components/ui'

export const metadata = { title: 'Workflows · Q Wealth CRM' }

export default function WorkflowsPage() {
  return (
    <>
      <PageHeading
        eyebrow="Workflows"
        title="Workflows"
        description="Repeatable processes — onboarding, reviews, advice production. Nothing here yet."
      />
      <Card className="col-span-full lg:col-span-8">
        <div className="flex h-56 items-center justify-center rounded-md border border-dashed border-neutral-200 bg-neutral-50/60">
          <p className="text-sm text-neutral-400">Workflow definitions and progress go here</p>
        </div>
      </Card>
    </>
  )
}
