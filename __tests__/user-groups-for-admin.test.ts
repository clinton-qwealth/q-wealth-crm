import { beforeEach, describe, expect, test, vi } from 'vitest'

/**
 * `getUserGroupsForAdmin` — the User groups tab's one read.
 *
 * Members and the household count both arrive as embeds on the same select,
 * so the tab costs the admin page no extra round trip. What is worth pinning
 * is the flattening: members named by the house rule, both embed shapes
 * tolerated, the count from an embed of ids (PostgREST serves no aggregate
 * here), and archived groups KEPT — they are reactivated from this list.
 */
const log: string[] = []
let rows: unknown[] = []
let failure: string | null = null

vi.mock('next/headers', () => ({ cookies: async () => ({ getAll: () => [], set: () => {} }) }))
vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: async () => ({
    from: (table: string) => {
      log.push(`from:${table}`)
      const chain: Record<string, unknown> = {}
      chain.select = (cols: string) => {
        log.push(`select:${cols}`)
        return chain
      }
      chain.order = (col: string) => {
        log.push(`order:${col}`)
        return chain
      }
      chain.eq = (col: string, v: unknown) => {
        log.push(`eq:${col}=${String(v)}`)
        return chain
      }
      chain.then = (res: (v: unknown) => unknown) =>
        Promise.resolve(failure ? { data: null, error: { message: failure } } : { data: rows, error: null }).then(res)
      return chain
    },
  }),
}))

const { getUserGroupsForAdmin } = await import('@/lib/admin')

const group = (o: Record<string, unknown> = {}) => ({
  id: 'ug1',
  name: 'North',
  status: 'active',
  created_at: '2026-09-20T00:00:00+00:00',
  user_group_members: [],
  client_groups: [],
  ...o,
})

beforeEach(() => {
  log.length = 0
  rows = [group()]
  failure = null
})

describe('getUserGroupsForAdmin', () => {
  test('reads user_groups once, by name, with members and households embedded', async () => {
    await getUserGroupsForAdmin()
    expect(log.filter((l) => l.startsWith('from:'))).toEqual(['from:user_groups'])
    expect(log).toContain('order:name')
    const select = log.find((l) => l.startsWith('select:'))!
    expect(select).toMatch(/user_group_members\(staff_users\(id, first_name, last_name\)\)/)
    /*
     * THE JUNCTION, NOT `client_groups`. This asserted `client_groups(id)`
     * until 24 Sep 2026 and was wrong in two ways at once, neither of which a
     * mocked client can see.
     *
     * It was AMBIGUOUS: three foreign keys connect user_groups and
     * client_groups, so PostgREST answered 300/PGRST201 and the whole
     * Administration page threw in production.
     *
     * And it counted the wrong thing: nothing writes
     * `client_groups.user_group_id` any more, so even unambiguous it would
     * have read zero for ever.
     *
     * `e2e/postgrest-embeds.spec.ts` is what actually proves the embed
     * resolves — this only pins which relationship we meant.
     */
    expect(select).toMatch(/client_group_user_groups\(group_id\)/)
    expect(select, 'the ambiguous embed must not come back').not.toMatch(/client_groups\(/)
  })

  test('names each member by the house rule and sorts them, tolerating both embed shapes', async () => {
    rows = [
      group({
        user_group_members: [
          { staff_users: { id: 's2', first_name: 'Reece', last_name: 'Testlee' } },
          { staff_users: [{ id: 's1', first_name: 'Sarah', last_name: 'Chen' }] },
          { staff_users: null },
        ],
      }),
    ]
    const [row] = await getUserGroupsForAdmin()
    expect(row!.members).toEqual([
      { id: 's2', name: 'Reece Testlee' },
      { id: 's1', name: 'Sarah Chen' },
    ])
  })

  test('counts households from the embedded ids, and reads zero when the embed is missing', async () => {
    rows = [
      group({ client_group_user_groups: [{ group_id: 'g1' }, { group_id: 'g2' }, { group_id: 'g3' }] }),
      group({ id: 'ug2', name: 'South', client_group_user_groups: undefined }),
    ]
    const out = await getUserGroupsForAdmin()
    expect(out.map((r) => [r.id, r.household_count])).toEqual([
      ['ug1', 3],
      ['ug2', 0],
    ])
  })

  test('an archived group is listed, not filtered', async () => {
    rows = [group({ id: 'ug9', name: 'Old', status: 'archived' })]
    const out = await getUserGroupsForAdmin()
    expect(out.map((r) => [r.id, r.status])).toEqual([['ug9', 'archived']])
    expect(log.some((l) => l.startsWith('eq:status')), 'no status filter on this read').toBe(false)
  })

  test('throws rather than returning an empty list on failure', async () => {
    failure = 'permission denied'
    await expect(getUserGroupsForAdmin()).rejects.toThrow(/permission denied/)
  })
})
