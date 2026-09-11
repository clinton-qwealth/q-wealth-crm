import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { getCurrentStaff } from '@/lib/staff'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { coverSummary, ACCOUNT_LIVE, AccountTypeTile, AccountValue, Card, PageHeading, Pill, Placeholder, POLICY_LIVE, PolicyTile, StatTile, TAB_SPLIT } from '@/components/ui'
import { liveFirst } from '@/lib/record-order'
import { wealthSummary } from '@/lib/wealth'
import { PhoneIcon } from '@/components/icons'
import { ACCOUNT_TYPE_LABEL } from '@/lib/account-mix'
import { AccountDonut } from '@/components/account-donut'
import { DataRow, DataSection } from '@/components/data-section'
import { AddAccountModal } from '@/components/add-account-modal'
import { AddPolicyModal } from '@/components/add-policy-modal'
import { GroupMembers } from '@/components/group-members'
import { getGroupMemberDetail } from '@/lib/person'
import { getGroupNotes } from '@/lib/notes'
import { FileNotes } from '@/components/file-notes'
import { WorkflowSection } from '@/components/workflow-section'
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
 * The group this page is about.
 *
 * The id is a PATH SEGMENT now, so it is always present and this no longer
 * falls back to "the first group visible to this staff member". That fallback
 * existed while the route was `/groups?id=`, where arriving with no id was the
 * ordinary case; on `/groups/[id]` it would only ever fire for a malformed
 * request, and quietly showing somebody a different client's group than the one
 * in their address bar is the worst possible answer to that.
 *
 * `group_summary` is security_invoker, so a group outside this staff member's
 * access returns no row and the caller shows a 404 — indistinguishable from a
 * group that does not exist, which is the point.
 */
