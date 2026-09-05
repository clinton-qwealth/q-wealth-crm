import { redirect } from 'next/navigation'
import { getCurrentStaff } from '@/lib/staff'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { AccountValue, Card, coverSummary, PageHeading, Pill } from '@/components/ui'
import { PhoneIcon, PlusIcon } from '@/components/icons'
import { DataRow, DataSection } from '@/components/data-section'
import { AddAccountModal } from '@/components/add-account-modal'
import { AddPolicyModal } from '@/components/add-policy-modal'
import { MemberPanel } from '@/components/member-panel'
import { getGroupMemberDetail, type PersonDetail } from '@/lib/person'
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

type PolicyRow = {
  policy_id: string
  label: string
  policy_number: string
  status: string
  insurer: string | null
  owners: string | null
  lives_insured: string | null
  cover_types: string | null
  total_lump_sum_cover: string | number | null
  total_monthly_benefit: string | number | null
  premium: string | number | null
  premium_frequency: string | null
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

  /* Wave one: the group's members and the provider list have nothing to do with
     each other, so they go together. Every round trip to Supabase costs about
     170ms regardless of how small the query is, so the depth of this chain
     matters far more than the shape of any single query in it. */
  const [{ data: memberRows }, { data: providerRows }] = await Promise.all([
    supabase
      .from('client_group_members')
      .select('party_id, parties(display_name)')
      .eq('group_id', groupId)
      .is('end_date', null),
    supabase
      .from('party_roles')
      .select('party_id, parties(display_name)')
      .eq('role', 'product_provider')
      .eq('status', 'active'),
  ])

  const members = (memberRows ?? []).map((m) => {
    const raw = (m as Record<string, unknown>).parties
    const party = (Array.isArray(raw) ? raw[0] : raw) as { display_name?: string } | null
    return { id: m.party_id as string, name: party?.display_name ?? 'Unnamed' }
  })

  const providers = (providerRows ?? []).map((r) => {
    const raw = (r as Record<string, unknown>).parties
    const party = (Array.isArray(raw) ? raw[0] : raw) as { display_name?: string } | null
    return { id: r.party_id as string, name: party?.display_name ?? 'Unnamed' }
  })

  if (members.length === 0) {
    return { accounts: [] as AccountRow[], policies: [] as PolicyRow[], members, providers }
  }
  const partyIds = members.map((m) => m.id)

  /* Accounts and policies are fetched independently: a group can hold cover
     without holding an investment account, and vice versa. Returning early from
     one path would silently empty the other.

     Wave two finds which accounts and policies these parties are attached to —
     the second is through any policy role, since a person whose life is insured
     on a policy someone else owns still belongs to this list. */
  const [{ data: ownerRows }, { data: policyPartyRows }] = await Promise.all([
    supabase.from('financial_account_owners').select('account_id').in('party_id', partyIds),
    supabase.from('insurance_policy_parties').select('policy_id').in('party_id', partyIds),
  ])

  const accountIds = [...new Set((ownerRows ?? []).map((o) => o.account_id as string))]
  const policyIds = [...new Set((policyPartyRows ?? []).map((r) => r.policy_id as string))]

  // Wave three: the two summary views. An empty id list is resolved locally
  // rather than sent, so a group with no cover pays nothing for the policy half.
  const [accountsRes, policiesRes] = await Promise.all([
    accountIds.length
      ? supabase.from('financial_accounts_summary').select('*').in('account_id', accountIds).order('label')
      : Promise.resolve({ data: [] as unknown[] }),
    policyIds.length
      ? supabase.from('insurance_policies_summary').select('*').in('policy_id', policyIds).order('label')
      : Promise.resolve({ data: [] as unknown[] }),
  ])
  const accounts = accountsRes.data ?? []
  const policies = policiesRes.data ?? []

  return {
    accounts: accounts as AccountRow[],
    policies: policies as PolicyRow[],
    members,
    providers,
  }
}


const COVER_TYPE_LABEL: Record<string, string> = {
  life: 'Life',
  tpd: 'TPD',
  trauma: 'Trauma',
  income_protection: 'Income protection',
}

