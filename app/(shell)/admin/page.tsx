import { notFound, redirect } from 'next/navigation'
import { AdminNav } from '@/components/admin-nav'
import { AuditTrail } from '@/components/audit-trail'
import { StaffList } from '@/components/staff-list'
import { Tabs, type TabItem } from '@/components/tabs'
import { TemplateList } from '@/components/template-list'
import { Card, WORKING_AREA } from '@/components/ui'
import { UserGroupList } from '@/components/user-group-list'
import { WorkflowRoleList } from '@/components/workflow-role-list'
import {
  AUDIT_PAGE_SIZE,
  getAccessProfiles,
  getAuditActors,
  getAuditEntries,
  getStaffForAdmin,
  getTemplatesForAdmin,
  getUserGroupsForAdmin,
  getWorkflowRoles,
  isAdmin,
} from '@/lib/admin'
import { resolveAdminSection, type AdminSectionId } from '@/lib/admin-sections'
import { getCurrentStaff } from '@/lib/staff'
import { fullName } from '@/lib/staff-name'

export const metadata = { title: 'Administration · Q Wealth CRM' }

/**
 * The Administration page: a menu of sections on the left, and the chosen
 * section's tabs in the middle. For the people allowed to change things.
 *
 * ## The menu, since 24 September 2026
 *
 * Until then this was one card of five tabs, and the left column was reserved.
 * Clinton asked for a vertical menu there, with the tabs regrouped beneath it:
 *
 *   User management       Users · User groups
 *   Workflow management   Templates · Roles
 *   Observability         Audit trail
 *
 * The sections are `ADMIN_SECTIONS` in `lib/admin-sections.ts`, which is where
 * the menu grows. The chosen one travels in the URL as `?section=`, because a
 * menu is navigation and navigation here is links — see that file for why.
 *
 * ## Three columns since 20 September, matching the group page
 *
 * The group page's 3 / 6 / 3 split over the shell's twelve-column grid at
 * `lg`, so the two pages an administrator moves between do not rearrange
 * themselves. From `xl` the menu narrows to 2 / 7 / 3 — asked for on
 * 25 September: three short labels do not need a quarter of a wide screen,
 * and the working area takes what they give up. Only at `xl`, because at
 * `lg` a two-column track is about 145px, which "Workflow management" does
 * not fit on one line.
 *
 * The left column holds the menu, bare — a `Card` around it read as a second
 * record beside the tabs, see `AdminNav`. The right is **still deliberately
 * empty**: Clinton asked for the shape first and will decide what goes in it.
 * Nothing is rendered there, and the working area sits in the middle where
 * the group page's does.
 *
 * ## The gate comes before the wave
 *
 * `isAdmin` is `manage_staff`, the same flag `audit_log`'s own read policy
 * checks, so the page and the rows agree. It is checked with the staff row
 * the layout already fetched, so a non-administrator spends no round trip on
 * queries that RLS would return empty anyway — and answers `notFound()`, the
 * house rule: a route you may not use is indistinguishable from one that does
 * not exist. A section that does not exist gets the same answer, also before
 * any query.
 *
 * ## One wave, and only the section's own
 *
 * Each section issues its reads together in a single `Promise.all` — the
 * round-trip test asserts depth 1 exactly — and issues ONLY its own. Before
 * the menu, every visit to `/admin` paid for all seven reads, the audit
 * trail's two among them, because the page could not know which tab would be
 * opened. Now it knows, and someone here to approve a user no longer waits on
 * the audit log to do it. A later tab joins its section's `Promise.all`, never
 * a second `await`.
 */
