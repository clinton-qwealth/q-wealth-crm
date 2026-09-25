import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { getCurrentStaff } from '@/lib/staff'
import {
  getServiceProviders,
  getVisibleGroups,
  type GroupListItem,
  type ServiceProviderItem,
} from '@/lib/groups'
import { resolveGroupSection, type GroupSectionId } from '@/lib/group-sections'
import { GroupsNav } from '@/components/groups-nav'
import { Card, Pill, SHEET } from '@/components/ui'
import { ChevronDownIcon } from '@/components/icons'

const TYPE_LABEL: Record<string, string> = {
  household: 'Household',
  business_entity: 'Business entity',
}

export const metadata = { title: 'Clients · Q Wealth CRM' }

/**
 * The client pages: a menu of registers on the left, the chosen one in the
 * middle. The Administration page's shape, asked for on 25 September 2026,
 * built from the same parts — `SectionNav`, `?section=` in the URL, the
 * `sr-only` h1, the keyed fade — and for the same reasons, which live with
 * those parts rather than being restated here.
 *
 * ## What the sections are
 *
 * Households and entities are ONE list in the database — `group_summary`, the
 * `security_invoker` view that decides visibility — split here by
 * `group_type`. Providers are parties with an active `product_provider` role,
 * listed for the first time anywhere. Referral partners have no data model
 * yet, and that section says so instead of drawing an empty register.
 *
 * ## Each section pays only for itself
 *
 * The same budget rule as `/admin`, held by the same round-trip test: the
 * household and entity sections read the group view once; providers read
 * `party_roles` once; referrers read NOTHING, because there is nothing to
 * read. The gate (a session) runs before any of it, and a section that does
 * not exist answers `notFound()` before a single query.
 */
export default async function GroupsIndexPage(
  { searchParams }: { searchParams?: Promise<{ section?: string | string[] }> } = {},
) {
  const staff = await getCurrentStaff()
  if (!staff) redirect('/login')

  const section = resolveGroupSection((await searchParams)?.section)
  if (!section) notFound()

  const panel = await sectionPanel(section.id)

  return (
    <>
      {/* Invisible on purpose, present on purpose: the anchor for anyone
          navigating by headings, costing no row of the grid. Same call as
          /admin, where the reasoning is written out. */}
      <h1 className="sr-only">{section.label}</h1>

      {/* Left — the menu, on the ground rather than in a card */}
      <div className="col-span-full flex flex-col gap-4 lg:col-span-3 xl:col-span-2">
        <GroupsNav current={section.id} />
      </div>

      {/* Centre — the register. Keyed so a section change remounts it, which
          both resets any state and replays the fade; see /admin. */}
      <div className="col-span-full lg:col-span-6 xl:col-span-7">
        <Card>
          <div key={section.id} className="qw-section-in">
            {panel}
          </div>
        </Card>
      </div>

      {/* Right — reserved, as on /admin. */}
      <div className="col-span-full lg:col-span-3" />
    </>
  )
}

/**
 * The chosen register, with its own reads and nobody else's. A `switch` with
 * no `default`, so a section added to `GROUP_SECTIONS` without a panel here is
 * a type error rather than a blank page.
 */
async function sectionPanel(section: GroupSectionId) {
  switch (section) {
    case 'households': {
      const groups = (await getVisibleGroups()).filter((g) => g.group_type === 'household')
      return (
        <GroupListPanel
          groups={groups}
          noun={['household', 'households']}
          empty={{
            title: 'No client households to show',
            body:
              'You see the households you own or have been given access to. If you expect one here, ask an administrator to check who it is assigned to.',
          }}
        />
      )
    }

    case 'entities': {
      /* NOT `=== 'business_entity'`: everything that is not a household is a
         structure of some kind, so a future group_type — a trust, an SMSF —
         lands here rather than in no section at all. The households filter is
         the exact one; this is the remainder, on purpose. */
      const groups = (await getVisibleGroups()).filter((g) => g.group_type !== 'household')
      return (
        <GroupListPanel
          groups={groups}
          noun={['entity', 'entities']}
          empty={{
            title: 'No entities or structures to show',
            body:
              'Companies, trusts and other structures you look after appear here. You see the ones you own or have been given access to.',
          }}
        />
      )
    }

    case 'providers': {
      const providers = await getServiceProviders()
      return <ProvidersPanel providers={providers} />
    }

    case 'referrers':
      /* No read, because there is nothing to read: no table, no role value.
         Saying so beats an empty register that implies one exists. */
      return (
        <EmptyRegister
          title="Referral partners are not tracked yet"
          body="There is no register behind this section — referral relationships are not yet modelled anywhere in the CRM. When they are, they will live here."
        />
      )
  }
}

/* -------------------------------------------------------------------------- */

