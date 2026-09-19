import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { getCurrentStaff } from '@/lib/staff'
import { getGroupAccountPosts, getGroupPolicyPosts, getStaffChoices } from '@/lib/workflows'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { accountMoney, owedMoney, ACCOUNT_LIVE, BalanceItemTile, BALANCE_SPLIT, Card, PageHeading, Pill, Placeholder, POLICY_LIVE, StatTile, TAB_SPLIT, WORKING_AREA } from '@/components/ui'
import { liveFirst } from '@/lib/record-order'
import { wealthSummary } from '@/lib/wealth'
import { balanceTotals, ITEM_LIVE, ITEM_TYPE_LABEL } from '@/lib/balance-sheet'
import { PhoneIcon } from '@/components/icons'
import { AccountDonut } from '@/components/account-donut'
import { DataRow, DataSection } from '@/components/data-section'
import { AccountList, type AccountRow } from '@/components/account-list'
import { PolicyList, type PolicyRow } from '@/components/policy-list'
import { AddAccountModal } from '@/components/add-account-modal'
import { AddPolicyModal } from '@/components/add-policy-modal'
import { AddBalanceItemModal } from '@/components/add-balance-item-modal'
import { BalanceBar } from '@/components/balance-bar'
import { GroupMembers } from '@/components/group-members'
import { getGroupMemberDetail } from '@/lib/person'
import { getGroupNotes } from '@/lib/notes'
import { FileNotes } from '@/components/file-notes'
import { WorkflowSection } from '@/components/workflow-section'
import { Tabs } from '@/components/tabs'

export const metadata = { title: 'Groups · Q Wealth CRM' }

/** A row of `group_assets_liabilities`. Money arrives as a string, because
 *  PostgREST sends `numeric` that way rather than losing precision to a float. */
type BalanceItemRow = {
  item_id: string
  item_type: string
  side: string
  label: string
  value: string | number | null
  valued_on: string | null
  status: string
  closed_on: string | null
  institution: string | null
  secured_against_id: string | null
  secured_against: string | null
  owners: string | null
  owner_count: number | null
  owner_shares: { party_id: string; name: string; share_percent: string | number }[] | null
}

/**
 * Who owns a balance-sheet row, with the share each one holds.
 *
 * The shares are the whole reason this table records them, so they are printed
 * rather than left to a hover — but only when there is more than one owner. A
 * lone "Jane Doe 100%" is noise: one name already means all of it.
 */
function ownerLine(item: BalanceItemRow): string {
  const shares = item.owner_shares ?? []
  if (shares.length > 1) {
    return shares
      .map((o) => `${o.name} ${Number(o.share_percent)}%`)
      .join(' \u00b7 ')
  }
  return item.owners ?? ''
}

/** A row's figure, signed if it is owed. One place decides, so a row and the
 *  total under it cannot print the same debt two different ways. */
function balanceMoney(item: { side: string; value: string | number | null }) {
  return item.side === 'liability' ? owedMoney(item.value) : accountMoney.format(Number(item.value ?? 0))
}

/** One asset or liability, as a row of its section's sheet. */
function balanceRow(item: BalanceItemRow) {
  return (
    <DataRow
      key={item.item_id}
      /* Neutral tile, type glyph, and the archive plus a grey when the item is
         closed — the same language a dormant account speaks, and here it also
         says "not in the total below", which is true of both. */
      leading={<BalanceItemTile type={item.item_type} side={item.side} status={item.status} />}
      primary={item.label}
      secondary={[
        ITEM_TYPE_LABEL[item.item_type] ?? item.item_type,
        ownerLine(item),
        /* Only a liability carries this, and only when it is secured. It is
           the one thing on the row that points at another row, so it is
           spelled out rather than implied by an icon. */
        item.secured_against ? `Secured against ${item.secured_against}` : '',
      ]
        .filter(Boolean)
        .join(' \u00b7 ')}
      /* The other half of what separates the columns: a liability's figure is
         signed and a shade lighter than an asset's, so the right-hand column
         reads as what comes off rather than a second list of the same kind. A
         closed row is lighter still on both sides — it is not being counted.

         Deliberately NOT red to match the tile: the figure would then be the
         third mark saying one thing, and red numerals in a column read as an
         error state rather than as a balance-sheet convention. */
      meta={
        item.status !== ITEM_LIVE ? (
          <span className="text-neutral-400">{balanceMoney(item)}</span>
        ) : item.side === 'liability' ? (
          <span className="text-neutral-600">{balanceMoney(item)}</span>
        ) : (
          balanceMoney(item)
        )
      }
    />
  )
}

