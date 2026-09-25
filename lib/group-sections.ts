/**
 * The client pages' sections — the entries in the menu on `/groups`, and the
 * rule that turns a `?section=` query into one of them.
 *
 * The same arrangement as `lib/admin-sections.ts`, made on 25 September 2026
 * when Clinton asked for the client side to take the Administration page's
 * shape, and for the same reasons: `no-dead-links` can only see hrefs it can
 * import, the menu is navigation so every entry is a link somebody can
 * bookmark, and a section in the URL lets the page load ONLY what that
 * section shows.
 *
 * What each section IS, in this schema:
 *
 *   - **households / entities** are the two `group_type`s of `client_groups`,
 *     read through the same visibility view and split here — one list in the
 *     database, two doors on the page.
 *   - **providers** are parties holding an active `product_provider` role.
 *     They had no page at all before this: the search finds them and its own
 *     comment says the hit "goes nowhere useful". Now it can go here.
 *   - **referrers** has NO data model yet — no table, no role value. The
 *     section says so honestly rather than drawing an empty list that implies
 *     a register nobody has built.
 */
export const GROUP_SECTIONS = [
  {
    id: 'households',
    label: 'Client households',
    href: '/groups',
  },
  {
    id: 'entities',
    label: 'Legal entities / structures',
    href: '/groups?section=entities',
  },
  {
    id: 'providers',
    label: 'Service providers',
    href: '/groups?section=providers',
  },
  {
    id: 'referrers',
    label: 'Referral partners',
    href: '/groups?section=referrers',
  },
] as const

export type GroupSection = (typeof GROUP_SECTIONS)[number]
export type GroupSectionId = GroupSection['id']

/** What `/groups` shows with no `?section=` at all. */
export const DEFAULT_GROUP_SECTION: GroupSectionId = 'households'

/**
 * Which section a `?section=` value names, or `null` if it names nothing —
 * the same semantics as `resolveAdminSection`, for the same reasons: absent
 * means the default, wrong means not-found rather than a silent fallback, and
 * a repeated key is a request the page will not guess at.
 */
export function resolveGroupSection(raw: string | string[] | undefined): GroupSection | null {
  if (raw === undefined) return GROUP_SECTIONS.find((s) => s.id === DEFAULT_GROUP_SECTION) ?? null
  if (Array.isArray(raw)) return null
  return GROUP_SECTIONS.find((s) => s.id === raw) ?? null
}
