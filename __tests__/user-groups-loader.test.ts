import { beforeEach, describe, expect, test, vi } from 'vitest'

/**
 * `getActiveUserGroups` — the territory picker's options on a household's page.
 *
 * It sits in `lib/groups.ts`, not in `lib/user-groups.ts`: that module is pure
 * vocabulary a CLIENT component imports, and a Supabase import there drags
 * `next/headers` into the browser bundle and fails the build.
 *
 * The one thing that would silently go wrong: offering an archived group. The
 * database refuses to newly assign one, so the filter here is what keeps the
 * picker from offering a refusal.
 */
const log: string[] = []
let failure: string | null = null

vi.mock('next/headers', () => ({ cookies: async () => ({ getAll: () => [], set: () => {} }) }))
vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: async () => ({
    from: (table: string) => {
      log.push(`from:${table}`)
      const chain: Record<string, unknown> = {}
      chain.select = () => chain
      chain.eq = (col: string, v: unknown) => {
        log.push(`eq:${col}=${String(v)}`)
        return chain
      }
      chain.order = (col: string) => {
        log.push(`order:${col}`)
        return chain
      }
      chain.then = (res: (v: unknown) => unknown) =>
        Promise.resolve(
          failure
            ? { data: null, error: { message: failure } }
            : { data: [{ id: 'ug1', name: 'North', status: 'active' }], error: null },
        ).then(res)
      return chain
    },
  }),
}))

const { getActiveUserGroups } = await import('@/lib/groups')

beforeEach(() => {
  log.length = 0
  failure = null
})

describe('getActiveUserGroups', () => {
  test('reads active user groups only, by name', async () => {
    const out = await getActiveUserGroups()
    expect(log).toEqual(['from:user_groups', 'eq:status=active', 'order:name'])
    expect(out).toEqual([{ id: 'ug1', name: 'North', status: 'active' }])
  })

  test('throws rather than returning no territories on failure', async () => {
    failure = 'permission denied'
    await expect(getActiveUserGroups()).rejects.toThrow(/permission denied/)
  })
})
