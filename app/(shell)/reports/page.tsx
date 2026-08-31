import { Card, PageHeading } from '@/components/ui'

export const metadata = { title: 'Reports · Q Wealth CRM' }

export default function ReportsPage() {
  return (
    <>
      <PageHeading
        eyebrow="Reports"
        title="Reports"
        description="Client, revenue and compliance reporting. Nothing here yet."
      />
      <Card className="col-span-full">
        <p className="text-sm text-neutral-500">
          Placeholder. Report definitions will land here once the client screens exist.
        </p>
      </Card>
    </>
  )
}
