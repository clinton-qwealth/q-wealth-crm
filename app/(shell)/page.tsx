import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getCurrentStaff } from '@/lib/staff'
import { getMfaState } from '@/lib/mfa'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { signOut } from '@/app/actions'
import { Card, PageHeading, Pill, StatTile } from '@/components/ui'

export const metadata = { title: 'Home · Q Wealth CRM' }

/**
 * Counts for the tiles. Every one is RLS-scoped, so an adviser sees their book
 * and Services sees everything — the numbers differ by who is looking, which is
 * the point. `head: true` fetches the count without the rows.
 */
async function getCounts() {
  const supabase = await createSupabaseServerClient({ writable: false })
  const count = async (table: string, apply?: (q: never) => never) => {
    let q = supabase.from(table).select('*', { count: 'exact', head: true })
    if (apply) q = apply(q as never)
    const { count: n, error } = await q
    return error ? null : (n ?? 0)
  }

  const [clients, groups, notes, unmatched] = await Promise.all([
    count('clients'),
    count('group_summary'),
    count('notes'),
    (async () => {
      const { count: n, error } = await supabase
        .from('notes')
        .select('*', { count: 'exact', head: true })
        .eq('match_status', 'unmatched')
      return error ? null : (n ?? 0)
    })(),
  ])

  return { clients, groups, notes, unmatched }
}

export default async function Home() {
  const staff = await getCurrentStaff()
  if (!staff) redirect('/login')

  const mfa = await getMfaState()
  if (mfa.stepUpRequired) redirect('/mfa?next=%2F')

  const counts = await getCounts()
  const p = staff.access_profiles
  const n = (v: number | null) => (v === null ? '—' : String(v))

  const permissions: [string, boolean][] = [
    ['See all client groups', p.view_all_groups],
    ['Reveal sensitive fields', p.view_sensitive],
    ['Manage groups', p.manage_groups],
    ['Manage staff', p.manage_staff],
    ['File unmatched notes', p.file_unmatched_notes],
  ]

  return (
    <>
      <PageHeading
        eyebrow={p.name}
        title={`Good to see you, ${staff.full_name.split(' ')[0]}`}
        description="Wireframe. The layout and navigation are real; the panels below are placeholders around live counts."
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
          <Link
            href="/reports"
            className="text-xs font-medium text-brand hover:text-brand-700"
          >
            Reports
          </Link>
        }
      >
        <div className="flex h-40 items-center justify-center rounded-md border border-dashed border-neutral-200 bg-neutral-50/60">
          <p className="text-sm text-neutral-400">Client list and filters go here</p>
        </div>
      </Card>

      <Card className="col-span-full lg:col-span-4" title="Recent activity">
        <div className="flex h-40 items-center justify-center rounded-md border border-dashed border-neutral-200 bg-neutral-50/60">
          <p className="text-sm text-neutral-400">Latest notes and meetings</p>
        </div>
      </Card>

      <Card className="col-span-full sm:col-span-4 lg:col-span-6" title="Your access">
        <ul className="divide-y divide-neutral-100">
          {permissions.map(([label, allowed]) => (
            <li key={label} className="flex items-center justify-between gap-4 py-2">
              <span className="text-sm text-neutral-700">{label}</span>
              <Pill on={allowed}>{allowed ? 'Yes' : 'No'}</Pill>
            </li>
          ))}
        </ul>
        <p className="mt-3 text-xs leading-relaxed text-neutral-400">
          Set by your access profile and enforced in the database, not in this page.
        </p>
      </Card>

      <Card className="col-span-full sm:col-span-4 lg:col-span-6" title="Security">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-sm text-neutral-700">Two-factor authentication</p>
            <p className="mt-0.5 text-xs text-neutral-400">
              {mfa.enrolled
                ? 'Your account is protected by an authenticator app.'
                : 'Required before you can reveal sensitive fields.'}
            </p>
          </div>
          <Pill on={mfa.enrolled}>{mfa.enrolled ? 'On' : 'Off'}</Pill>
        </div>

        <div className="mt-4 flex items-center gap-2 border-t border-neutral-100 pt-4">
          <Link
            href="/security"
            className="inline-flex items-center rounded-md bg-brand px-3 py-1.5 text-sm font-medium text-white outline-none transition-colors hover:bg-brand-600 focus-visible:ring-2 focus-visible:ring-brand/40"
          >
            {mfa.enrolled ? 'Manage security' : 'Set up authenticator'}
          </Link>
          <form action={signOut}>
            <button
              type="submit"
              className="inline-flex items-center rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-sm font-medium text-neutral-800 outline-none transition-colors hover:bg-neutral-50 focus-visible:ring-2 focus-visible:ring-brand/30"
            >
              Sign out
            </button>
          </form>
        </div>
      </Card>
    </>
  )
}
