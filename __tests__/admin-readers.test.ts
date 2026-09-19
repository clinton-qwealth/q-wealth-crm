import { beforeEach, describe, expect, test, vi } from 'vitest'

/**
 * `getAuditEntries` — the one reader whose arithmetic the page cannot see.
 *
 * `hasMore` is decided by fetching ONE ROW MORE than the page and looking at
 * whether it arrived; drop the `+ 1` and every page claims to be the last.
 * A mutation did exactly that and the round-trip test, whose stub returns
 * fifty-one rows whatever the limit, never noticed. This file does.
 */
const log: { method: string; args: unknown[] }[] = []
let rows: unknown[] = []
let failure: string | null = null

vi.mock('next/headers', () => ({ cookies: async () => ({ getAll: () => [], set: () => {} }) }))
vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: async () => ({
    from: (table: string) => {
      log.push({ method: 'from', args: [table] })
      const chain: Record<string, unknown> = {}
      for (const m of ['select', 'eq', 'is', 'gte', 'lt', 'or', 'order', 'limit']) {
        chain[m] = (...args: unknown[]) => {
          log.push({ method: m, args })
          return chain
        }
      }
      chain.then = (res: (v: unknown) => unknown) =>
        Promise.resolve(failure ? { data: null, error: { message: failure } } : { data: rows, error: null }).then(res)
      return chain
    },
  }),
}))

const { getAuditEntries, getAuditActors, AUDIT_PAGE_SIZE } = await import('@/lib/admin')

const row = (id: number) => ({ id, occurred_at: `2026-09-19T00:00:${String(id % 60).padStart(2, '0')}+00:00` })
const called = (method: string) => log.filter((l) => l.method === method).map((l) => l.args)

beforeEach(() => {
  log.length = 0
  rows = []
  failure = null
})

describe('getAuditEntries', () => {
  test('reads the view, newest first on both keys, one row more than the page', async () => {
    rows = Array.from({ length: 51 }, (_, i) => row(100 - i))
    const page = await getAuditEntries()
    expect(called('from')).toEqual([['audit_entries']])
    expect(called('order')).toEqual([
      ['occurred_at', { ascending: false }],
      ['id', { ascending: false }],
    ])
    expect(called('limit')).toEqual([[AUDIT_PAGE_SIZE + 1]])
    /* Fifty-one arrived, so there is more — and the page is fifty. */
    expect(page.entries).toHaveLength(AUDIT_PAGE_SIZE)
    expect(page.hasMore).toBe(true)
  })

  test('and says there is no more when the extra row did not arrive', async () => {
    rows = Array.from({ length: 50 }, (_, i) => row(100 - i))
    const page = await getAuditEntries()
    expect(page.entries).toHaveLength(50)
    expect(page.hasMore).toBe(false)
  })

  test('applies each filter as the column it means, and System as a null actor', async () => {
    await getAuditEntries({
      filters: { table: 'staff_users', action: 'delete', actor: 'system', from: '2026-09-01T00:00:00.000Z', to: '2026-09-16T00:00:00.000Z' },
    })
    expect(called('eq')).toEqual([['table_name', 'staff_users'], ['action', 'delete']])
    expect(called('is')).toEqual([['actor_staff_id', null]])
    expect(called('gte')).toEqual([['occurred_at', '2026-09-01T00:00:00.000Z']])
    expect(called('lt')).toEqual([['occurred_at', '2026-09-16T00:00:00.000Z']])
    expect(called('or')).toEqual([])
  })

  test('a named actor is an equality, not a null test', async () => {
    await getAuditEntries({ filters: { actor: 's1' } })
    expect(called('eq')).toEqual([['actor_staff_id', 's1']])
    expect(called('is')).toEqual([])
  })

  /* Keyset on BOTH keys: strictly earlier instants, or the same instant with a
     smaller id. Two rows can share an instant. */
  test('a cursor becomes the two-part keyset predicate', async () => {
    await getAuditEntries({ before: { occurred_at: '2026-09-19T02:10:00+00:00', id: 151 } })
    expect(called('or')).toEqual([
      ['occurred_at.lt.2026-09-19T02:10:00+00:00,and(occurred_at.eq.2026-09-19T02:10:00+00:00,id.lt.151)'],
    ])
  })

  test('throws on error rather than showing an empty trail', async () => {
    failure = 'permission denied'
    await expect(getAuditEntries()).rejects.toThrow('The audit trail could not be read: permission denied')
  })
})

describe('getAuditActors', () => {
  test('reads the directory, every status, and composes the name', async () => {
    rows = [
      { id: 's2', first_name: 'Former', last_name: 'Colleague', status: 'inactive' },
      { id: 's1', first_name: 'Wide', last_name: 'Adviser', status: 'active' },
    ]
    const actors = await getAuditActors()
    expect(called('from')).toEqual([['staff_directory']])
    expect(called('eq')).toEqual([])
    expect(actors).toEqual([
      { id: 's2', name: 'Former Colleague', status: 'inactive' },
      { id: 's1', name: 'Wide Adviser', status: 'active' },
    ])
  })

  /* THE SORT IS THE DATABASE'S, and it is surname-first since 19 Sep 2026.
     Ordering in the component would sort the rows it was handed rather than the
     set, which is only the same thing while every staff member fits on one page. */
  test('orders by last name, then first', async () => {
    rows = []
    await getAuditActors()
    expect(called('order')).toEqual([['last_name'], ['first_name']])
  })
})
