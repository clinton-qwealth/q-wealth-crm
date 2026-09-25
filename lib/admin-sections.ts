/**
 * The Administration page's sections — the entries in its left-hand menu, and
 * the rule that turns a `?section=` query into one of them.
 *
 * ## Why a list in `lib/`, not JSX in the component
 *
 * The same reason `NAV_ITEMS` lives in `lib/nav.ts`: `no-dead-links` matches
 * `href="/…"` as literal source text, and a menu rendered as `href={item.href}`
 * from a list is invisible to it unless the list itself is imported. This is
 * also the file to edit when the menu grows — add a row here, give it a tab set
 * in `app/(shell)/admin/page.tsx`, and the nav, the page and the tests all know.
 *
 * ## Why the section is in the URL
 *
 * Asked for on 24 September 2026 as "a vertical nav component … this menu will
 * grow". A menu is navigation, and navigation here renders as links: the group
 * list, the template list and the top bar all do, for the reasons `DataRow`
 * gives — middle-click, ⌘-click, the back button and the address bar. Holding
 * the selection in client state would make `/admin` the only destination, so
 * nobody could send a colleague to the roles list or bookmark the audit trail.
 *
 * It also lets the page load ONLY the section it is showing. Until now `/admin`
 * issued seven reads on every visit, the audit trail's two among them, whether
 * or not anyone would open that tab. With the section known on the server, a
 * visit to User management costs the User management reads and nothing else.
 *
 * ## The first section has a clean href
 *
 * `/admin`, not `/admin?section=users`, so the default destination — the one
 * the account menu already points at — has one spelling rather than two.
 */
/* Labels only, no descriptions: the page stopped rendering a heading block on
   25 September 2026 — the top bar's Administration pill names the area and the
   menu names the section, so a paragraph restating both was the crowding
   Clinton asked to remove. */
export const ADMIN_SECTIONS = [
  {
    id: 'users',
    label: 'User management',
    href: '/admin',
  },
  {
    id: 'workflows',
    label: 'Workflow management',
    href: '/admin?section=workflows',
  },
  {
    id: 'observability',
    label: 'Observability',
    href: '/admin?section=observability',
  },
] as const

export type AdminSection = (typeof ADMIN_SECTIONS)[number]
export type AdminSectionId = AdminSection['id']

/** What `/admin` shows with no `?section=` at all. */
export const DEFAULT_ADMIN_SECTION: AdminSectionId = 'users'

/**
 * Which section a `?section=` value names, or `null` if it names nothing.
 *
 * `null` rather than a fallback to the first section. A typo'd bookmark that
 * silently opened User management would look like the roles had vanished;
 * the page answers `notFound()` instead, the same way it does for a template
 * id that does not exist. Absent is different from wrong: no value at all is
 * the default section, because that is what `/admin` has always meant.
 *
 * Next hands a repeated query key over as an array. Two `?section=` values is
 * not a request this page can honour, so it is treated as wrong, not as
 * "the first one".
 */
export function resolveAdminSection(raw: string | string[] | undefined): AdminSection | null {
  if (raw === undefined) return ADMIN_SECTIONS.find((s) => s.id === DEFAULT_ADMIN_SECTION) ?? null
  if (Array.isArray(raw)) return null
  return ADMIN_SECTIONS.find((s) => s.id === raw) ?? null
}
