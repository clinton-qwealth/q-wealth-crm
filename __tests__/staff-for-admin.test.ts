import { beforeEach, describe, expect, test, vi } from 'vitest'

/**
 * `getStaffForAdmin` — the Staff tab's rows, and the one reader in the app that
 * joins two sources by hand.
 *
 * Almost everything about a staff member arrives from one select. **When they
 * were last seen cannot**: it comes from `auth.users` and `auth.sessions`, which
 * PostgREST does not serve, so it is a separate function call that has to be
 * merged onto the rows here. That merge is what this file exists for — three
 * mutations to it survived every other test in the suite.
 */
const log: string[] = []
let staffRows: unknown[] = []
let seenRows: unknown[] = []
let staffError: string | null = null

vi.mock('next/headers', () => ({ cookies: async () => ({ getAll: () => [], set: () => {} }) }))
vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: async () => ({
    from: (table: string) => {
      log.push(`from:${table}`)
      const chain: Record<string, unknown> = {}
      for (const m of ['select', 'order']) chain[m] = () => chain
      chain.then = (res: (v: unknown) => unknown) =>
        Promise.resolve(
          staffError ? { data: null, error: { message: staffError } } : { data: staffRows, error: null },
        ).then(res)
      return chain
    },
    rpc: async (name: string) => {
      log.push(`rpc:${name}`)
      return { data: seenRows, error: null }
    },
  }),
}))

const { getStaffForAdmin } = await import('@/lib/admin')

const person = (o: Record<string, unknown> = {}) => ({
  id: 's1',
  first_name: 'A',
  last_name: 'Adviser',
  title: null,
  email: 'a@qwealth.com.au',
  status: 'active',
  avatar_path: null,
  created_at: '2026-09-01T00:00:00+00:00',
  verify_identity: false,
  staff_private_details: null,
  staff_access_assignments: { profile_id: 'p1', access_profiles: { id: 'p1', name: 'Adviser' } },
  ...o,
})

beforeEach(() => {
  log.length = 0
  staffRows = [person()]
  seenRows = []
  staffError = null
})

describe('getStaffForAdmin', () => {
  test('asks the table and the last-seen function, and names the function exactly', async () => {
    await getStaffForAdmin()
    expect(log).toContain('from:staff_users')
    expect(log).toContain('rpc:staff_last_seen')
  })

  test('puts each person’s last-seen and live session onto their own row', async () => {
    staffRows = [person(), person({ id: 's2', first_name: 'B' })]
    seenRows = [
      { staff_id: 's2', last_seen_at: '2026-09-20T01:08:23+00:00', has_live_session: true },
      { staff_id: 's1', last_seen_at: '2026-09-19T15:20:23+00:00', has_live_session: false },
    ]
    const rows = await getStaffForAdmin()
    /* Keyed by id, NOT by position: the function returns its own order, and
       matching by index would hand one person another's session. */
    expect(rows.map((r) => [r.id, r.last_seen_at, r.signed_in])).toEqual([
      ['s1', '2026-09-19T15:20:23+00:00', false],
      ['s2', '2026-09-20T01:08:23+00:00', true],
    ])
  })

  /**
   * A caller without manage_staff gets zero rows from the function rather than
   * an error — that is how it is written, deliberately. So an absent entry must
   * read as "never seen" and "not signed in", never as a crash and never as a
   * default of true.
   */
  test('somebody the function said nothing about is never-seen and not signed in', async () => {
    seenRows = []
    const [row] = await getStaffForAdmin()
    expect([row!.last_seen_at, row!.signed_in]).toEqual([null, false])
  })

  test('a row the function did not mention is unaffected by one it did', async () => {
    staffRows = [person(), person({ id: 's2' })]
    seenRows = [{ staff_id: 's1', last_seen_at: '2026-09-20T01:00:00+00:00', has_live_session: true }]
    const rows = await getStaffForAdmin()
    expect(rows[1]!.signed_in, 'a live session must not leak onto a colleague').toBe(false)
    expect(rows[1]!.last_seen_at).toBeNull()
  })

  test('the staff read’s own failure is still the one that is reported', async () => {
    staffError = 'permission denied'
    await expect(getStaffForAdmin()).rejects.toThrow(/permission denied/)
  })
})
