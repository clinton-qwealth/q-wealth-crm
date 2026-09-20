import { notFound, redirect } from 'next/navigation'
import { AuditTrail } from '@/components/audit-trail'
import { StaffList } from '@/components/staff-list'
import { Tabs } from '@/components/tabs'
import { Card, PageHeading, WORKING_AREA } from '@/components/ui'
import { UserGroupList } from '@/components/user-group-list'
import {
  AUDIT_PAGE_SIZE,
  getAccessProfiles,
  getAuditActors,
  getAuditEntries,
  getStaffForAdmin,
  getUserGroupsForAdmin,
  isAdmin,
} from '@/lib/admin'
import { getCurrentStaff } from '@/lib/staff'
import { fullName } from '@/lib/staff-name'

export const metadata = { title: 'Administration · Q Wealth CRM' }

/**
 * The Administration page: one page, tabs, for the people allowed to change
 * things. Asked for on 19 September; more will follow as tabs rather than pages.
 *
 * ## Three columns since 20 September, matching the group page
 *
 * The same 3 / 6 / 9 split over the shell's twelve-column grid, so the two
 * pages an administrator moves between do not rearrange themselves. The
 * flanking columns are **deliberately empty for now** — Clinton asked for the
 * shape first and will decide what goes in them. They are not placeholders
 * pretending to be content: nothing is rendered, and the working area simply
 * sits in the middle where the group page's does.
 *
 * **Users is the first tab**, also since 20 September. It is the one an
 * administrator comes here to use; the audit trail is what they consult when
 * something looks wrong, which is the rarer errand. The tab was called Staff
 * until later that day; the underlying table is still `staff_users`, and that
 * is deliberate — renaming a label is not renaming a schema.
 *
 * **User groups sits between them**, from the evening of the same day: another
 * thing to USE, so it goes with Users rather than after the trail. Territories
 * — a person belongs to many, a household to one; membership grants sight and
 * the toggle on a person restricts it. "User groups" rather than "groups"
 * because a group is already a client household everywhere else here.
 *
 * ## The gate comes before the wave
 *
 * `isAdmin` is `manage_staff`, the same flag `audit_log`'s own read policy
 * checks, so the page and the rows agree. It is checked with the staff row
 * the layout already fetched, so a non-administrator spends no round trip on
 * queries that RLS would return empty anyway — and answers `notFound()`, the
 * house rule: a route you may not use is indistinguishable from one that does
 * not exist.
 *
 * One wave. The round-trip test asserts depth 1 exactly; a later tab's loader
 * joins this `Promise.all`, never a second `await`.
 */
export default async function AdminPage() {
  const staff = await getCurrentStaff()
  if (!staff) redirect('/login')
  if (!isAdmin(staff)) notFound()

  const [page, actors, staffRows, profiles, userGroups] = await Promise.all([
    getAuditEntries({ limit: AUDIT_PAGE_SIZE }),
    getAuditActors(),
    getStaffForAdmin(),
    getAccessProfiles(),
    getUserGroupsForAdmin(),
  ])

  /* Derived from the rows already in the wave, not a second count query. */
  const pending = staffRows.filter((s) => s.status === 'pending').length
  /* The members picker offers active people only; derived from the same rows. */
  const staffChoices = staffRows.filter((s) => s.status === 'active').map((s) => ({ id: s.id, name: fullName(s) }))

  return (
    <>
      <PageHeading
        eyebrow="Administration"
        title="Administration"
        description="Who changed what, who works here, and who may sign in. Administrators only."
      />

      {/* Left — reserved. See the note above. */}
      <div className="col-span-full flex flex-col gap-4 lg:col-span-3" />

      {/* Centre — the working area */}
      <div className="col-span-full lg:col-span-6">
        <Card>
          <Tabs
            ground
            /* A floor under the working area, so switching to a quiet tab does
               not collapse the middle column. Same reasoning as the group
               page's. */
            minPanel={WORKING_AREA}
            label="Administration"
            items={[
              {
                id: 'staff',
                label: pending > 0 ? `Users (${pending} awaiting approval)` : 'Users',
                panel: (
                  <StaffList
                    staff={staffRows}
                    profiles={profiles}
                    userGroups={userGroups.map((g) => ({ id: g.id, name: g.name, status: g.status }))}
                    viewer={{ id: staff.id }}
                  />
                ),
              },
              {
                id: 'user-groups',
                label: 'User groups',
                panel: <UserGroupList groups={userGroups} staff={staffChoices} />,
              },
              {
                id: 'audit',
                label: 'Audit trail',
                panel: <AuditTrail initial={page.entries} initialHasMore={page.hasMore} actors={actors} />,
              },
            ]}
          />
        </Card>
      </div>

      {/* Right — reserved. */}
      <div className="col-span-full lg:col-span-3" />
    </>
  )
}
