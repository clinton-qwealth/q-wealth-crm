import { describe, expect, test } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

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
})
