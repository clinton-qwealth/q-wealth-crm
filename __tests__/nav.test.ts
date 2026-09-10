import { describe, expect, test } from 'vitest'
import { NAV_ITEMS, isCurrentNavItem } from '@/lib/nav'

/**
 * The rule for "which nav item am I on", tested without rendering anything.
 *
 * Three of these cases are traps rather than happy paths, and each is here
 * because the obvious implementation gets it wrong: prefix-matching lights Home
 * everywhere, equality-matching loses the highlight on a detail page, and a
 * prefix without a segment boundary lights a sibling whose name merely starts
 * the same way.
 */
describe('isCurrentNavItem', () => {
  test('Home matches only the root, not every path beneath it', () => {
    expect(isCurrentNavItem('/', '/')).toBe(true)
    // The trap: every path begins with '/', so a prefix test lights Home always.
    expect(isCurrentNavItem('/workflows', '/')).toBe(false)
    expect(isCurrentNavItem('/reports', '/')).toBe(false)
    expect(isCurrentNavItem('/groups', '/')).toBe(false)
    expect(isCurrentNavItem('/help', '/')).toBe(false)
  })

  test('a destination matches its own page', () => {
    expect(isCurrentNavItem('/workflows', '/workflows')).toBe(true)
    expect(isCurrentNavItem('/reports', '/reports')).toBe(true)
  })

  /**
   * The case the highlight exists for. The workflow detail page is reached from
   * a card on the board, so somebody who drills in is still "in Workflows" and
   * the bar has to keep saying so.
   */
  test('a child route keeps its parent lit', () => {
    expect(isCurrentNavItem('/workflows/abc-1', '/workflows')).toBe(true)
    expect(isCurrentNavItem('/workflows/abc-1/anything/deeper', '/workflows')).toBe(true)
  })

  /**
   * The segment boundary. `startsWith('/workflows')` alone would light
   * Workflows here, which is the kind of bug that only appears once a
   * similarly-named route is added years later.
   */
  test('a sibling whose name merely starts the same way does not match', () => {
    expect(isCurrentNavItem('/workflowsomething', '/workflows')).toBe(false)
    expect(isCurrentNavItem('/reports-archive', '/reports')).toBe(false)
  })

  /* /groups is IN the bar since 10 September, so it is no longer an example of
     a page outside it. Help and the account pages are. */
  test('a page that is not a nav destination lights nothing', () => {
    for (const { href } of NAV_ITEMS) {
      expect(isCurrentNavItem('/help', href)).toBe(false)
      expect(isCurrentNavItem('/profile', href)).toBe(false)
      expect(isCurrentNavItem('/preferences', href)).toBe(false)
    }
  })

  /**
   * Groups has a child route as of 10 September: /groups is the index and
   * /groups/[id] is a group's file. So the same rule that keeps Workflows lit
   * on a workflow has to keep Groups lit on a group.
   */
  test('Groups stays lit on a group’s own page', () => {
    expect(isCurrentNavItem('/groups', '/groups')).toBe(true)
    expect(isCurrentNavItem('/groups/abc-1', '/groups')).toBe(true)
    expect(isCurrentNavItem('/groups/abc-1', '/workflows')).toBe(false)
    expect(isCurrentNavItem('/groups/abc-1', '/')).toBe(false)
  })

  /** Exactly one, at every route the bar is rendered on. */
  test('no path lights two destinations at once', () => {
    for (const pathname of [
      '/', '/groups', '/groups/abc-1', '/workflows', '/workflows/abc-1', '/reports',
    ]) {
      const lit = NAV_ITEMS.filter(({ href }) => isCurrentNavItem(pathname, href))
      expect(lit).toHaveLength(1)
    }
  })
})