export default async function AdminPage(
  { searchParams }: { searchParams?: Promise<{ section?: string | string[] }> } = {},
) {
  const staff = await getCurrentStaff()
  if (!staff) redirect('/login')
  if (!isAdmin(staff)) notFound()

  const section = resolveAdminSection((await searchParams)?.section)
  if (!section) notFound()

  const tabs = await sectionTabs(section.id, staff.id)

  return (
    <>
      {/* No heading block, since 25 September: the top bar's Administration
          pill names the AREA and the menu's mark names the SECTION, so a
          full-width heading restating both only pushed the work down the page.
          The h1 stays for whoever navigates by headings — a page without one
          has no anchor to jump to — it just spends no pixels. `sr-only` is
          absolutely positioned, so it adds no row to the grid. */}
      <h1 className="sr-only">{section.label}</h1>

      {/* Left — the rail, on the same faint frosted panel as the client
          pages', so the two sectioned screens keep reading as one design. The
          notes on the panel — why blur is safe on a STATIC surface — are on
          /groups. */}
      <div className="col-span-full h-fit rounded-xl bg-white/40 p-2 ring-1 ring-neutral-200/60 backdrop-blur-sm lg:col-span-3 lg:h-full xl:col-span-2">
        <AdminNav current={section.id} />
      </div>

      {/* Centre — the working area */}
      <div className="col-span-full lg:col-span-6 xl:col-span-7">
        <Card>
          {/* KEYED BY SECTION, and the key does two jobs.

              `Tabs` keeps its selected tab in state, so without a remount the
              same instance would survive a move from Workflow management to
              User management still believing "templates" is selected — a tab
              set with nothing selected and no panel showing.

              And a CSS animation runs on MOUNT, not on a prop change, so the
              remount is also what replays `qw-section-in`. The menu's mark
              moves on the click and the content lands a round trip later; the
              fade is what joins the two. Inside the card, not around it —
              fading the border and shadow would read as the card blinking. */}
          <div key={section.id} className="qw-section-in">
            <Tabs
              ground
              /* A floor under the working area, so switching to a quiet tab
                 does not collapse the middle column. Same reasoning as the
                 group page's. */
              minPanel={WORKING_AREA}
              label="Administration"
              items={tabs}
            />
          </div>
        </Card>
      </div>

      {/* Right — reserved. See the note above. */}
      <div className="col-span-full lg:col-span-3" />
    </>
  )
}

/**
 * The tabs a section shows, with their data loaded — every read for the
 * section in ONE `Promise.all`, and none for any other section.
 *
 * A `switch` with no `default`, on purpose: `AdminSectionId` is a closed union,
 * so adding a section to `ADMIN_SECTIONS` without a case here is a type error
 * rather than a blank page.
 */
async function sectionTabs(section: AdminSectionId, viewerId: string): Promise<TabItem[]> {
  switch (section) {
    case 'users': {
      const [staffRows, profiles, userGroups] = await Promise.all([
        getStaffForAdmin(),
        getAccessProfiles(),
        getUserGroupsForAdmin(),
      ])
      /* Derived from the rows already in the wave, not a second count query. */
      const pending = staffRows.filter((s) => s.status === 'pending').length
      /* The members picker offers active people only; derived from the same rows. */
      const staffChoices = staffRows
        .filter((s) => s.status === 'active')
        .map((s) => ({ id: s.id, name: fullName(s) }))

      return [
        {
          id: 'staff',
          label: pending > 0 ? `Users (${pending} awaiting approval)` : 'Users',
          panel: (
            <StaffList
              staff={staffRows}
              profiles={profiles}
              userGroups={userGroups.map((g) => ({ id: g.id, name: g.name, status: g.status }))}
              viewer={{ id: viewerId }}
            />
          ),
        },
        {
          id: 'user-groups',
          label: 'User groups',
          panel: <UserGroupList groups={userGroups} staff={staffChoices} />,
        },
      ]
    }

    case 'workflows': {
      const [templates, workflowRoles] = await Promise.all([getTemplatesForAdmin(), getWorkflowRoles()])
      return [
        {
          id: 'templates',
          label: 'Templates',
          panel: <TemplateList templates={templates} />,
        },
        /* Roles after Templates, because it holds the names a template picks
           from — and here rather than inside a template's editor because the
           list is the firm's, shared by every template. */
        {
          id: 'workflow-roles',
          label: 'Roles',
          panel: <WorkflowRoleList roles={workflowRoles} />,
        },
      ]
    }

    case 'observability': {
      const [page, actors] = await Promise.all([getAuditEntries({ limit: AUDIT_PAGE_SIZE }), getAuditActors()])
      return [
        {
          id: 'audit',
          label: 'Audit trail',
          panel: <AuditTrail initial={page.entries} initialHasMore={page.hasMore} actors={actors} />,
        },
      ]
    }
  }
}
