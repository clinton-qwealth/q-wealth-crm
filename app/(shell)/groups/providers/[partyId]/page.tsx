import { notFound, redirect } from 'next/navigation'
import { RegisterHeader } from '@/components/register-header'
import { Card, Pill } from '@/components/ui'
import { getServiceProvider } from '@/lib/groups'
import { getCurrentStaff } from '@/lib/staff'

export const metadata = { title: 'Service provider · Q Wealth CRM' }

const CONTACT_LABEL: Record<string, string> = {
  email: 'Email',
  phone_mobile: 'Mobile',
  phone_other: 'Phone',
  address_business: 'Business address',
  address_postal: 'Postal address',
  address_residential: 'Address',
}

/**
 * One service provider — the SKELETON, 26 Sep 2026, built to grow.
 *
 * The shape is the client group page's on purpose: the same three columns,
 * profile on the left, working area in the middle, a right column for what
 * accumulates. The variation is in what fills them — a provider has no
 * members, no balance sheet and no household wealth strip, so the left is a
 * short profile, and the other two columns are RESERVED, each naming what it
 * is reserved for. They are placeholders that say so, not empty lists that
 * imply a register nobody built.
 *
 * ## The gate
 *
 * A session, then the read; any active staff member may look, the same
 * audience search already shows providers to. A party that is not a provider —
 * wrong id, a client's id pasted here, anything — is `notFound()`: one answer
 * for every kind of wrong, and rule 5's own re-check rather than an inherited
 * one. `getServiceProvider` throws on a QUERY error instead of folding it into
 * null, because this week's template-editor 404 came from exactly that fold.
 *
 * ## /groups/providers is a static segment beside /groups/[id]
 *
 * Next resolves static before dynamic, so this route wins and a client group
 * named by the id "providers" is unreachable — ids here are UUIDs, so nothing
 * real is shadowed. The same trick /admin/templates plays.
 */
export default async function ServiceProviderPage({
  params,
}: {
  params: Promise<{ partyId: string }>
}) {
  const staff = await getCurrentStaff()
  if (!staff) redirect('/login')

  const { partyId } = await params
  const provider = await getServiceProvider(partyId)
  if (!provider) notFound()

  return (
    <>
      <div className="col-span-full">
        <RegisterHeader
          trail={[
            { label: 'Q Wealth CRM', href: '/' },
            { label: 'Groups', href: '/groups' },
            { label: 'Service providers', href: '/groups?section=providers' },
          ]}
          title={provider.name}
        />
      </div>

      {/* Left — the provider's profile */}
      <div className="col-span-full flex flex-col gap-4 lg:col-span-3">
        <Card title="Provider">
          <dl className="flex flex-col gap-3 text-sm">
            <div>
              <dt className="text-[11px] font-semibold uppercase tracking-widest text-neutral-400">Status</dt>
              <dd className="mt-0.5">
                <Pill on={provider.role_status === 'active'}>
                  {provider.ended ? `Ended ${provider.ended}` : provider.role_status}
                </Pill>
              </dd>
            </div>
            <div>
              <dt className="text-[11px] font-semibold uppercase tracking-widest text-neutral-400">
                Provider since
              </dt>
              <dd className="mt-0.5 text-neutral-800">{provider.since ?? 'Not recorded'}</dd>
            </div>
            {provider.contact_points.length > 0 ? (
              provider.contact_points.map((c) => (
                <div key={`${c.kind}:${c.value}`}>
                  <dt className="text-[11px] font-semibold uppercase tracking-widest text-neutral-400">
                    {CONTACT_LABEL[c.kind] ?? c.kind}
                    {c.is_preferred ? ' · preferred' : ''}
                  </dt>
                  <dd className="mt-0.5 break-words text-neutral-800">{c.value}</dd>
                </div>
              ))
            ) : (
              <p className="text-xs text-neutral-400">No contact details recorded yet.</p>
            )}
            {provider.notes ? (
              <div>
                <dt className="text-[11px] font-semibold uppercase tracking-widest text-neutral-400">Notes</dt>
                <dd className="mt-0.5 whitespace-pre-wrap text-neutral-700">{provider.notes}</dd>
              </div>
            ) : null}
          </dl>
        </Card>
      </div>

      {/* Centre — reserved for the working area. What belongs here is the
          firm's exposure to this provider: the accounts and policies held with
          it, which today carry the provider only as a NAME on the record. A
          real join is schema work — a provider_party_id on the account — and
          the dashed block says so rather than drawing an empty table over a
          join that does not exist. */}
      <div className="col-span-full lg:col-span-6">
        <Card>
          <div className="flex min-h-64 flex-col items-center justify-center rounded-lg border border-dashed border-neutral-200 bg-neutral-50/60 px-6 py-10">
            <p className="text-center text-sm font-medium text-neutral-700">
              Accounts and policies with this provider
            </p>
            <p className="mt-1 max-w-sm text-center text-xs leading-relaxed text-neutral-500">
              Holdings name their provider as text today, so they cannot be listed here yet.
              Linking them is the next piece of this page.
            </p>
          </div>
        </Card>
      </div>

      {/* Right — reserved for what accumulates: notes and activity about the
          relationship, the way a group page's right column holds its file
          notes. */}
      <div className="col-span-full lg:col-span-3">
        <Card>
          <div className="flex min-h-64 flex-col items-center justify-center rounded-lg border border-dashed border-neutral-200 bg-neutral-50/60 px-6 py-10">
            <p className="text-center text-sm font-medium text-neutral-700">Notes and activity</p>
            <p className="mt-1 max-w-sm text-center text-xs leading-relaxed text-neutral-500">
              File notes are group-scoped today; a provider-scoped feed lives here once notes can
              name one.
            </p>
          </div>
        </Card>
      </div>
    </>
  )
}
