import { beforeEach, describe, expect, test, vi } from 'vitest'

/**
 * `getStaffChoices` — the list behind every "who owns this?" picker.
 *
 * Three things here are decisions rather than plumbing, and each is invisible
 * from the component that renders the list.
 *
 * **It reads `staff_directory`, not `staff_users`.** The base table is readable
 * by administrators alone; the directory is the view that exists so an adviser
 * can name a colleague. Point this at the table and every picker empties for
 * everyone but an admin.
 *
 * **The database does the sorting, by SURNAME.** Sorting in the component would
 * sort the rows it was handed rather than the set, and the two `.order()` calls
 * have to arrive in that sequence — surname, then given name — or a picker of
 * two Adamses reads in whatever order the rows happened to come back.
 *
 * **The two name columns are joined here, once.** They are joined by the shared
 * `fullName`, the same rule `public.staff_display_name()` uses in the views, so
 * a colleague picked from this list and the same colleague rendered by a view
 * cannot appear under two spellings.
 */
const log: { method: string; args: unknown[] }[] = []
let rows: unknown[] = []

vi.mock('next/headers', () => ({ cookies: async () => ({ getAll: () => [], set: () => {} }) }))
vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: async () => ({
    from: (table: string) => {
      log.push({ method: 'from', args: [table] })
      const chain: Record<string, unknown> = {}
      for (const m of ['select', 'eq', 'order']) {
        chain[m] = (...args: unknown[]) => {
          log.push({ method: m, args })
          return chain
        }
      }
      chain.then = (res: (v: unknown) => unknown) => Promise.resolve({ data: rows, error: null }).then(res)
      return chain
    },
  }),
}))

const { getStaffChoices } = await import('@/lib/workflows')

const called = (method: string) => log.filter((l) => l.method === method).map((l) => l.args)

beforeEach(() => {
  log.length = 0
  rows = []
})

describe('getStaffChoices', () => {
  test('reads the directory, active only, surname before given name', async () => {
    await getStaffChoices()
    expect(called('from')).toEqual([['staff_directory']])
    expect(called('select')).toEqual([['id, first_name, last_name, status']])
    expect(called('eq')).toEqual([['status', 'active']])
    expect(called('order')).toEqual([['last_name'], ['first_name']])
  })

  test('hands back the two parts joined, in the order the database returned them', async () => {
    rows = [
      { id: 's3', first_name: 'Bella', last_name: 'Adams', status: 'active' },
      { id: 's1', first_name: 'Zoe', last_name: 'Adams', status: 'active' },
      { id: 's2', first_name: 'Mary-Jane van der', last_name: 'Berg', status: 'active' },
    ]
    await expect(getStaffChoices()).resolves.toEqual([
      { id: 's3', name: 'Bella Adams' },
      { id: 's1', name: 'Zoe Adams' },
      { id: 's2', name: 'Mary-Jane van der Berg' },
    ])
  })

  test('no rows is an empty list, not a crash', async () => {
    rows = []
    await expect(getStaffChoices()).resolves.toEqual([])
  })
})
