import { describe, expect, test } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { ADMIN_SECTIONS } from '@/lib/admin-sections'
import { GROUP_SECTIONS } from '@/lib/group-sections'
import { ACCOUNT_MENU_ITEMS, ADMIN_MENU_ITEM, NAV_ITEMS } from '@/lib/nav'

/**
 * Every internal link must point at a route that exists.
 *
 * The "?" in the top bar pointed at /help for weeks before the route existed.
 * Nothing failed loudly: the page still rendered, the build still passed, and
 * the only evidence was a 404 on the RSC prefetch in the network tab — which is
 * how it was eventually spotted. A link is not typechecked against the router,
 * so it gets checked here instead.
 */
function walk(dir: string, out: string[] = []) {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) walk(path, out)
    else out.push(path)
  }
  return out
}

const files = [...walk('app'), ...walk('components')].filter((f) => /\.tsx?$/.test(f))

/** app/(shell)/groups/page.tsx -> /groups. Route groups are not path segments. */
const routes = new Set(
  files
    .filter((f) => /\/page\.tsx$/.test(f))
    .map((f) =>
      '/' +
      f
        .replace(/^app\/?/, '')
        .replace(/\/?page\.tsx$/, '')
        .split('/')
        .filter((seg) => seg && !seg.startsWith('('))
        .join('/'),
    ),
)

describe('internal links', () => {
  test('the routes on disk are the ones expected', () => {
    // A guard on the guard: if this parses nothing, the test below passes vacuously.
    expect(routes.has('/')).toBe(true)
    expect(routes.has('/groups')).toBe(true)
    expect(routes.size).toBeGreaterThanOrEqual(8)
  })

  test('every href points at a route that exists', () => {
    const dead: string[] = []
    for (const file of files) {
      const source = readFileSync(file, 'utf8')
      for (const m of source.matchAll(/href="(\/[^"]*)"/g)) {
        // Query and hash are not part of the route; a dynamic segment is not
        // a literal href and cannot be resolved this way.
        const path = m[1].split(/[?#]/)[0].replace(/\/$/, '') || '/'
        if (path.includes('[')) continue
        if (!routes.has(path)) dead.push(`${path}  (in ${file})`)
      }
    }
    expect(dead).toEqual([])
  })

  /**
   * The nav's own destinations, which the scan above cannot see.
   *
   * It matches `href="/…"` as literal source text, and the top bar renders its
   * links as `href={item.href}` from a list — so the three destinations people
   * actually click were the one set of links with no dead-link cover at all.
   * Importing the list closes that: a mistyped destination now fails here
   * rather than 404-ing in the bar.
   */
  test('every top-nav destination points at a route that exists', () => {
    expect(NAV_ITEMS.length).toBeGreaterThan(0)
    for (const { href } of NAV_ITEMS) {
      expect(routes.has(href), `${href} is in the top nav but is not a route`).toBe(true)
    }
  })

  /* The account menu renders its links the same way, from a list — and since
     19 September that list has a destination only administrators see, so a
     dead one would be found by exactly the people least likely to report it. */
  test('every account-menu destination points at a route that exists', () => {
    for (const { href } of [...ACCOUNT_MENU_ITEMS, ADMIN_MENU_ITEM]) {
      expect(routes.has(href), `${href} is in the account menu but is not a route`).toBe(true)
    }
  })

  /* The Administration menu, 24 Sep 2026, rendered from a list the same way.
     Its hrefs carry a `?section=` query, which is not part of the route — the
     scan above strips it, and so does this. */
  test('every Administration section points at a route that exists', () => {
    expect(ADMIN_SECTIONS.length).toBeGreaterThan(0)
    for (const { href } of ADMIN_SECTIONS) {
      const path = href.split(/[?#]/)[0]
      expect(routes.has(path), `${href} is on the Administration menu but is not a route`).toBe(true)
    }
  })

  /* The client menu, 25 Sep 2026, rendered from a list the same way. */
  test('every client section points at a route that exists', () => {
    expect(GROUP_SECTIONS.length).toBeGreaterThan(0)
    for (const { href } of GROUP_SECTIONS) {
      const path = href.split(/[?#]/)[0]
      expect(routes.has(path), `${href} is on the client menu but is not a route`).toBe(true)
    }
  })
})
