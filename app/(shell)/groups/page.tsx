import { redirect } from 'next/navigation'
import { getCurrentStaff } from '@/lib/staff'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { Card, PageHeading, Pill } from '@/components/ui'
import { PhoneIcon, PlusIcon } from '@/components/icons'
import { DataRow, DataSection } from '@/components/data-section'
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
 * The primary contact's best phone number.
 *
 * `group_summary` carries the contact's name but not their id, so the party has
 * to be reached through client_groups first. Preference order is the contact's
 * own `is_preferred` flag, then a mobile over any other number — ringing a
 * mobile is more likely to reach someone than an office line.
 */
async function getPrimaryContactPhone(groupId: string) {
  const supabase = await createSupabaseServerClient({ writable: false })

  const { data: group } = await supabase
    .from('client_groups')
    .select('primary_contact_party_id')
    .eq('id', groupId)
    .maybeSingle()

  const partyId = group?.primary_contact_party_id
  if (!partyId) return null

  const { data: phones } = await supabase
    .from('contact_points')
    .select('kind, value, is_preferred')
    .eq('party_id', partyId)
    .in('kind', ['phone_mobile', 'phone_other'])

  if (!phones?.length) return null

  const best =
    phones.find((p) => p.is_preferred && p.kind === 'phone_mobile') ??
    phones.find((p) => p.is_preferred) ??
    phones.find((p) => p.kind === 'phone_mobile') ??
    phones[0]

  return (best?.value as string | null) ?? null
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
  const phone = group ? await getPrimaryContactPhone(group.group_id) : null
  const members = parseMembers(group?.members ?? null)

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
                  /* Populated layout shown with placeholder rows so both states
                     can be compared. No account tables exist in the schema yet. */
                  <DataSection
                    addLabel="Add account"
                    countLabel="2 accounts"
                    empty={{
                      title: 'No accounts yet',
                      description:
                        'Superannuation, investment and bank accounts held by this group.',
                    }}
                  >
                    <ul className="flex flex-col gap-1.5">
                      <DataRow
                        primary="Example superannuation account"
                        secondary="Placeholder row — no account data exists yet"
                        meta="—"
                      />
                      <DataRow
                        primary="Example investment account"
                        secondary="Placeholder row — no account data exists yet"
                        meta="—"
                      />
                    </ul>
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
                id: 'detail',
                label: 'Detail',
                panel: <Placeholder>Group detail, contacts and relationships</Placeholder>,
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
