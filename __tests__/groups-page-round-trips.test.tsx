import { describe, expect, test, vi } from 'vitest'

/**
 * How deep is the chain of Supabase round trips behind /groups?
 *
 * This matters more than any single query: a request to Supabase from here
 * costs about 170ms whatever it asks for — measured at 30-50ms of TCP and
 * ~120ms of fixed platform overhead, with /auth/v1/health (which touches no
 * database at all) taking the same ~160ms as a real select. So the wall-clock
 * cost of this page is round-trip DEPTH times 170ms, and depth is the only
 * number worth defending.
 *
 * It is paid on every save, not just on navigation: patchMember calls
 * revalidatePath('/groups'), and the action does not return to the browser
 * until the page has re-rendered behind it.
 *
 * Every stubbed call takes a fixed LATENCY, so elapsed / LATENCY is the depth.
 */
const LATENCY = 25

const calls: string[] = []

function stubClient() {
  const wait = (label: string) => {
    calls.push(label)
    return new Promise((r) => setTimeout(r, LATENCY))
  }

  // Rows shaped to send the code down its longest path: real members, real
  // ids, so nothing returns early and every wave is actually reached.
  const fixtures: Record<string, unknown[]> = {
    group_summary: [{ group_id: 'g1', name: 'Testsmith Household', group_type: 'household', status: 'active' }],
    client_groups: [{ primary_contact_party_id: 'p1', owner_staff_id: 's1', staff_users: { full_name: 'A Adviser' } }],
    contact_points: [{ party_id: 'p1', kind: 'phone_mobile', value: '0412 555 901', is_preferred: true }],
    client_group_members: [
      { party_id: 'p1', member_role: 'primary', is_primary_group: true,
        parties: { id: 'p1', display_name: 'Janet Testsmith', status: 'active', notes: null, party_type: 'person' } },
    ],
    persons: [{ party_id: 'p1', first_name: 'Janet', last_name: 'Testsmith' }],
    party_roles: [{ party_id: 'p1', role: 'client', status: 'active', start_date: '2026-01-01', parties: { display_name: 'A Provider' } }],
    financial_account_owners: [{ account_id: 'a1' }],
    financial_accounts_summary: [{ account_id: 'a1', label: 'Super' }],
    insurance_policy_parties: [{ policy_id: 'i1' }],
    insurance_policies_summary: [{ policy_id: 'i1', label: 'Life' }],
    staff_users: [{ id: 's1', full_name: 'A Adviser', email: 'a@example.com', status: 'active' }],
  }

  const builder = (table: string) => {
    const data = fixtures[table] ?? []
    const chain: Record<string, unknown> = {}
    for (const m of ['select', 'eq', 'is', 'in', 'neq', 'order', 'limit', 'gte', 'lte', 'not']) {
      chain[m] = () => chain
    }
    const settle = () => wait(table).then(() => ({ data, error: null }))
    chain.maybeSingle = () => ({ then: (res: never) => settle().then((v) => ({ ...v, data: data[0] ?? null })).then(res) })
    chain.single = chain.maybeSingle
    chain.then = (res: never, rej: never) => settle().then(res, rej)
    return chain
  }

  return {
    from: (table: string) => builder(table),
    rpc: (name: string) => ({ then: (res: never, rej: never) => wait(`rpc:${name}`).then(() => ({ data: {}, error: null })).then(res, rej) }),
  }
}

vi.mock('next/headers', () => ({ cookies: async () => ({ getAll: () => [], set: () => {} }) }))
vi.mock('next/navigation', () => ({ redirect: () => { throw new Error('unexpected redirect') } }))
vi.mock('@/lib/supabase/server', () => ({ createSupabaseServerClient: async () => stubClient() }))
/* The shell layout's auth pair is measured separately — getCurrentStaff is
   memoised with React cache(), which only memoises inside a request scope and
   so would double-count here. */
vi.mock('@/lib/staff', () => ({
  getCurrentStaff: async () => ({
    id: 's1', full_name: 'A Adviser', email: 'a@example.com', status: 'active',
    access_profiles: { name: 'Admin', view_all_groups: true, view_sensitive: true, manage_groups: true, manage_staff: true, file_unmatched_notes: true },
  }),
}))

const { default: GroupsPage } = await import('@/app/(shell)/groups/page')

describe('/groups round-trip depth', () => {
  test('the page fetches in a shallow chain, not one call after another', async () => {
    calls.length = 0
    const started = Date.now()
    await GroupsPage({ searchParams: Promise.resolve({ id: 'g1' }) })
    const depth = Math.round((Date.now() - started) / LATENCY)

    /* Measured with this same harness: 15 round trips either way, but a depth
       of 12 before the fetches were grouped and 4 after — roughly 2.0s of
       network wait reduced to 0.7s. The ceiling is set at 5 to leave room for
       one more wave without failing, while still catching a fetch that gets
       chained onto the end of the sequence instead of joining a wave. */
    expect(calls.length).toBeGreaterThanOrEqual(10)
    expect(depth).toBeLessThanOrEqual(5)
  })
})