/**
 * What a section's total leaves out, or nothing.
 *
 * A total that quietly drops rows is worse than no total at all — the rule the
 * accounts footer already follows, and it matters more here because a closed
 * row is still sitting in the list above the figure that excludes it.
 */
function closedNote(rows: BalanceItemRow[]): string | undefined {
  const closed = rows.filter((r) => r.status !== ITEM_LIVE).length
  if (closed === 0) return undefined
  return `${closed} closed item${closed === 1 ? '' : 's'} excluded`
}

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

/* `AccountRow` and `PolicyRow` moved to the list components on 16 September,
   because that is where the fields are now read. The page's job is to fetch
   the rows and hand them over; what a drawer needs from them is the drawer's
   business. */

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

  const [
    { data: memberRows },
    { data: providerRows },
    accountsRes,
    policiesRes,
    balanceRes,
    accountPosts,
    policyPosts,
    staffChoices,
  ] = await Promise.all([
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
    /* One more read on a wave already running. It needs nothing from the
       others, so it costs no depth — the page stays at two waves, which a test
       asserts rather than trusts. */
    supabase.from('group_assets_liabilities').select('*').eq('group_id', groupId).order('label'),
    /* One more read on a wave that is already running, so it costs no depth —
       the same argument the balance sheet made on 14 September, and the depth
       test is exact rather than a ceiling, so a read chained after the wave
       would read 3 and fail. The account drawer's Activity tab renders out of
       this rather than fetching when it opens. */
    getGroupAccountPosts(groupId),
    /* The policy drawer's Activity tab, 19 September — the same argument a
       third time, and the same test holding it. */
    getGroupPolicyPosts(groupId),
    getStaffChoices(),
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
    balance: (balanceRes.data ?? []) as BalanceItemRow[],
    accountPosts,
    policyPosts,
    staffChoices,
    members,
    providers,
  }
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
    balance,
    accountPosts,
    policyPosts,
    staffChoices,
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

  /* The balance sheet, split into the two columns it is shown in and sunk in
     the same way — a sold house belongs under the ones still owned. The totals
     are worked out from `balance` whole, NOT from these two lists: sorting is a
     display decision and arithmetic must not be able to see it. */
  const assetRows = liveFirst(
    balance.filter((b) => b.side === 'asset'),
    (b) => b.status === ITEM_LIVE
  )
  const liabilityRows = liveFirst(
    balance.filter((b) => b.side === 'liability'),
    (b) => b.status === ITEM_LIVE
  )
  const sheet = balanceTotals(balance)
  /* What a new loan can be secured against: assets still held. Offering a sold
     one would create a link the adviser then has to notice is wrong. */
  const securable = balance
    .filter((b) => b.side === 'asset' && b.status === ITEM_LIVE)
    .map((b) => ({ id: b.item_id, label: b.label }))
  /* The bar and the net position both need something on BOTH sides to say
     anything — a bar of one colour, and a net equal to the total above it.
     One boolean, so the two cannot come apart and leave a bar with no net or a
     net with no bar. */
  const bothSides = assetRows.length > 0 && liabilityRows.length > 0
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
                const w = wealthSummary(accounts, balance)
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
            /* A floor under the working area, so a quiet tab does not collapse
               the middle column beside a tall file-notes list, and so the page
               does not jump as tabs are switched. See `WORKING_AREA`. */
            minPanel={WORKING_AREA}
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
                        {accounts.length ? (
                          <AccountList
                            accounts={accounts}
                            members={ownerOptions}
                            groupName={group.name}
                            posts={accountPosts}
                            staff={staffChoices}
                            /* `manage_staff` is what current_staff_has('admin')
                               reads, the same question the database asks. An
                               account post carries no images, so this only ever
                               says no here — sent for one shape across feeds. */
                            viewer={{
                              id: staff.id,
                              name: staff.full_name,
                              canRemoveAnyImage: staff.access_profiles.manage_staff,
                            }}
                          />
                        ) : undefined}
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
                      {policies.length ? (
                        <PolicyList
                          policies={policies}
                          members={ownerOptions}
                          groupName={group.name}
                          posts={policyPosts}
                          staff={staffChoices}
                          viewer={{
                            id: staff.id,
                            name: staff.full_name,
                            canRemoveAnyImage: staff.access_profiles.manage_staff,
                          }}
                        />
                      ) : undefined}
                    </DataSection>
                  </div>
                ),
              },
              {
                id: 'assets-liabilities',
                label: 'Assets + Liabilities',
                panel: (
                  <div className="flex flex-col gap-6">
                    {/* The shape of the sheet first, then the two lists that
                        make it up, then the net at the foot — which is also the
                        order it is read in. The bar spent the morning of
                        14 September above the net position and then inside it;
                        neither worked, for the reason written on the component:
                        wedged between a label and a figure it gets whatever
                        width is left. Full width under the tabs, it is the
                        first thing this tab says. */}
                    {bothSides ? <BalanceBar totals={sheet} /> : null}

                    {/* Owned on the left, owed on the right — and the side is
                        carried by the rows themselves as well as by the column
                        they sit in: a liability's tile is light red where an
                        asset's is neutral, and its figure is signed. Two marks,
                        because a column heading is a poor thing to make a
                        reader hold in their head while scanning.
                        `BALANCE_SPLIT` rather than `TAB_SPLIT`: these two
                        columns are peers and split evenly, where the accounts
                        tab is a list beside a chart at 65/35. */}
                    <div className={BALANCE_SPLIT}>
                      <DataSection
                        title="Assets"
                        addLabel="Add asset"
                        action={
                          <AddBalanceItemModal
                            side="asset"
                            owners={ownerOptions}
                            providers={providers}
                            triggerVariant="quiet"
                          />
                        }
                        emptyAction={
                          <AddBalanceItemModal
                            side="asset"
                            owners={ownerOptions}
                            providers={providers}
                          />
                        }
                        empty={{
                          title: 'No assets yet',
                          description:
                            'Property, cash, vehicles and anything else this group\u2019s members own outright.',
                        }}
                        total={
                          assetRows.length
                            ? {
                                label: 'Total assets',
                                value: accountMoney.format(sheet.assets),
                                note: closedNote(assetRows),
                              }
                            : undefined
                        }
                      >
                        {assetRows.length ? assetRows.map(balanceRow) : undefined}
                      </DataSection>

                      <DataSection
                        title="Liabilities"
                        addLabel="Add liability"
                        action={
                          <AddBalanceItemModal
                            side="liability"
                            owners={ownerOptions}
                            providers={providers}
                            securable={securable}
                            triggerVariant="quiet"
                          />
                        }
                        emptyAction={
                          <AddBalanceItemModal
                            side="liability"
                            owners={ownerOptions}
                            providers={providers}
                            securable={securable}
                          />
                        }
                        empty={{
                          title: 'No liabilities yet',
                          description:
                            'Loans, credit and anything else this group\u2019s members owe.',
                        }}
                        total={
                          liabilityRows.length
                            ? {
                                label: 'Total liabilities',
                                value: owedMoney(sheet.liabilities),
                                note: closedNote(liabilityRows),
                              }
                            : undefined
                        }
                      >
                        {liabilityRows.length ? liabilityRows.map(balanceRow) : undefined}
                      </DataSection>
                    </div>

                    {/* What neither column can state, under both of them
                        rather than inside either: the SHAPE of the sheet, then
                        the subtraction. Putting either in a column would make
                        it look like that column's total.

                        Shown only once there is something on both sides —
                        assets with no debts against them have a net position
                        equal to the total above it, and a bar of one colour,
                        which between them say nothing twice. */}
                    {bothSides ? (
                      <div className="flex items-baseline justify-between gap-3 rounded-lg border border-neutral-200 bg-white px-4 py-3 shadow-[0_1px_2px_rgb(0_0_0/0.05)]">
                        <span className="text-xs font-semibold uppercase tracking-wider text-neutral-500">
                          Net position
                        </span>
                        <span className="text-[17px] font-bold tabular-nums text-neutral-900">
                          {accountMoney.format(sheet.net)}
                        </span>
                      </div>
                    ) : null}
                  </div>
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
