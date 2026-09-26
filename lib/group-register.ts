import type { GroupListItem } from '@/lib/groups'

/**
 * The register's narrowing rules — search, status filter, sort — as pure
 * functions, for the same reason `lib/parking-report.ts` holds that page's:
 * the state lives in a client component, and logic in a component can only be
 * tested through a renderer. These run on rows the server already sent; no
 * query re-runs when a filter changes.
 */
export type GroupSortId = 'name_asc' | 'name_desc' | 'members_desc'

export const GROUP_SORTS: { id: GroupSortId; label: string }[] = [
  { id: 'name_asc', label: 'Name A–Z' },
  { id: 'name_desc', label: 'Name Z–A' },
  { id: 'members_desc', label: 'Most members' },
]

/** Every status present in the rows, actives first — derived, never hard-coded,
 *  so a status added in the database is filterable the day it appears. */
export function statusesOf(groups: GroupListItem[]): string[] {
  const seen = [...new Set(groups.map((g) => g.status))]
  return seen.sort((a, b) => (a === 'active' ? -1 : b === 'active' ? 1 : a.localeCompare(b)))
}

/**
 * Case-insensitive substring over the two columns a person would type from
 * memory: the group's name and the primary contact's. NOT the type or status —
 * those have their own controls, and a search that also matched "household"
 * would light every row.
 */
export function narrowGroups(
  groups: GroupListItem[],
  by: { q: string; status: string },
): GroupListItem[] {
  const q = by.q.trim().toLowerCase()
  return groups.filter((g) => {
    if (by.status !== 'all' && g.status !== by.status) return false
    if (!q) return true
    return (
      g.name.toLowerCase().includes(q) ||
      (g.primary_contact ?? '').toLowerCase().includes(q)
    )
  })
}

/** A new array, sorted — never a mutation of the server's rows, which other
 *  renders may still be holding. */
export function sortGroups(groups: GroupListItem[], sort: GroupSortId): GroupListItem[] {
  const rows = [...groups]
  switch (sort) {
    case 'name_asc':
      return rows.sort((a, b) => a.name.localeCompare(b.name))
    case 'name_desc':
      return rows.sort((a, b) => b.name.localeCompare(a.name))
    case 'members_desc':
      /* Ties fall back to name, so the order is total and stable across
         renders rather than whatever the input happened to be. */
      return rows.sort(
        (a, b) => (b.member_count ?? 0) - (a.member_count ?? 0) || a.name.localeCompare(b.name),
      )
  }
}
