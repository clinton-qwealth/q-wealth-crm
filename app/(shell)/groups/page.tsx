import { redirect } from 'next/navigation'
import { getCurrentStaff } from '@/lib/staff'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { AccountValue, Card, PageHeading, Pill } from '@/components/ui'
import { PhoneIcon, PlusIcon } from '@/components/icons'
import { DataRow, DataSection } from '@/components/data-section'
import { AddAccountModal } from '@/components/add-account-modal'
import { Tabs } from '@/components/tabs'

export const metadata = { title: 'Groups · Q Wealth CRM' }

type GroupSummary = {
  group_id: string
  group_type: string
  name: string
  status: string
  primary_contact: string | null
  member_count: number | null
  members: string | null
}

/**
 * Loads the group to display. An `id` in the query string wins; otherwise the
 * first group visible to this staff member is shown so the workspace is not
 * empty. Group *selection* is not built yet — that belongs with the client list.
 */
async function getGroup(id?: string) {
  const supabase = await createSupabaseServerClient({ writable: false })
  let q = supabase.from('group_summary').select('*').limit(1)
  if (id) q = q.eq('group_id', id)
  else q = q.order('name')
  const { data, error } = await q.maybeSingle()
  return error ? null : (data as GroupSummary | null)
}

/**
 * The primary contact's best phone number, and the group's servicing adviser.
 *
 * `group_summary` carries the contact's name but not their id, so client_groups
 * has to be read anyway — the adviser comes along in the same query as an embed
 * rather than costing another round trip.
 *
 * The adviser is `owner_staff_id`: the schema defines the owner as the servicing
 * adviser, required on every group, and it is what group-scoped visibility keys
 * off. Reading their name is possible because staff identity is readable by any
 * active staff member; only the permission mapping is restricted.
 */
async function getGroupContacts(groupId: string) {
  const supabase = await createSupabaseServerClient({ writable: false })

  const { data: group } = await supabase
    .from('client_groups')
    .select('primary_contact_party_id, owner_staff_id, staff_users(full_name)')
    .eq('id', groupId)
    .maybeSingle()

  // The owner embed is to-one, so PostgREST returns an object; tolerate an array
  // in case relationship detection changes.
  const rawOwner = (group as Record<string, unknown> | null)?.staff_users
  const owner = (Array.isArray(rawOwner) ? rawOwner[0] : rawOwner) as
    | { full_name?: string }
    | null
    | undefined
  const adviser = owner?.full_name ?? null

  const partyId = group?.primary_contact_party_id
  if (!partyId) return { phone: null, adviser }

  const { data: phones } = await supabase
    .from('contact_points')
    .select('kind, value, is_preferred')
    .eq('party_id', partyId)
    .in('kind', ['phone_mobile', 'phone_other'])

  if (!phones?.length) return { phone: null, adviser }

  // The contact's own stated preference wins; a mobile is more likely to reach
  // someone than an office line.
  const best =
    phones.find((p) => p.is_preferred && p.kind === 'phone_mobile') ??
    phones.find((p) => p.is_preferred) ??
    phones.find((p) => p.kind === 'phone_mobile') ??
    phones[0]

  return { phone: (best?.value as string | null) ?? null, adviser }
}

type AccountRow = {
  account_id: string
  account_type: string
  label: string
  status: string
  owners: string | null
  latest_value: string | number | null
  valued_on: string | null
  change_amount: string | number | null
  change_pct: string | number | null
  baseline_value: string | number | null
  baseline_points: number | null
}

/**
 * The group's members, its accounts, and the providers on file.
 *
 * Accounts have no group column by design — an account belongs to the group(s)
 * its owners belong to. So the path is members -> owned accounts -> summary.
 * Three round trips; worth folding into a view if this page gets busier.
 */
async function getAccountsData(groupId: string) {
  const supabase = await createSupabaseServerClient({ writable: false })

  const { data: memberRows } = await supabase
    .from('client_group_members')
    .select('party_id, parties(display_name)')
    .eq('group_id', groupId)
    .is('end_date', null)

  const members = (memberRows ?? []).map((m) => {
    const raw = (m as Record<string, unknown>).parties
    const party = (Array.isArray(raw) ? raw[0] : raw) as { display_name?: string } | null
    return { id: m.party_id as string, name: party?.display_name ?? 'Unnamed' }
  })

  const { data: providerRows } = await supabase
    .from('party_roles')
    .select('party_id, parties(display_name)')
    .eq('role', 'product_provider')
    .eq('status', 'active')

  const providers = (providerRows ?? []).map((r) => {
    const raw = (r as Record<string, unknown>).parties
    const party = (Array.isArray(raw) ? raw[0] : raw) as { display_name?: string } | null
    return { id: r.party_id as string, name: party?.display_name ?? 'Unnamed' }
  })

  if (members.length === 0) return { accounts: [] as AccountRow[], members, providers }

  const { data: ownerRows } = await supabase
    .from('financial_account_owners')
    .select('account_id')
    .in('party_id', members.map((m) => m.id))

  const accountIds = [...new Set((ownerRows ?? []).map((o) => o.account_id as string))]
  if (accountIds.length === 0) return { accounts: [] as AccountRow[], members, providers }

  const { data: accounts } = await supabase
    .from('financial_accounts_summary')
    .select('*')
    .in('account_id', accountIds)
    .order('label')

  return { accounts: (accounts ?? []) as AccountRow[], members, providers }
}


