import { beforeEach, describe, expect, test, vi } from 'vitest'

/**
 * `getVisibleGroups()` — the one query behind the groups index.
 *
 * The point of this file is the failure path. **A discarded query `error` turns
 * a broken page into one that lies**, and "no client groups" is a sentence an
 * adviser would believe: they would go and ask an administrator why their
 * clients had been reassigned. That lesson cost a silently empty activity feed
 * on 8 September, so the loader throws and this is what says so.
 */
let RESULT: { data: unknown; error: { message: string } | null } = { data: [], error: null }
const calls: { table: string; columns: string; ordered: string[] }[] = []

vi.mock('next/headers', () => ({ cookies: async () => ({ getAll: () => [], set: () => {} }) }))
vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: async () => ({
    from: (table: string) => {
      const record = { table, columns: '', ordered: [] as string[] }
      calls.push(record)
      const chain = {
        select: (columns: string) => {
          record.columns = columns
          return chain
        },
        order: (column: string) => {
          record.ordered.push(column)
          return chain
        },
        then: (res: (v: typeof RESULT) => unknown, rej: (e: unknown) => unknown) =>
          Promise.resolve(RESULT).then(res, rej),
      }
      return chain
    },
  }),
}))

const { getVisibleGroups } = await import('@/lib/groups')

beforeEach(() => {
  calls.length = 0
  RESULT = { data: [], error: null }
})

describe('getVisibleGroups', () => {
  test('reads the group view, ordered by name, in one query', async () => {
    RESULT = { data: [{ group_id: 'g1', name: 'A' }], error: null }
    await getVisibleGroups()

    expect(calls).toHaveLength(1)
    expect(calls[0].table).toBe('group_summary')
    /* Ordering belongs in the query, not the component — one source of truth,
       and a stable list between renders. */
    expect(calls[0].ordered).toEqual(['name'])
  })

  /**
   * Only the columns the list shows. `group_summary` also rolls up every
   * member's NAME into a `members` string; asking for it would carry every
   * member of every group across the wire to render a count.
   */
  test('asks for only what the list renders, and not the rolled-up member names', async () => {
    await getVisibleGroups()
    const columns = calls[0].columns.split(',').map((c) => c.trim())
    expect(columns).toEqual([
      'group_id',
      'name',
      'group_type',
      'status',
      'member_count',
      'primary_contact',
    ])
    expect(columns).not.toContain('members')
  })

  /** The whole reason this file exists. */
  test('THROWS on a query error rather than reporting an empty list', async () => {
    RESULT = { data: null, error: { message: 'permission denied for view group_summary' } }
    await expect(getVisibleGroups()).rejects.toThrow(/could not be read/)
    // And the database's own words survive, rather than a generic failure.
    await expect(getVisibleGroups()).rejects.toThrow(/permission denied/)
  })

  test('a genuinely empty result is an empty list, not a throw', async () => {
    RESULT = { data: [], error: null }
    await expect(getVisibleGroups()).resolves.toEqual([])
  })

  test('a null payload with no error is an empty list', async () => {
    RESULT = { data: null, error: null }
    await expect(getVisibleGroups()).resolves.toEqual([])
  })
})