/**
 * A register of client groups: the heading row, the sheet, the rows. The same
 * sheet the index drew full-width before the menu arrived — the argument for
 * one sheet over a stack of cards is on the group page and still applies.
 */
function GroupListPanel({
  groups,
  noun,
  empty,
}: {
  groups: GroupListItem[]
  noun: [singular: string, plural: string]
  empty: { title: string; body: string }
}) {
  if (groups.length === 0) return <EmptyRegister title={empty.title} body={empty.body} />

  return (
    <>
      <div className="mb-2.5 flex items-center justify-between gap-3">
        <h2 className="truncate text-xs font-semibold uppercase tracking-wider text-neutral-500">
          Client groups
        </h2>
        <p className="text-xs text-neutral-500">
          {groups.length} {groups.length === 1 ? noun[0] : noun[1]}
        </p>
      </div>

      <div className={SHEET}>
        <ul className="divide-y divide-neutral-200/80">
          {groups.map((g) => (
            <GroupRow key={g.group_id} group={g} />
          ))}
        </ul>
      </div>
    </>
  )
}

/**
 * The provider register. Rows, not links: a provider has no page of its own —
 * the search says the same of its provider hits — so a row that navigated
 * would 404, and a row that pretends to open is worse than one that plainly
 * does not.
 */
function ProvidersPanel({ providers }: { providers: ServiceProviderItem[] }) {
  if (providers.length === 0) {
    return (
      <EmptyRegister
        title="No service providers recorded"
        body="A provider is a party holding an active product-provider role — platforms, insurers, fund managers. They appear here as they are recorded."
      />
    )
  }

  return (
    <>
      <div className="mb-2.5 flex items-center justify-between gap-3">
        <h2 className="truncate text-xs font-semibold uppercase tracking-wider text-neutral-500">
          Service providers
        </h2>
        <p className="text-xs text-neutral-500">
          {providers.length} {providers.length === 1 ? 'provider' : 'providers'}
        </p>
      </div>

      <div className={SHEET}>
        <ul className="divide-y divide-neutral-200/80">
          {providers.map((p) => (
            <li key={p.party_id} className="px-3.5 py-3">
              <span className="block truncate text-sm font-semibold text-neutral-900">{p.name}</span>
              <span className="mt-0.5 block truncate text-xs text-neutral-500">
                {['Service provider', p.since ? `since ${p.since.slice(0, 4)}` : null]
                  .filter(Boolean)
                  .join(' · ')}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </>
  )
}

/** The dashed house treatment for a register that is empty rather than broken —
 *  the same block the old full-width index used, with the words as a prop. */
function EmptyRegister({ title, body }: { title: string; body: string }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-neutral-200 bg-neutral-50/60 px-6 py-10">
      <p className="text-center text-sm font-medium text-neutral-700">{title}</p>
      <p className="mt-1 max-w-sm text-center text-xs leading-relaxed text-neutral-500">{body}</p>
    </div>
  )
}

/**
 * One group in the list.
 *
 * **The whole row is the link**, not just the name. A row that navigates should
 * be clickable across its width — a 120px name inside a 900px row is a target
 * people miss — and there is nothing else on the row to click, so nothing is
 * being swallowed by making it one.
 *
 * **The chevron points right.** The same glyph the file-note and History
 * disclosures use rotated to say "this goes somewhere" rather than "this
 * opens". Decorative: the link's accessible name is the group's name.
 */
function GroupRow({ group }: { group: GroupListItem }) {
  /* Marked only when it is NOT active, the same rule the accounts list follows.
     Most groups are active, so a pill on every row would say nothing; a pill on
     the prospect or the inactive one says something. */
  const marked = group.status !== 'active'
  const members = group.member_count ?? 0

  return (
    <li>
      <Link
        href={`/groups/${group.group_id}`}
        className="flex items-center gap-3 px-3.5 py-3 outline-none transition-colors hover:bg-neutral-50 focus-visible:bg-neutral-50 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand/30"
      >
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <span className="truncate text-sm font-semibold text-neutral-900">{group.name}</span>
            {marked ? <Pill tone="neutral">{group.status}</Pill> : null}
          </span>
          <span className="mt-0.5 block truncate text-xs text-neutral-500">
            {[
              TYPE_LABEL[group.group_type] ?? group.group_type,
              `${members} member${members === 1 ? '' : 's'}`,
              group.primary_contact,
            ]
              .filter(Boolean)
              .join(' · ')}
          </span>
        </span>

        {/* The icon sets its own `aria-hidden`, so nothing is passed here — the
            link's accessible name is the group's name and nothing else. */}
        <ChevronDownIcon className="h-4 w-4 shrink-0 -rotate-90 text-neutral-300" />
      </Link>
    </li>
  )
}