const ACCOUNT_TYPE_LABEL: Record<string, string> = {
  investment: 'Investment',
  superannuation: 'Superannuation',
}


const ACCOUNT_STATUS_LABEL: Record<string, string> = {
  active: 'Active',
  suspended: 'Suspended',
  closed: 'Closed',
}

/** Strip formatting so the dialler gets something it can use. */
function telHref(number: string) {
  const cleaned = number.replace(/[^\d+]/g, '')
  return `tel:${cleaned}`
}

/** "Janet Testsmith (primary), Acme Pty Ltd (entity)" -> structured pairs. */
function parseMembers(members: string | null) {
  if (!members) return []
  return [...members.matchAll(/([^,]+?)\s*\(([^)]+)\)/g)].map((m) => ({
    name: m[1].trim(),
    role: m[2].trim().replace(/_/g, ' '),
  }))
}

const TYPE_LABEL: Record<string, string> = {
  household: 'Household',
  business_entity: 'Business entity',
}

function Placeholder({ children, className = 'h-56' }: { children: string; className?: string }) {
  return (
    <div
      className={`flex ${className} items-center justify-center rounded-md border border-dashed border-neutral-200 bg-neutral-50/60`}
    >
      <p className="px-4 text-center text-sm text-neutral-400">{children}</p>
    </div>
  )
}

