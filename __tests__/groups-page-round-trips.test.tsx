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
/* Which wave each table was FIRST read in, from the clock the test started. A
   whole-page depth cannot see a loader that chains two reads while another
   loader is already two deep — the chain hides under the floor. The issue wave
   can: a read that belongs in the first wave and is issued in the second has
   been chained onto something. Only meaningful for a table ONE loader reads
   (client_group_members is read by three, in different waves, and says
   nothing). */
let clock = 0
const issuedIn: Record<string, number> = {}
const startClock = () => {
  calls.length = 0
  for (const k of Object.keys(issuedIn)) delete issuedIn[k]
  clock = Date.now()
  return clock
}

function stubClient() {
  const wait = (label: string) => {
    calls.push(label)
    issuedIn[label] = Math.min(issuedIn[label] ?? Infinity, Math.round((Date.now() - clock) / LATENCY))
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
    group_financial_accounts: [{ group_id: 'g1', account_id: 'a1', label: 'Super' }],
    group_insurance_policies: [{ group_id: 'g1', policy_id: 'i1', label: 'Life' }],
    /* The tables the accounts loader walked before the two group views
       replaced its chain on 10 September. Kept populated so a loader that
       regresses to chaining still finds rows and reaches its full depth,
       rather than returning early and hiding the regression. */
    financial_account_owners: [{ account_id: 'a1' }],
    financial_accounts_summary: [{ account_id: 'a1', label: 'Super' }],
    insurance_policy_parties: [{ policy_id: 'i1' }],
    insurance_policies_summary: [{ policy_id: 'i1', label: 'Life' }],
    staff_users: [{ id: 's1', full_name: 'A Adviser', email: 'a@example.com', status: 'active' }],
    group_notes_summary: [
      { note_id: 'n1', note_type: 'file_note', title: 'Review meeting', occurred_at: '2026-07-06T02:00:00Z',
        author_name: 'A Adviser', source: 'manual', workflow_id: 'w1', workflow_name: 'Annual review 2026',
        workflow_status: 'in_progress' },
    ],
    workflow_board: [
      { id: 'w1', name: 'Annual review 2026', workflow_type: 'annual_review', status: 'in_progress', priority: 'medium',
        group_id: 'g1', group_name: 'Testsmith Household', owner_name: 'A Adviser', started_at: '2026-07-01T00:00:00Z',
        completed_at: null, updated_at: '2026-07-06T02:00:00Z' },
    ],
  }

  const builder = (table: string) => {
    let data = fixtures[table] ?? []
    const chain: Record<string, unknown> = {}
    for (const m of ['select', 'is', 'in', 'neq', 'order', 'limit', 'gte', 'lte', 'not']) {
      chain[m] = () => chain
    }
    /* The one filter the fixtures honour: the group row by id, so an unknown
       id finds no group and the 404 path can be exercised. Every other filter
       is a pass-through — it is depth being measured here, not selection. */
    chain.eq = (col: string, v: unknown) => {
      if (table === 'group_summary' && col === 'group_id') data = data.filter((r) => (r as { group_id: string }).group_id === v)
      return chain
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
vi.mock('next/navigation', () => ({
  redirect: () => { throw new Error('unexpected redirect') },
  notFound: () => { throw new Error('notFound') },
}))
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

const { default: GroupDetailPage } = await import('@/app/(shell)/groups/[id]/page')
const { default: GroupsIndexPage } = await import('@/app/(shell)/groups/page')

describe('/groups/[id] round-trip depth', () => {
  test('the page fetches in a shallow chain, not one call after another', async () => {
    const started = startClock()
    /* `params`, not `searchParams`: the id became a path segment on
       10 September when /groups became the index and the detail page moved
       under it. */
    await GroupDetailPage({ params: Promise.resolve({ id: 'g1' }) })
    const depth = Math.round((Date.now() - started) / LATENCY)

    /* Measured with this same harness: a depth of 12 before the fetches were
       grouped; 4 after; 3 once the group row joined the wave on 10 September
       instead of being awaited alone ahead of it; and 2 the same day, when the
       accounts loader's three-step chain (members → owners → summary) became
       one read each of the two group views — roughly 2.0s of network wait
       reduced to 0.35s. The number is exact: getGroupMemberDetail is the floor
       at 2 and is inherently two-phase (members, then their person rows), and
       a fetch chained onto the end rather than joining a wave reads 3 and
       fails. */
    expect(calls.length).toBeGreaterThanOrEqual(10)
    // The notes pair must actually have been reached, or the depth below is
    // measuring a page that never fetched them.
    expect(calls).toContain('group_notes_summary')
    expect(calls).toContain('workflow_board')
    // The accounts and policies come from the group views, and the tables the
    // old chain walked are not read on their own.
    expect(calls).toContain('group_financial_accounts')
    expect(calls).toContain('group_insurance_policies')
    expect(calls).not.toContain('financial_account_owners')
    expect(calls).not.toContain('financial_accounts_summary')
    expect(calls).not.toContain('insurance_policy_parties')
    expect(calls).not.toContain('insurance_policies_summary')
    expect(depth).toBe(2)

    /* The accounts loader is ONE wave of four, and the wave is the first: none
       of its reads waits for another. Caught here because the page depth alone
       cannot see it — a loader chained to depth 2 sits under the member-detail
       floor of 2 and the total still reads 2. (Found by mutation: re-chaining
       the members read ahead of the other three passed the depth assertion.) */
    for (const first of ['party_roles', 'group_financial_accounts', 'group_insurance_policies', 'group_summary', 'group_notes_summary']) {
      expect(issuedIn[first], `${first} issued in wave`).toBe(0)
    }
  })

  /**
   * The group row is no longer checked before the siblings start, so the 404
   * has to be shown to still happen — after the wave, not instead of it.
   */
  test('an unknown group is still a 404, one wave later', async () => {
    calls.length = 0
    await expect(GroupDetailPage({ params: Promise.resolve({ id: 'nope' }) })).rejects.toThrow('notFound')
    // The siblings did run: that is the trade the comment on the page records.
    expect(calls).toContain('group_summary')
    expect(calls).toContain('group_notes_summary')
  })
})

/**
 * The index lists the groups, and **one query is the whole budget.**
 *
 * This test asserted zero queries while the page was a placeholder, with a note
 * that the obvious way to get the list wrong is to fetch one row at a time. The
 * list landed the same day, so the assertion is now the real one: exactly one
 * read, of the view that decides visibility, and nothing per row.
 */
describe('/groups index', () => {
  test('the index reads the group view exactly once, and nothing per row', async () => {
    calls.length = 0
    await GroupsIndexPage()
    expect(calls).toEqual(['group_summary'])
  })

  test('its depth is one wave, so the list costs one round trip', async () => {
    calls.length = 0
    const started = Date.now()
    await GroupsIndexPage()
    expect(Math.round((Date.now() - started) / LATENCY)).toBe(1)
  })
})
