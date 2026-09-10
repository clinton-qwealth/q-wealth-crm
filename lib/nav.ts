/**
 * The top bar's destinations, and the rule for deciding which one you are on.
 *
 * Both live here rather than in the component for one reason each. The items,
 * so `no-dead-links` can import them and prove every destination is a real
 * route — that test matches `href="/…"` as literal source text, so a list
 * rendered as `href={item.href}` was invisible to it. The matcher, because it
 * is the part most likely to be quietly wrong, and a pure function is testable
 * without rendering anything. The same split, for the same reason, as
 * `mapComponents` in `lib/address.ts`.
 */
export const NAV_ITEMS = [
  { href: '/', label: 'Home' },
  { href: '/workflows', label: 'Workflows' },
  { href: '/reports', label: 'Reports' },
] as const

/**
 * Is `href` the nav destination the reader is currently inside?
 *
 * **A child route keeps its parent lit.** `/workflows/abc-1` is still
 * Workflows, and that is not a hypothetical — the workflow detail page is
 * reached from a card on the board, so a plain equality test would drop the
 * highlight at exactly the moment somebody has drilled in.
 *
 * **The trailing slash is the whole trick, and it does two jobs.** Matching
 * `${href}/` is a path SEGMENT test rather than a string prefix, so it will not
 * light Workflows on some future `/workflowsomething` — and it is also what
 * makes the root behave, because `${href}/` for `/` is `//` and no pathname
 * begins with that. So Home matches only `/`, with no special case for it.
 *
 * That special case WAS written, as an `if (href === '/')` guard, and it was
 * dead code: removing it left every test passing, which is how it was found.
 * `startsWith(href)` would genuinely need the guard. `startsWith(href + '/')`
 * does not, and the root's behaviour is pinned by a test either way.
 *
 * A query string needs no handling: `/groups?id=…` is how a group is selected,
 * and `usePathname()` returns the path without the query.
 */
export function isCurrentNavItem(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`)
}
