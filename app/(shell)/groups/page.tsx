import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getCurrentStaff } from '@/lib/staff'
import { getVisibleGroups, type GroupListItem } from '@/lib/groups'
import { PageHeading, Pill, SHEET } from '@/components/ui'
import { ChevronDownIcon } from '@/components/icons'

const TYPE_LABEL: Record<string, string> = {
  household: 'Household',
  business_entity: 'Business entity',
}

/**
 * The client groups INDEX — the list a person picks a group from.
 *
 * Added as a heading and a placeholder on 10 September, when Groups joined the
 * navbar; the list arrived the same day. Choosing one opens `/groups/[id]`,
 * which is the detail page that used to live at this path.
 *
 * **Why this page exists at all.** The detail page was at `/groups?id=` with a
 * fallback to "the first group visible to this staff member", and its own
 * comment said group selection "is not built yet — that belongs with the client
 * list." Putting Groups in the navbar made that the visible gap: a nav item
 * should open a place you choose from, not one arbitrary client's file.
 *
 * **One query, and the database decides the set.** `getVisibleGroups()` reads a
 * `security_invoker` view, so an adviser sees the groups they own or are
 * assigned to. The empty state says that plainly rather than implying the firm
 * has no clients.
 */
export default async function GroupsIndexPage() {
  const staff = await getCurrentStaff()
  if (!staff) redirect('/login')

  const groups = await getVisibleGroups()

  return (
    <>
      <PageHeading
        eyebrow="Clients"
        title="Groups"
        description="The households and business entities you look after."
      />

      <div className="col-span-full">
        {groups.length ? (
          <>
            <div className="mb-2.5 flex items-center justify-between gap-3">
              <h2 className="truncate text-xs font-semibold uppercase tracking-wider text-neutral-500">
                Client groups
              </h2>
              <p className="text-xs text-neutral-500">
                {groups.length} group{groups.length === 1 ? '' : 's'}
              </p>
            </div>

            {/* The ledger's sheet, not a stack of cards — the same object the
                accounts, insurance and file-note lists are. A list of bordered
                boxes reads as one texture however the greys behind it are set;
                that argument is on the Client Groups page and it applies to
                any list of records, including this one. */}
            <div className={SHEET}>
              <ul className="divide-y divide-neutral-200/80">
                {groups.map((g) => (
                  <GroupRow key={g.group_id} group={g} />
                ))}
              </ul>
            </div>
          </>
        ) : (
          /* Not "there are no client groups". An adviser sees the groups they
             own or are assigned to, so an empty list far more often means
             nobody has assigned them any than that the firm has no clients —
             and telling them the wrong one of those sends them to the wrong
             person. Dashed, the house treatment for a screen that is empty
             rather than broken. */
          <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-neutral-200 bg-neutral-50/60 px-6 py-10 text-center">
            <p className="text-sm font-medium text-neutral-700">No client groups to show</p>
            <p className="mt-1 max-w-sm text-xs leading-relaxed text-neutral-500">
              You see the groups you own or have been given access to. If you expect one here,
              ask an administrator to check who it is assigned to.
            </p>
          </div>
        )}
      </div>
    </>
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
