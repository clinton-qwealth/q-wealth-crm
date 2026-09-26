import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { COVER_TYPE_LABEL } from '@/components/policy-list'
import { RegisterHeader } from '@/components/register-header'
import { headlineMoney } from '@/lib/wealth'
import { Card, coverSummary, Pill, PolicyTile, SHEET, StatTile } from '@/components/ui'
import { providerSummary } from '@/lib/provider-summary'
import { ProviderAccounts } from '@/components/provider-accounts'
import { ProviderContacts } from '@/components/provider-contacts'
import { ProviderLogoBox } from '@/components/provider-logo-box'
import {
  getProviderContacts,
  getProviderHoldings,
  getServiceProvider,
  type ProviderHolding,
} from '@/lib/groups'
import { getCurrentStaff } from '@/lib/staff'
import { providerLogoUrl } from '@/lib/provider-logo'

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
 * short profile, the middle is THE HOLDINGS — every account and policy that
 * names this provider, live since 26 Sep when the provider_party_id links
 * were backfilled — and the right stays reserved for provider-scoped notes.
 *
 * What kind of provider they are is DERIVED from those holdings, not stored:
 * referenced from accounts makes them a platform, from policies an insurer,
 * from both, both. A stored label could drift from what is actually held;
 * the derivation cannot lie, and "nothing held yet" is shown as exactly that.
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
  /* One wave: the profile, its holdings and its people together. */
  const [provider, holdings, contacts] = await Promise.all([
    getServiceProvider(partyId),
    getProviderHoldings(partyId),
    getProviderContacts(partyId),
  ])
  if (!provider) notFound()

  const accounts = holdings.filter((h) => h.kind === 'account')
  const policies = holdings.filter((h) => h.kind === 'policy')
  const provides = [accounts.length > 0 ? 'Platform' : null, policies.length > 0 ? 'Insurer' : null]
    .filter(Boolean)
    .join(' · ')

  /* The header strip's figures — deduplicated, live-only, with the exclusions
     counted; the rules live in lib/provider-summary. */
  const totals = providerSummary(holdings)
  const totalsNote = [
    'Across the groups you can see, live accounts only',
    totals.unvalued > 0
      ? `${totals.unvalued} unvalued account${totals.unvalued === 1 ? '' : 's'} excluded`
      : null,
  ]
    .filter(Boolean)
    .join(' · ')

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
          /* The mark stands where the name would — the name is still the h1's
             accessible text, through the image's alt. */
          logo={provider.logo_path ? providerLogoUrl(provider.party_id, provider.logo_path) : undefined}
          /* The household page's wealth strip, worn by a provider: three
             equals on hairline dividers, no boxes — that page's reasoning,
             reused whole. Shown even at zero: a provider the reader holds
             nothing with reads $0, which is a fact, not a fault. */
          summary={
            <div className="grid grid-cols-3 divide-x divide-neutral-300/80">
              {[
                { label: 'Total FUM', value: totals.fum },
                { label: 'Total investment', value: totals.investment },
                { label: 'Total super', value: totals.superannuation },
              ].map((f, i) => (
                <StatTile
                  key={f.label}
                  label={f.label}
                  value={headlineMoney.format(f.value)}
                  title={totalsNote}
                  bare
                  size="lg"
                  className={i === 0 ? 'pr-6' : 'px-6'}
                />
              ))}
            </div>
          }
        />
      </div>

      {/* Left — the provider's profile: the GENERAL facts, two to a row.
          Asked 26 Sep — the single stack spent a tall column on short answers.
          Status and Provides lead; since and the organisation's own contact
          channels follow in the same grid. Notes moved OUT entirely, to the
          right column that was reserved for exactly that. */}
      <div className="col-span-full flex flex-col gap-4 lg:col-span-3">
        <Card title="Provider">
          {/* The logo, above the fields — the one piece of the profile that is
              a picture, worn where the staff drawer wears its photo. */}
          <ProviderLogoBox partyId={provider.party_id} name={provider.name} logoPath={provider.logo_path} />
          <dl className="grid grid-cols-2 gap-x-3 gap-y-3 text-sm">
            <div>
              <dt className="text-[11px] font-semibold uppercase tracking-widest text-neutral-400">Status</dt>
              <dd className="mt-0.5">
                <Pill on={provider.role_status === 'active'}>
                  {provider.ended ? `Ended ${provider.ended}` : provider.role_status}
                </Pill>
              </dd>
            </div>
            <div>
              <dt className="text-[11px] font-semibold uppercase tracking-widest text-neutral-400">Provides</dt>
              {/* Derived, never stored — see the header. */}
              <dd className="mt-0.5 text-neutral-800">
                {provides || 'Nothing held with them yet'}
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
              <p className="col-span-2 text-xs text-neutral-400">No contact details recorded yet.</p>
            )}
          </dl>

          {/* The households' members well, worn by a provider: the same
              object in the same place on the card, holding the PEOPLE — BDMs,
              adviser support. See the component for what differs and why. */}
          <ProviderContacts providerPartyId={provider.party_id} contacts={contacts} />
        </Card>
      </div>

      {/* Centre — the firm's exposure to this provider, through the reader's
          own keys: provider_holdings is invoker-rights, so a limited adviser
          sees only the groups their RLS admits. Each row opens the household
          that holds it, because that is where the record's own drawer lives.
          Five columns since 26 Sep: the point went to the right column, which
          had content coming (the notes) and nothing but a placeholder's width. */}
      <div className="col-span-full lg:col-span-5">
        <Card>
          {holdings.length === 0 ? (
            <div className="flex min-h-64 flex-col items-center justify-center rounded-lg border border-dashed border-neutral-200 bg-neutral-50/60 px-6 py-10">
              <p className="text-center text-sm font-medium text-neutral-700">Nothing held with this provider</p>
              <p className="mt-1 max-w-sm text-center text-xs leading-relaxed text-neutral-500">
                No account or policy you can see names them. That may be the whole truth, or it may
                be your view of it — visibility here follows your group access.
              </p>
            </div>
          ) : (
            <div className="flex flex-col gap-5">
              <ProviderAccounts rows={accounts} />
              <PolicySection rows={policies} />
            </div>
          )}
        </Card>
      </div>

      {/* Right — what accumulates about the relationship, one column point
          wider than it was (4 of 12, taken from the middle): the provider's
          notes live here now, out of the profile's general facts, and the
          activity feed keeps its honest placeholder beneath them. */}
      <div className="col-span-full lg:col-span-4">
        <Card title="Notes">
          {provider.notes ? (
            <p className="whitespace-pre-wrap text-sm leading-relaxed text-neutral-700">{provider.notes}</p>
          ) : (
            <p className="text-sm text-neutral-400">No notes yet.</p>
          )}
          <div className="mt-4 flex flex-col items-center justify-center rounded-lg border border-dashed border-neutral-200 bg-neutral-50/60 px-6 py-8">
            <p className="text-center text-sm font-medium text-neutral-700">Activity</p>
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

