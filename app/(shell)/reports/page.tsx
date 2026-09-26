import { RegisterHeader, ROOT_CRUMB } from '@/components/register-header'
import { Card } from '@/components/ui'

export const metadata = { title: 'Reports · Q Wealth CRM' }

export default function ReportsPage() {
  return (
    <>
      <div className="col-span-full">
        <RegisterHeader
          trail={[ROOT_CRUMB]}
          title="Reports"
          description="Client, revenue and compliance reporting. Nothing here yet."
        />
      </div>
      <Card className="col-span-full">
        <p className="text-sm text-neutral-500">
          Placeholder. Report definitions will land here once the client screens exist.
        </p>
      </Card>
    </>
  )
}
