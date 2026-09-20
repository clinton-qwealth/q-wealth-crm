import { beforeEach, describe, expect, test, vi } from 'vitest'
import { createRoundTripHarness } from './helpers/round-trips'

/**
 * How deep is the chain of Supabase round trips behind /admin, and who pays it?
 *
 * Depth is counted, not timed — see `helpers/round-trips.ts`. The page is held
 * to ONE wave: the audit entries, the actor list, the staff and the profiles
 * are issued together, and a later tab's loader must join that `Promise.all`
 * rather than follow it.
 *
 * And the gate runs BEFORE the wave. A non-administrator must reach
 * `notFound()` having issued no query at all — not because RLS would leak
 * (it returns nothing), but because a page that spends round trips on rows it
 * will not show is a page that looks slow for the people it refuses.
 */
const { wait, calls, issuedIn, measure } = createRoundTripHarness()

let manageStaff = true

function stubClient() {
  const fixtures: Record<string, unknown[]> = {
    audit_entries: Array.from({ length: 51 }, (_, i) => ({
      id: 100 - i, occurred_at: `2026-09-19T03:${String(59 - i).padStart(2, '0')}:00+00:00`,
      table_name: 'financial_accounts', record_id: 'a1', action: 'update',
      changed_fields: ['label'], old_data: { label: 'Old' }, new_data: { label: 'New' },
      actor_staff_id: 's1', actor_context: 'api', actor_name: 'A Adviser', record_label: 'New',
    })),
    staff_directory: [{ id: 's1', full_name: 'A Adviser', status: 'active' }],
    /* The Staff tab's two reads, on the same wave since Phase 2. */
    staff_users: [{ id: 's1', full_name: 'A Adviser', email: 'a@example.com', status: 'active', avatar_path: null, created_at: '2026-09-01T00:00:00+00:00', verify_identity: false, title: null, staff_private_details: null, staff_access_assignments: { profile_id: 'p1', access_profiles: { id: 'p1', name: 'Admin' } } }],
    access_profiles: [{ id: 'p1', name: 'Admin', description: null, view_all_groups: true, view_sensitive: true, manage_groups: true, manage_staff: true, file_unmatched_notes: true }],
    /* The table a regression might read directly instead of the view. */
    audit_log: [{ id: 1 }],
  }
  const builder = (table: string) => {
    const data = fixtures[table] ?? []
    const chain: Record<string, unknown> = {}
    for (const m of ['select', 'is', 'in', 'neq', 'order', 'limit', 'gte', 'lte', 'lt', 'gt', 'not', 'or', 'eq']) {
      chain[m] = () => chain
    }
    const settle = () => wait(table).then(() => ({ data, error: null }))
    chain.maybeSingle = () => ({ then: (res: never) => settle().then((v) => ({ ...v, data: data[0] ?? null })).then(res) })
    chain.single = chain.maybeSingle
    chain.then = (res: never, rej: never) => settle().then(res, rej)
    return chain
  }
  return { from: (table: string) => builder(table) }
}

vi.mock('next/headers', () => ({ cookies: async () => ({ getAll: () => [], set: () => {} }) }))
vi.mock('next/navigation', () => ({
  redirect: () => { throw new Error('unexpected redirect') },
  notFound: () => { throw new Error('notFound') },
}))
vi.mock('@/lib/supabase/server', () => ({ createSupabaseServerClient: async () => stubClient() }))
vi.mock('@/lib/staff', () => ({
  getCurrentStaff: async () => ({
    id: 's1', full_name: 'A Adviser', email: 'a@example.com', status: 'active',
    access_profiles: { name: manageStaff ? 'Admin' : 'Adviser', view_all_groups: true, view_sensitive: true, manage_groups: true, manage_staff: manageStaff, file_unmatched_notes: true },
  }),
}))

const { default: AdminPage } = await import('@/app/(shell)/admin/page')

beforeEach(() => {
  manageStaff = true
})

describe('/admin round-trip depth', () => {
  test('an administrator gets the page in one wave', async () => {
    const { depth, error } = await measure(() => AdminPage())
    expect(error).toBeUndefined()
    expect(depth).toBe(1)
    expect(calls).toContain('audit_entries')
    expect(calls).toContain('staff_directory')
    expect(calls).toContain('staff_users')
    expect(calls).toContain('access_profiles')
    /* The view, not the table beneath it. */
    expect(calls).not.toContain('audit_log')
    for (const first of ['audit_entries', 'staff_directory', 'staff_users', 'access_profiles']) {
      expect(issuedIn[first], `${first} issued in wave`).toBe(0)
    }
  })

  test('anyone else is told the page does not exist, before a single query', async () => {
    manageStaff = false
    const { error } = await measure(() => AdminPage())
    expect((error as Error | undefined)?.message).toBe('notFound')
    expect(calls).toEqual([])
  })
})
