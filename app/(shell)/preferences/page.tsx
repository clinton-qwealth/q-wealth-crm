import { RegisterHeader, ROOT_CRUMB } from '@/components/register-header'
import { Card } from '@/components/ui'

export const metadata = { title: 'Preferences · Q Wealth CRM' }

export default function PreferencesPage() {
  return (
    <>
      <div className="col-span-full">
        <RegisterHeader
          trail={[ROOT_CRUMB, { label: 'Account' }]}
          title="Preferences"
          description="How the CRM behaves for you. Nothing here yet."
        />
      </div>
      <Card className="col-span-full lg:col-span-8">
        <div className="flex h-40 items-center justify-center rounded-md border border-dashed border-neutral-200 bg-neutral-50/60">
          <p className="text-sm text-neutral-400">
            Display, notification and default-view settings go here
          </p>
        </div>
      </Card>
    </>
  )
}
