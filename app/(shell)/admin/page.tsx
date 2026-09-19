import { notFound, redirect } from 'next/navigation'
import { AuditTrail } from '@/components/audit-trail'
import { StaffList } from '@/components/staff-list'
import { Tabs } from '@/components/tabs'
import { Card, PageHeading, WORKING_AREA } from '@/components/ui'
import { AUDIT_PAGE_SIZE, getAccessProfiles, getAuditActors, getAuditEntries, getStaffForAdmin, isAdmin } from '@/lib/admin'
import { getCurrentStaff } from '@/lib/staff'

export const metadata = { title: 'Administration · Q Wealth CRM' }

/**
 * The Administration page: one page, tabs, for the people allowed to change
 * things. Asked for on 19 September; the first tab is the audit trail, the
 * second is staff management, and more will follow as tabs rather than pages.
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

  const [page, actors, staffRows, profiles] = await Promise.all([
    getAuditEntries({ limit: AUDIT_PAGE_SIZE }),
    getAuditActors(),
    getStaffForAdmin(),
    getAccessProfiles(),
  ])

  /* Derived from the rows already in the wave, not a second count query. */
  const pending = staffRows.filter((s) => s.status === 'pending').length

  return (
    <>
      <PageHeading
        eyebrow="Administration"
        title="Administration"
        description="Who changed what, who works here, and who may sign in. Administrators only."
      />

      <Card className="col-span-full">
        <Tabs
          ground
          minPanel={WORKING_AREA}
          label="Administration"
          items={[
            {
              id: 'audit',
              label: 'Audit trail',
              panel: <AuditTrail initial={page.entries} initialHasMore={page.hasMore} actors={actors} />,
            },
            {
              id: 'staff',
              label: pending > 0 ? `Staff (${pending} awaiting approval)` : 'Staff',
              panel: <StaffList staff={staffRows} profiles={profiles} viewer={{ id: staff.id }} />,
            },
          ]}
        />
      </Card>
    </>
  )
}
