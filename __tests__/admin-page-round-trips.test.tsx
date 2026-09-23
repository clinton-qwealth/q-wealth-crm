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
    staff_users: [{ id: 's1', first_name: 'A', last_name: 'Adviser', email: 'a@example.com', status: 'active', avatar_path: null, created_at: '2026-09-01T00:00:00+00:00', verify_identity: false, limited_to_user_groups: false, title: null, staff_private_details: null, staff_access_assignments: { profile_id: 'p1', access_profiles: { id: 'p1', name: 'Admin' } }, user_group_members: [] }],
    access_profiles: [{ id: 'p1', name: 'Admin', description: null, view_all_groups: true, view_sensitive: true, manage_groups: true, manage_staff: true, file_unmatched_notes: true }],
    /* The User groups tab's one read, 20 Sep 2026 — members and households
       both arrive as embeds, so it joins the wave rather than adding one. */
    user_groups: [{ id: 'ug1', name: 'North', status: 'active', created_at: '2026-09-20T00:00:00+00:00', user_group_members: [{ staff_users: { id: 's1', first_name: 'A', last_name: 'Adviser' } }], client_groups: [{ id: 'g1' }, { id: 'g2' }] }],
    /* The Templates tab, 23 Sep 2026: one read, on the first wave. Its counts
       arrive as embeds of ids, so the tab costs one query rather than four. */
    workflow_templates: [{ id: 'tpl1', name: 'Onboarding', description: null, status: 'published', workflow_type: null, published_at: '2026-09-23T00:00:00+00:00', workflow_template_tasks: [{ id: 'tt1' }], workflow_template_roles: [{ id: 'r1' }], workflow_template_deployments: [] }],
    /* The table a regression might read directly instead of the view. */
    audit_log: [{ id: 1 }],
  }
  /* `staff_last_seen()` reaches auth.users, which PostgREST does not serve, so
     it is an RPC rather than an embed — and it therefore has to be counted as
     a round trip like any other, or the depth this file measures would quietly
     stop covering it. */
  const rpcFixtures: Record<string, unknown[]> = {
    staff_last_seen: [{ staff_id: 's1', last_seen_at: '2026-09-20T01:08:23+00:00', last_sign_in_at: '2026-09-19T15:20:23+00:00', has_live_session: true }],
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
  return {
    from: (table: string) => builder(table),
    rpc: (name: string) => wait(name).then(() => ({ data: rpcFixtures[name] ?? [], error: null })),
  }
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
    /* In the SAME wave, not after it — the depth assertion above is what says
       so, and this says the call happened at all. */
    expect(calls).toContain('staff_last_seen')
    /* The User groups tab, 20 Sep 2026: one read, on the first wave. */
    expect(calls).toContain('user_groups')
    expect(calls, 'members and households come as embeds, not their own reads').not.toContain('user_group_members')
    /* The Templates tab, 23 Sep 2026. Its tasks, roles and deployments are
       embeds; a count query for any of them would show up here. */
    expect(calls).toContain('workflow_templates')
    expect(calls, 'the tasks come as an embed, not their own read').not.toContain('workflow_template_tasks')
    /* The view, not the table beneath it. */
    expect(calls).not.toContain('audit_log')
    for (const first of ['audit_entries', 'staff_directory', 'staff_users', 'access_profiles', 'user_groups', 'workflow_templates']) {
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
