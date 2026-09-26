import { notFound, redirect } from 'next/navigation'
import { getCurrentStaff } from '@/lib/staff'
import { getProviderKinds, getServiceProviders, getVisibleGroups } from '@/lib/groups'
import { resolveGroupSection, type GroupSectionId } from '@/lib/group-sections'
import { GroupRegister } from '@/components/group-register'
import { GroupsNav } from '@/components/groups-nav'
import { ProviderRegister } from '@/components/provider-register'
import { RegisterHeader } from '@/components/register-header'
import { NewGroupForm, NewProviderForm } from '@/components/register-create'
import { Card } from '@/components/ui'

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
      {/* Left — the rail. The faint frosted panel is what says "this column is
          chrome": one translucent surface over the page artwork, running the
          full row height, so the menu reads as a sidebar rather than as a
          stack of floating links. `backdrop-blur` is safe HERE because the
          panel is static — the cursor trouble this page's history warns about
          came from surfaces that transition, and this one never does.

          THE BOTTOM STOPS A GUTTER SHORT OF THE SCREEN, matching the top —
          revised 26 Sep from a flush-to-the-edge version the same day. The
          rail is as tall as the row, and the row is only as tall as the
          content, so on a short register it stopped mid-screen; the minimum
          height is what fixes that. The arithmetic: 100dvh minus the 48px bar,
          minus the main's 28px top padding, minus its 28px bottom padding is
          `calc(100dvh - 6.5rem)` — the panel then ends exactly where the
          page's own bottom gutter begins, the same breathing room it gets at
          the top, and keeps all four rounded corners. */}
      <div className="col-span-full h-fit rounded-xl bg-white/40 p-2 ring-1 ring-neutral-200/60 backdrop-blur-sm lg:col-span-3 lg:h-full lg:min-h-[calc(100dvh-6.5rem)] xl:col-span-2">
        <GroupsNav current={section.id} />
      </div>

      {/* Centre — the header, then the register. ONE key remounts both, so a
          section change replays both entrances — but they move differently,
          asked 26 Sep: the header fades IN PLACE, words appearing where words
          were, while the content below it rises. A title that travelled read
          as the whole page lurching; a list that only faded read as a repaint
          rather than an arrival. Same clock, two treatments. */}
      <div className="col-span-full lg:col-span-6 xl:col-span-7">
        <div key={section.id}>
          <div className="qw-fade-in">
            <RegisterHeader
              trail={[{ label: 'Q Wealth CRM', href: '/' }, { label: 'Groups' }]}
              title={section.label}
            />
          </div>
          <div className="qw-section-in">
            <Card>{panel}</Card>
          </div>
        </div>
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
        <GroupRegister
          groups={groups}
          noun={['household', 'households']}
          action={<NewGroupForm groupType="household" triggerVariant="quiet" />}
          empty={{
            title: 'No client households to show',
            body: 'You see the households you own or have been given access to. If you expect one here, ask an administrator to check who it is assigned to.',
            action: <NewGroupForm groupType="household" />,
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
        <GroupRegister
          groups={groups}
          noun={['entity', 'entities']}
          action={<NewGroupForm groupType="business_entity" triggerVariant="quiet" />}
          empty={{
            title: 'No entities or structures to show',
            body: 'Companies, trusts and other structures you look after appear here. You see the ones you own or have been given access to.',
            action: <NewGroupForm groupType="business_entity" />,
          }}
        />
      )
    }

    case 'providers': {
      /* Two reads, one wave: the register and the kinds that dress it. */
      const [providers, kinds] = await Promise.all([getServiceProviders(), getProviderKinds()])
      return (
        <ProviderRegister
          providers={providers.map((p) => ({ ...p, kinds: kinds.get(p.party_id) ?? [] }))}
          action={<NewProviderForm triggerVariant="quiet" />}
          empty={{
            title: 'No service providers recorded',
            body: 'A provider is a platform, insurer or fund manager the firm deals with. The register is firm-wide.',
            action: <NewProviderForm />,
          }}
        />
      )
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