export default async function GroupsPage({
  searchParams,
}: {
  searchParams: Promise<{ id?: string }>
}) {
  const staff = await getCurrentStaff()
  if (!staff) redirect('/login')

  const { id } = await searchParams
  const group = await getGroup(id)
  const { phone, adviser } = group
    ? await getGroupContacts(group.group_id)
    : { phone: null, adviser: null }
  const members = parseMembers(group?.members ?? null)
  const { accounts, members: ownerOptions, providers } = group
    ? await getAccountsData(group.group_id)
    : { accounts: [], members: [], providers: [] }


  return (
    <>
      <PageHeading
        eyebrow="Client groups"
        title={group?.name ?? 'Groups'}
        meta={
          group ? (
            <>
              <Pill tone="neutral">{TYPE_LABEL[group.group_type] ?? group.group_type}</Pill>
              <Pill on={group.status === 'active'}>{group.status}</Pill>
            </>
          ) : null
        }
        description={group ? undefined : 'No client group is visible to you yet.'}
      />

      {/* Left — group profile */}
      <div className="col-span-full flex flex-col gap-4 lg:col-span-3">
        <Card title="Group profile">
          {group ? (
            <>
              <dl className="flex flex-col gap-2">
                <div className="flex items-baseline justify-between gap-3">
                  <dt className="text-xs text-neutral-500">Primary contact</dt>
                  <dd className="text-right text-sm text-neutral-900">
                    {group.primary_contact ?? '—'}
                  </dd>
                </div>
                <div className="flex items-baseline justify-between gap-3">
                  <dt className="text-xs text-neutral-500">Phone</dt>
                  <dd className="text-right text-sm">
                    {phone ? (
                      /* Reads as data first: same weight and colour as the name
                         above it, with tabular figures so the digits sit evenly.
                         The accent appears on hover, where it signals the
                         affordance without competing with real actions. */
                      <a
                        href={telHref(phone)}
                        className="group inline-flex items-center gap-1.5 rounded outline-none transition-colors hover:text-brand focus-visible:ring-2 focus-visible:ring-brand/30"
                      >
                        {/* Muted by default so the glyph marks the field without
                            competing with the number; picks up the accent with
                            the rest of the link on hover. */}
                        <PhoneIcon className="h-3.5 w-3.5 shrink-0 text-neutral-400 transition-colors group-hover:text-brand" />
                        <span className="tabular-nums text-neutral-900 underline decoration-neutral-300 decoration-dotted underline-offset-4 transition-colors group-hover:text-brand group-hover:decoration-brand">
                          {phone}
                        </span>
                      </a>
                    ) : (
                      <span className="text-neutral-400">—</span>
                    )}
                  </dd>
                </div>
                <div className="flex items-baseline justify-between gap-3">
                  <dt className="text-xs text-neutral-500">Primary adviser</dt>
                  <dd className="text-right">
                    {adviser ? (
                      /* A pill rather than plain text: the adviser is a reference
                         to another record, not a value of this one. Neutral tone —
                         green would imply a live state, brand would imply an
                         action. */
                      <Pill tone="neutral">{adviser}</Pill>
                    ) : (
                      <span className="text-sm text-neutral-400">—</span>
                    )}
                  </dd>
                </div>
              </dl>

              {/* Its own panel rather than a ruled-off region: a light ground
                  plus a hairline edge separates the collection from the single
                  facts above it, without adding another divider line. */}
              <div className="mt-5 rounded-lg border border-neutral-200 bg-neutral-50 p-3">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-neutral-500">
                  Members
                </h3>

                {members.length ? (
                  <ul className="mt-2.5 flex flex-col gap-1.5">
                    {members.map((m) => (
                      <li
                        key={`${m.name}-${m.role}`}
                        className="flex items-baseline justify-between gap-3 rounded-md border border-neutral-200/70 bg-white px-2.5 py-1.5"
                      >
                        <span className="truncate text-sm text-neutral-700">{m.name}</span>
                        <span className="shrink-0 text-[11px] uppercase tracking-wide text-neutral-400">
                          {m.role}
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-2.5 text-sm text-neutral-400">No members yet.</p>
                )}

                {/* Reads as the next row of the list rather than a separate
                    control. Placeholder target — adding members is not built yet. */}
                <a
                  href="#"
                  className="mt-2 inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-xs font-medium text-brand outline-none transition-colors hover:bg-white hover:text-brand-700 focus-visible:ring-2 focus-visible:ring-brand/30"
                >
                  <PlusIcon className="h-3.5 w-3.5" />
                  Add member
                </a>
              </div>

              <p className="mt-3 text-xs text-neutral-400">
                Choosing a different group is not built yet.
              </p>
            </>
          ) : (
            <Placeholder className="h-32">
              No group to show. Groups you own or are assigned to will appear here.
            </Placeholder>
          )}
        </Card>
      </div>

      {/* Centre — the working area */}
      <div className="col-span-full lg:col-span-6">
        <Card tone="muted">
          <Tabs
            label="Group detail"
            items={[
              {
                id: 'workflows',
                label: 'Workflows',
                panel: (
                  <DataSection
                    addLabel="Start workflow"
                    empty={{
                      title: 'No workflows running',
                      description:
                        'Onboarding, annual reviews and advice production appear here once started.',
                    }}
                  />
                ),
              },
              {
                id: 'accounts',
                label: 'Accounts',
                panel: (
                  <DataSection
                    title="Investment Accounts"
                    addLabel="Add account"
                    action={
                      <AddAccountModal
                        owners={ownerOptions}
                        providers={providers}
                        triggerVariant="quiet"
                      />
                    }
                    emptyAction={
                      <AddAccountModal owners={ownerOptions} providers={providers} />
                    }
                    empty={{
                      title: 'No accounts yet',
                      description:
                        'Investment and superannuation accounts owned by this group\u2019s members.',
                    }}
                  >
                    {accounts.length ? (
                      <ul className="flex flex-col gap-1.5">
                        {accounts.map((a) => (
                          <DataRow
                            key={a.account_id}
                            primary={a.label}
                            /* One heading now covers both kinds of account, so the
                               row has to say which this is. */
                            secondary={[
                              ACCOUNT_TYPE_LABEL[a.account_type] ?? a.account_type,
                              a.owners,
                            ]
                              .filter(Boolean)
                              .join(' · ')}
                            /* Marked only when it is not active. Most accounts
                               are, so badging every row would be noise and the
                               exceptions would stop standing out. */
                            badge={
                              a.status === 'active' ? undefined : (
                                <Pill tone={a.status === 'suspended' ? 'warning' : 'neutral'}>
                                  {ACCOUNT_STATUS_LABEL[a.status] ?? a.status}
                                </Pill>
                              )
                            }
                            meta={
                              <AccountValue
                                value={a.latest_value}
                                changeAmount={a.change_amount}
                                changePct={a.change_pct}
                                baselineValue={a.baseline_value}
                                baselinePoints={a.baseline_points}
                              />
                            }
                          />
                        ))}
                      </ul>
                    ) : undefined}
                  </DataSection>
                ),
              },
              {
                id: 'assets-liabilities',
                label: 'Assets + Liabilities',
                panel: (
                  <DataSection
                    addLabel="Add asset"
                    empty={{
                      title: 'Nothing recorded',
                      description:
                        'Property, investments and debts, and the net position they add up to.',
                    }}
                  />
                ),
              },
              {
                id: 'goals',
                label: 'Goals',
                panel: <Placeholder>Client goals, target dates and progress toward them</Placeholder>,
              },
            ]}
          />
        </Card>
      </div>

      {/* Right — reserved */}
      <div className="col-span-full lg:col-span-3">
        <Card>
          <Placeholder className="h-56">Reserved</Placeholder>
        </Card>
      </div>
    </>
  )
}
