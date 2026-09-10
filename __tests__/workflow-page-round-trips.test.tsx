import { describe, expect, test, vi } from 'vitest'

/**
 * How deep is the chain of Supabase round trips behind /workflows/[id]?
 *
 * The same harness as groups-page-round-trips, for the same reason: a request
 * to Supabase from here costs ~170ms whatever it asks for, so the wall-clock
 * cost of the page is the DEPTH of sequential round trips × 170ms, and depth is
 * the only number worth defending.
 *
 * The page's eight loaders run in one `Promise.all`, so the wave is as deep as
 * its deepest member. Until 10 September that was 3: the recipient lookup
 * (workflow → group → contact points) and the entity-choice lookup (board row →
 * members and siblings → clients) each chained three reads inside the wave.
 * Both are now single embedded reads rooted on the workflow row, and the wave
 * is one round trip deep. This file pinned 3 first, then the loaders were
 * rewritten and it was tightened to 1 — re-chaining either loader takes it
 * straight back to 3.
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

  /* Rows shaped to send each loader down its LONGEST path: a group id on the
     workflow, a primary contact on the group with an email on file, members who
     are clients, a sibling workflow. Nothing returns early. */
  const board = {
    id: 'w1', name: 'Annual review 2026', workflow_type: 'annual_review', status: 'in_progress', priority: 'medium',
    group_id: 'g1', group_name: 'Testsmith Household', owner_staff_id: 's1', owner_name: 'A Adviser',
    started_at: '2026-07-01T00:00:00Z', completed_at: null, updated_at: '2026-07-06T02:00:00Z',
  }
  const fixtures: Record<string, unknown[]> = {
    workflow_board: [board, { ...board, id: 'w2', name: 'Insurance review' }],
    /* The embedded shape the rewritten loaders read: the workflow row carrying
       its group, the group carrying its primary contact's emails, its current
       members (as clients) and its sibling workflows. */
    workflows: [{
      id: 'w1',
      group_id: 'g1',
      client_groups: {
        id: 'g1',
        name: 'Testsmith Household',
        primary_contact_party_id: 'p1',
        contact: { display_name: 'Janet Testsmith', contact_points: [{ value: 'janet@example.com', is_preferred: true, kind: 'email' }] },
        members: [{ party_id: 'p1', end_date: null, clients: { display_name: 'Janet Testsmith' } }, { party_id: 'p9', end_date: '2025-01-01', clients: { display_name: 'Left The Group' } }, { party_id: 'p8', end_date: null, clients: null }],
        siblings: [{ id: 'w1', name: 'Annual review 2026', updated_at: '2026-07-06T02:00:00Z' }, { id: 'w2', name: 'Insurance review', updated_at: '2026-07-01T00:00:00Z' }],
      },
    }],
    /* Kept so a loader that regresses to chaining still finds data and reaches
       its full depth, rather than returning early and hiding the regression. */
    client_groups: [{ id: 'g1', primary_contact_party_id: 'p1', parties: { display_name: 'Janet Testsmith' } }],
    contact_points: [{ party_id: 'p1', kind: 'email', value: 'janet@example.com', is_preferred: true }],
    client_group_members: [{ party_id: 'p1' }],
    clients: [{ party_id: 'p1', display_name: 'Janet Testsmith' }],
    staff_directory: [{ id: 's1', full_name: 'A Adviser', status: 'active' }],
    workflow_tasks_summary: [{ id: 't1', workflow_id: 'w1', title: 'Book the meeting', status: 'open' }],
    workflow_posts_summary: [],
    workflow_task_actions_summary: [],
    group_notes_summary: [],
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

  return { from: (table: string) => builder(table) }
}

vi.mock('next/headers', () => ({ cookies: async () => ({ getAll: () => [], set: () => {} }) }))
vi.mock('next/navigation', () => ({
  redirect: () => { throw new Error('unexpected redirect') },
  notFound: () => { throw new Error('unexpected notFound') },
}))
vi.mock('@/lib/supabase/server', () => ({ createSupabaseServerClient: async () => stubClient() }))
/* The auth pair is measured in staff.test.ts — getCurrentStaff is memoised with
   React cache(), which only memoises inside a request scope and so would
   double-count here. */
vi.mock('@/lib/staff', () => ({
  getCurrentStaff: async () => ({
    id: 's1', full_name: 'A Adviser', email: 'a@example.com', status: 'active',
    access_profiles: { name: 'Admin', view_all_groups: true, view_sensitive: true, manage_groups: true, manage_staff: true, file_unmatched_notes: true },
  }),
}))

const { default: WorkflowPage } = await import('@/app/(shell)/workflows/[id]/page')

describe('/workflows/[id] round-trip depth', () => {
  test('the whole page is one wave: every loader is a single read', async () => {
    calls.length = 0
    const started = Date.now()
    await WorkflowPage({ params: Promise.resolve({ id: 'w1' }) })
    const depth = Math.round((Date.now() - started) / LATENCY)

    /* Eight loaders, eight reads. The recipient and the entity choices each
       used to be three chained reads; now each is one embedded read of the
       workflow row, so the same two tables are hit twice and nothing else is
       reached in a second wave. */
    expect(calls).toHaveLength(8)
    expect(calls.filter((c) => c === 'workflows')).toHaveLength(2)
    expect(calls).toContain('workflow_board')
    expect(calls).toContain('group_notes_summary')
    /* The tables the old chains walked to, no longer read on their own. */
    expect(calls).not.toContain('contact_points')
    expect(calls).not.toContain('clients')
    expect(calls).not.toContain('client_group_members')
    expect(calls).not.toContain('client_groups')

    expect(depth).toBe(1)
  })
})