async function getGroup(id: string) {
  const supabase = await createSupabaseServerClient({ writable: false })
  const { data, error } = await supabase
    .from('group_summary')
    .select('*')
    .eq('group_id', id)
    .maybeSingle()
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
 * The group's members, its accounts, its policies, and the providers on file.
 *
 * Accounts have no group column by design — an account belongs to the group(s)
 * its owners belong to, and a policy to the group(s) of anyone with a role on
 * it. Until 10 September this function honoured that by asking three times in
 * a row: members, then the accounts and policies those parties are attached
 * to, then the two summary views for those ids. Each ask is a round trip of
 * about 170ms whatever it carries, and once the group row and the notes had
 * joined the page's first wave this chain was the deepest thing left and set
 * the page's load time on its own.
 *
 * `group_financial_accounts` and `group_insurance_policies` answer all three
 * questions in one: the summary rows keyed by group_id, for CURRENT members,
 * once each, with a policy counted through any role (a life insured on a
 * policy someone else owns still belongs on this tab). Both are
 * security_invoker over the same tables the three asks read, so a staff member
 * sees exactly the rows they saw before. Proved equivalent on a branch over
 * 3,000 accounts before the app was changed; see the migration.
 *
 * ONE wave of four. Members and providers were always independent of each
 * other; now the accounts and the policies are independent of the members
 * too, because the view finds the members itself.
 */
async function getAccountsData(groupId: string) {
  const supabase = await createSupabaseServerClient({ writable: false })

  const [{ data: memberRows }, { data: providerRows }, accountsRes, policiesRes] = await Promise.all([
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
    supabase.from('group_financial_accounts').select('*').eq('group_id', groupId).order('label'),
    supabase.from('group_insurance_policies').select('*').eq('group_id', groupId).order('label'),
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

  return {
    accounts: (accountsRes.data ?? []) as AccountRow[],
    policies: (policiesRes.data ?? []) as PolicyRow[],
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


/** Strip formatting so the dialler gets something it can use. */
function telHref(number: string) {
  const cleaned = number.replace(/[^\d+]/g, '')
  return `tel:${cleaned}`
}

const TYPE_LABEL: Record<string, string> = {
  household: 'Household',
  business_entity: 'Business entity',
}

export default async function GroupDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const staff = await getCurrentStaff()
  if (!staff) redirect('/login')

  const { id } = await params
  /* ONE wave of five, since 10 September. The group row used to be awaited on
     its own first, so that `notFound()` could run before anything else was
     asked for — and that lone await was a whole round trip (~170ms) on every
     visit to this page, the slowest in the app. Every sibling takes the id
     from the URL, not from the row, so nothing here needs the row to start.

     The trade: on a WRONG url the four siblings run for nothing and return
     empties under RLS — a wrong url is rare, and every real visit saves a
     round trip. The 404 still happens, one wave later; it was already a
     streamed 200 carrying the not-found UI once the page went behind a loading
     boundary. The workflow page checks after its wave the same way.

     memberDetail exists because the panel needs the whole record, not the
     rolled-up name string the card used before — individuals only, since a
     trust or company in the group has no persons row and those keep rendering
     from `members`. */
  const [group, { phone, adviser }, memberDetail, accountsData, notesData] = await Promise.all([
    getGroup(id),
    getGroupContacts(id),
    getGroupMemberDetail(id),
    getAccountsData(id),
    getGroupNotes(id),
  ])
  /* 404 rather than an empty shell. The page moved from `/groups?id=` to
     `/groups/[id]` on 10 September, and with the id in the path an unknown
     group is a wrong URL, not a state the screen should try to render. Same
     treatment as the workflow detail page. */
  if (!group) notFound()
  const {
    accounts: allAccounts,
    policies: allPolicies,
    members: ownerOptions,
    providers,
  } = accountsData

  /*
   * Dormant records sink, asked for on 11 September — a closed account belongs
   * under the live ones, not between two of them.
   *
   * Display only, and applied here rather than in the loader so it stays that
   * way. `wealthSummary` below sums and `AccountDonut` re-sorts by value, so
   * neither can see this; `liveFirst` returns a new array so neither is handed
   * a reordered one either. The alphabetical order the query applied survives
   * inside each group — see `lib/record-order.ts` for why that is not an
   * accident.
   */
  const accounts = liveFirst(allAccounts, (a) => a.status === ACCOUNT_LIVE)
  const policies = liveFirst(allPolicies, (p) => p.status === POLICY_LIVE)
  const { notes, workflows } = notesData


  return (
    <>
      <PageHeading
        eyebrow="Client groups"
        title={group.name}
        meta={
          <>
            <Pill tone="neutral">{TYPE_LABEL[group.group_type] ?? group.group_type}</Pill>
            <Pill on={group.status === 'active'}>{group.status}</Pill>
          </>
        }
        summary={
          (
            /* Three headline figures. Today they are the same number — see
               wealthSummary for why, and for where property and debts join
               the arithmetic when they exist. The caveat is not printed
               (decided 6 Sep: header and number only) but rides on each figure
               as a tooltip, so it is one hover away rather than gone.

               No cards. Charcoal, then white cards with a brand rule, were both
               tried and rejected on sight the same day; a row of boxes competes
               with the title, however the boxes are styled. Bare figures on
               the page ground, tied into one strip by hairline dividers, read
               as part of the header rather than as furniture beside it. */
            <div className="grid grid-cols-3 divide-x divide-neutral-300/80">
              {(() => {
                const w = wealthSummary(accounts)
                /* Three equals, one size. A headline-plus-two-in-support layout
                   was tried and reversed: the reader wanted the three figures
                   weighed side by side, not ranked. The dividers still say
                   "one set". */
                return [w.wealth, w.investments, w.assets].map((f, i) => (
                  <StatTile
                    key={f.label}
                    label={f.label}
                    value={f.value}
                    change={f.change}
                    title={f.note}
                    bare
                    size="lg"
                    className={i === 0 ? 'pr-6' : 'px-6'}
                  />
                ))
              })()}
            </div>
          )
        }
      />

      {/* Left — group profile */}
      <div className="col-span-full flex flex-col gap-4 lg:col-span-3">
        <Card>
          {/* One left edge for the whole card.

              The members well is padded p-3, so its heading starts 12px in.
              Everything above it used to start at the card's own content edge,
              which put the heading, the fields and the members list on
              different indents. Rather than pull the well out, everything else
              is pushed in to meet it: the title comes out of Card so it can
              carry the same inset, and the trailing note carries it too. (This
              was 13px while the well had a border; it no longer does — see
              GroupMembers.) */}
          <h2 className="mb-3 pl-3 text-xs font-semibold uppercase tracking-wider text-neutral-500">
            Group profile
          </h2>
          {
            <>
              {/* Label above value in two columns, matching the member panel.

                  These were label-left / value-right, which reads well when
                  values are short and alike. They are not: a name, a telephone
                  number and a pill, each a different height and weight, so the
                  right edge never lined up and the eye had to travel the width
                  of the card for every one. Stacked, each label sits directly
                  over what it describes and every value starts at the same left
                  edge.

                  gap-x-6 rather than the panel's gap-x-8: this card is a quarter
                  of the page, so a column measures about 123px. A long name does
                  wrap there — "Konstantinos Papadopoulos" takes two lines — and
                  that was checked rather than assumed. It reads fine; the card
                  simply grows. The phone never wraps, being tabular figures of
                  fixed width. */}
              <dl className="grid grid-cols-2 gap-x-6 gap-y-4 pl-3">
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

              <GroupMembers
                groupId={group.group_id}
                groupName={group.name}
                members={memberDetail}
              />

              {/* Points at where choosing WILL happen. The Groups index exists
                  as of 10 September and is in the navbar; it has no list in it
                  yet, so this says what is missing rather than implying the
                  whole idea is unbuilt. */}
              <p className="mt-3 pl-3 text-xs text-neutral-400">
                Choosing a different group from{' '}
                <Link href="/groups" className="underline decoration-neutral-300 underline-offset-2 hover:text-neutral-600">
                  Groups
                </Link>{' '}
                is not built yet.
              </p>
            </>
          }
        </Card>
      </div>

      {/* Centre — the working area */}
      <div className="col-span-full lg:col-span-6">
        <Card>
          <Tabs
            ground
            label="Group detail"
            items={[
              {
                id: 'workflows',
                label: 'Workflows',
                panel: <WorkflowSection groupId={group.group_id} workflows={workflows} />,
              },
              {
                id: 'accounts',
                label: 'Accounts',
                panel: (
                  <div className="flex flex-col gap-6">
                    {/* Two columns, exactly the split the Workflows tab uses —
                        records left, the other 35% reserved. Asked for on
                        10 September; `TAB_SPLIT` is shared with that tab rather
                        than copied, so the two cannot drift apart. The Insurance
                        section below is deliberately still full width: only the
                        investment section was asked for, and matching it is a
                        decision rather than a fix. */}
                    <div className={TAB_SPLIT}>
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
                        {accounts.length
                          ? accounts.map((a) => (
                              <DataRow
                                key={a.account_id}
                                /* The tile carries the status: a live account
                                   keeps its type colour and glyph, a suspended
                                   or closed one turns grey and swaps the glyph
                                   for a pause or an archive. It replaced a pill
                                   beside the name on 11 September, which was
                                   truncating the name to fit itself. */
                                leading={
                                  <AccountTypeTile type={a.account_type} status={a.status} />
                                }
                                primary={a.label}
                                /* One heading now covers both kinds of account, so the
                                   row has to say which this is — and it is the only
                                   place the type is stated once a dormant tile has
                                   given up its glyph for the status. */
                                secondary={[
                                  ACCOUNT_TYPE_LABEL[a.account_type] ?? a.account_type,
                                  a.owners,
                                ]
                                  .filter(Boolean)
                                  .join(' · ')}
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
                            ))
                          : undefined}
                      </DataSection>
                      {/* The reserved half, no longer reserved — a trial as of
                          10 September. The Workflows tab still shows
                          `ReservedColumn` there, which is the point of sharing
                          only the SPLIT: the two tabs agree on the measurements
                          and each decides its own content. */}
                      <AccountDonut accounts={accounts} />
                    </div>
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
                      {policies.length
                        ? policies.map((p) => (
                            <DataRow
                              key={p.policy_id}
                              leading={<PolicyTile status={p.status} />}
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
                              meta={coverSummary(p.total_lump_sum_cover, p.total_monthly_benefit) ?? undefined}
                            />
                          ))
                        : undefined}
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

      {/* Right — the group's file notes */}
      <div className="col-span-full lg:col-span-3">
        <Card>
          <FileNotes groupId={group.group_id} notes={notes} workflows={workflows} />
        </Card>
      </div>
    </>
  )
}