/**
 * The provider's policies: the GROUP page's insurance row, re-cut for this
 * card — same tile, same cover words, same two-unit figure through
 * `coverSummary`, because an adviser who reads policies there should not meet
 * a poorer row here. The addition is "held by …", which is this page's own
 * fact: the group page never has to say whose sheet a policy is on.
 *
 * The tile carries the lifecycle (a cancelled policy goes dormant grey with
 * the word riding `title`/`sr-only`), so the neutral status pill the first cut
 * wore is gone — one place says it, the way the accounts and policy lists
 * decided long ago. Absent entirely when empty, like the accounts section.
 */
function PolicySection({ rows }: { rows: ProviderHolding[] }) {
  if (rows.length === 0) return null
  return (
    <div>
      <h3 className="mb-2.5 truncate text-xs font-semibold uppercase tracking-wider text-neutral-500">
        Policies
      </h3>
      <div className={SHEET}>
        <ul className="divide-y divide-neutral-200/80">
          {rows.map((h) => {
            const covers = (h.cover_types ?? '')
              .split(', ')
              .filter(Boolean)
              .map((c) => COVER_TYPE_LABEL[c] ?? c)
              .join(', ')
            const figure = coverSummary(h.total_lump_sum_cover, h.total_monthly_benefit)
            return (
              <li key={`${h.record_id}:${h.group_id}`}>
                <Link
                  href={`/groups/${h.group_id}`}
                  className="flex items-center gap-3 px-3.5 py-2.5 outline-none transition-colors hover:bg-neutral-50 focus-visible:bg-neutral-50 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand/30"
                >
                  <PolicyTile status={h.status} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold text-neutral-900">{h.label}</span>
                    <span className="mt-0.5 block truncate text-xs text-neutral-500">
                      {[covers, h.lives_insured, `held by ${h.group_name}`].filter(Boolean).join(' · ')}
                    </span>
                  </span>
                  {figure ? (
                    <span className="shrink-0 text-right text-[15px] font-semibold tabular-nums text-neutral-900">
                      {figure}
                    </span>
                  ) : null}
                </Link>
              </li>
            )
          })}
        </ul>
      </div>
    </div>
  )
}
