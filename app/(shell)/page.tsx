import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getCurrentStaff } from '@/lib/staff'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { Card, PageHeading, StatTile } from '@/components/ui'

export const metadata = { title: 'Home · Q Wealth CRM' }

/**
 * Counts for the tiles. Every one is RLS-scoped, so an adviser sees their book
 * and Services sees everything — the numbers differ by who is looking, which is
 * the point. `head: true` fetches the count without the rows.
 */
async function getCounts() {
  const supabase = await createSupabaseServerClient({ writable: false })

  const countOf = async (table: string) => {
    const { count, error } = await supabase.from(table).select('*', { count: 'exact', head: true })
    return error ? null : (count ?? 0)
  }

  const [clients, groups, notes, unmatched] = await Promise.all([
    countOf('clients'),
    countOf('group_summary'),
    countOf('notes'),
    (async () => {
      const { count, error } = await supabase
        .from('notes')
        .select('*', { count: 'exact', head: true })
        .eq('match_status', 'unmatched')
      return error ? null : (count ?? 0)
    })(),
  ])

  return { clients, groups, notes, unmatched }
}

export default async function Home() {
  const staff = await getCurrentStaff()
  if (!staff) redirect('/login')

  const counts = await getCounts()
  const p = staff.access_profiles
  const n = (v: number | null) => (v === null ? '—' : String(v))

  return (
    <>
      <PageHeading
        eyebrow="Q Intelligence"
        title={`Good to see you, ${staff.full_name.split(' ')[0]}`}
        description="A good day to make progress — everything you need is right here."
      />

      <StatTile
        className="col-span-2 sm:col-span-2 lg:col-span-3"
        label="Clients"
        value={n(counts.clients)}
        hint="Visible to you"
      />
      <StatTile
        className="col-span-2 sm:col-span-2 lg:col-span-3"
        label="Client groups"
        value={n(counts.groups)}
        hint="Households and entities"
      />
      <StatTile
        className="col-span-2 sm:col-span-2 lg:col-span-3"
        label="File notes"
        value={n(counts.notes)}
        hint="Append-only record"
      />
      <StatTile
        className="col-span-2 sm:col-span-2 lg:col-span-3"
        label="Awaiting filing"
        value={n(counts.unmatched)}
        hint={p.file_unmatched_notes ? 'You can file these' : 'Your hosted meetings only'}
      />

      <Card
        className="col-span-full lg:col-span-8"
        title="Your book"
        action={
          <Link href="/reports" className="text-xs font-medium text-brand hover:text-brand-700">
            Reports
          </Link>
        }
      >
        <div className="flex h-56 items-center justify-center rounded-md border border-dashed border-neutral-200 bg-neutral-50/60">
          <p className="text-sm text-neutral-400">Client list and filters go here</p>
        </div>
      </Card>

      <Card className="col-span-full lg:col-span-4" title="Recent activity">
        <div className="flex h-56 items-center justify-center rounded-md border border-dashed border-neutral-200 bg-neutral-50/60">
          <p className="text-sm text-neutral-400">Latest notes and meetings</p>
        </div>
      </Card>
    </>
  )
}