const POLICY_STATUS_LABEL: Record<string, string> = {
  in_force: 'In force',
  lapsed: 'Lapsed',
  cancelled: 'Cancelled',
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

  /* All three need the group id and nothing from each other, so they run
     together rather than one after another. memberDetail exists because the
     panel needs the whole record, not the rolled-up name string the card used
     before — individuals only, since a trust or company in the group has no
     persons row and those keep rendering from `members`. */
  const [{ phone, adviser }, memberDetail, accountsData]: [
    Awaited<ReturnType<typeof getGroupContacts>>,
    PersonDetail[],
    Awaited<ReturnType<typeof getAccountsData>>,
  ] = group
    ? await Promise.all([
        getGroupContacts(group.group_id),
        getGroupMemberDetail(group.group_id),
        getAccountsData(group.group_id),
      ])
    : [
        { phone: null, adviser: null },
        [],
        { accounts: [], policies: [], members: [], providers: [] },
      ]
  const { accounts, policies, members: ownerOptions, providers } = accountsData


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
              {/* Label above value, matching the member panel.
                  
                  These were label-left / value-right, which reads well when
                  values are short and alike. They are not: a name, a telephone
                  number and a pill, each a different height and weight, so the
                  right edge never lined up and the eye had to travel the width
                  of the card for every one. Stacked, each label sits directly
                  over what it describes and every value starts at the same left
                  edge. One column, not the panel's two — this card is a quarter
                  of the page and a name would wrap in half of it. */}
              <dl className="flex flex-col gap-4">
                <div>
                  <dt className="text-xs leading-snug text-neutral-500">Primary contact</dt>
                  <dd className="mt-0.5 text-sm leading-snug text-neutral-900">
                    {group.primary_contact ?? <span className="text-neutral-400">—</span>}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs leading-snug text-neutral-500">Phone</dt>
                  <dd className="mt-0.5 text-sm leading-snug">
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
                <div>
                  <dt className="text-xs leading-snug text-neutral-500">Primary adviser</dt>
                  <dd className="mt-0.5 leading-snug">
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

                {memberDetail.length ? (
                  <ul className="mt-2.5 flex flex-col gap-1.5">
                    {memberDetail.map((m) =>
                      m.is_person ? (
                      <li key={m.party_id}>
                          <MemberPanel
                            groupId={group.group_id}
                            members={memberDetail}
                            initialMode="view"
                            initialPartyId={m.party_id}
                          >
                            <span className="flex min-w-0 items-center gap-2">
                              <span className="truncate text-sm text-neutral-700">
                                {m.display_name}
                              </span>
                              {m.date_of_death ? <Pill tone="danger">Deceased</Pill> : null}
                            </span>
                            <span className="shrink-0 text-[11px] uppercase tracking-wide text-neutral-400">
                              {(m.member_role ?? '').replace(/_/g, ' ')}
                            </span>
                          </MemberPanel>
                        </li>
                      ) : (
                        /* A trust or company in the group. Listed for
                           completeness; there is no individual record to open. */
                        <li
                          key={m.party_id}
                          className="flex items-baseline justify-between gap-3 rounded-md border border-neutral-200/70 bg-white px-2.5 py-1.5"
                        >
                          <span className="truncate text-sm text-neutral-700">
                            {m.display_name}
                          </span>
                          <span className="shrink-0 text-[11px] uppercase tracking-wide text-neutral-400">
                            {(m.member_role ?? '').replace(/_/g, ' ')}
                          </span>
                        </li>
                      ),
                    )}
                  </ul>
                ) : (
                  <p className="mt-2.5 text-sm text-neutral-400">No members yet.</p>
                )}

                {/* Reads as the next row of the list rather than a separate
                    control. Opens the panel searching people already on file,
                    because linking an existing record is the case that keeps
                    duplicate people out of the database. */}
                <MemberPanel
                  groupId={group.group_id}
                  members={memberDetail}
                  initialMode="search"
                  variant="link"
                >
                  <PlusIcon className="h-3.5 w-3.5" />
                  Add member
                </MemberPanel>
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
        <Card>
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
                  <div className="flex flex-col gap-6">
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
                    <DataSection
                      title="Insurance Policies"
                      addLabel="Add policy"
                      action={
                        <AddPolicyModal
                          owners={ownerOptions}
                          providers={providers}
                          triggerVariant="quiet"
                        />
                      }
                      emptyAction={
                        <AddPolicyModal owners={ownerOptions} providers={providers} />
                      }
                      empty={{
                        title: 'No policies yet',
                        description:
                          'Life, TPD, trauma and income protection cover held by this group\u2019s members.',
                      }}
                    >
                      {policies.length ? (
                        <ul className="flex flex-col gap-1.5">
                          {policies.map((p) => (
                            <DataRow
                              key={p.policy_id}
                              primary={p.label}
                              secondary={[
                                p.cover_types
                                  ?.split(', ')
                                  .map((c) => COVER_TYPE_LABEL[c] ?? c)
                                  .join(', '),
                                p.lives_insured,
                              ]
                                .filter(Boolean)
                                .join(' \u00b7 ')}
                              /* Same rule as accounts: marked only when the
                                 status is worth noticing. */
                              badge={
                                p.status === 'in_force' ? undefined : (
                                  <Pill tone={p.status === 'lapsed' ? 'warning' : 'neutral'}>
                                    {POLICY_STATUS_LABEL[p.status] ?? p.status}
                                  </Pill>
                                )
                              }
                              meta={coverSummary(p.total_lump_sum_cover, p.total_monthly_benefit) ?? undefined}
                            />
                          ))}
                        </ul>
                      ) : undefined}
                    </DataSection>
                  </div>
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
