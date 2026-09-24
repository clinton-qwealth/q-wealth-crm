import { describe, expect, test, vi } from 'vitest'
import { createRoundTripHarness } from './helpers/round-trips'

/**
 * The template editor is its own route rather than a drawer on /admin, and the
 * reason is measured here twice over.
 *
 * ONE WAVE. The roles, the tasks and the dependency edges all arrive embedded
 * on the template row; a second query for any of them would make this page two
 * waves, and the edges are the one most likely to be split out because two
 * foreign keys run from an edge to a task.
 *
 * The firm's role list joined on 24 Sep and is a SECOND TABLE in the SAME wave,
 * which is why the assertion below names both tables and still demands depth 1.
 * It cannot be an embed: it is the whole firm's list, including roles this
 * template has never used, and that is exactly what the editor's pickers need.
 * Awaiting it after `getTemplate` would be the regression — same two queries,
 * twice the latency — and only the depth catches that, not the table names.
 *
 * And the gate runs BEFORE the read, as /admin's does: a route you may not use
 * must be indistinguishable from one that does not exist, and must cost
 * nothing to be refused.
 */
const { wait, calls, measure } = createRoundTripHarness()

let manageStaff = true

function stubClient() {
  const row = {
    id: 'tpl1',
    name: 'Onboarding',
    description: null,
    status: 'draft',
    workflow_type: null,
    published_at: null,
    workflow_template_roles: [{ id: 'r1', name: 'Adviser' }],
    workflow_template_tasks: [
      { id: 'a', ordinal: 0, subject: 'Book', description: null, priority: 'medium', role_id: 'r1', due_offset_days: 0 },
      { id: 'b', ordinal: 1, subject: 'Collect', description: null, priority: 'medium', role_id: 'r1', due_offset_days: 3 },
    ],
    workflow_template_task_dependencies: [{ task_id: 'b', depends_on_task_id: 'a' }],
    workflow_template_deployments: [],
  }
  const builder = (table: string) => {
    const chain: Record<string, unknown> = {}
    for (const m of ['select', 'eq', 'order', 'limit', 'in', 'is']) chain[m] = () => chain
    const settle = () => wait(table).then(() => ({ data: [row], error: null }))
    chain.maybeSingle = () => ({
      then: (res: never) => settle().then((v) => ({ ...v, data: row })).then(res),
    })
    chain.single = chain.maybeSingle
    chain.then = (res: never, rej: never) => settle().then(res, rej)
    return chain
  }
  return { from: (t: string) => builder(t), rpc: (n: string) => wait(n).then(() => ({ data: [], error: null })) }
}

vi.mock('next/headers', () => ({ cookies: async () => ({ getAll: () => [], set: () => {} }) }))
vi.mock('next/navigation', () => ({
  redirect: () => {
    throw new Error('unexpected redirect')
  },
  notFound: () => {
    throw new Error('notFound')
  },
}))
vi.mock('@/lib/supabase/server', () => ({ createSupabaseServerClient: async () => stubClient() }))
vi.mock('@/lib/staff', () => ({
  getCurrentStaff: async () => ({
    id: 's1',
    full_name: 'A Adviser',
    email: 'a@example.com',
    status: 'active',
    access_profiles: {
      name: manageStaff ? 'Admin' : 'Adviser',
      view_all_groups: true,
      view_sensitive: true,
      manage_groups: true,
      manage_staff: manageStaff,
      file_unmatched_notes: true,
    },
  }),
}))
/* The editor itself is a client component full of dialogs; this file is about
   what the route COSTS, not what it draws. */
vi.mock('@/components/template-editor', () => ({ TemplateEditor: () => null }))

const { default: TemplateEditorPage } = await import('@/app/(shell)/admin/templates/[id]/page')

describe('/admin/templates/[id] round-trip depth', () => {
  test('the whole editor is one read', async () => {
    manageStaff = true
    const { depth, error } = await measure(() =>
      TemplateEditorPage({ params: Promise.resolve({ id: 'tpl1' }) }),
    )
    expect(error).toBeUndefined()
    expect(depth).toBe(1)
    expect([...calls].sort()).toEqual(['workflow_roles', 'workflow_templates'])
  })

  test('anyone but an administrator is told it does not exist, before a single query', async () => {
    manageStaff = false
    calls.length = 0
    const { error } = await measure(() =>
      TemplateEditorPage({ params: Promise.resolve({ id: 'tpl1' }) }),
    )
    expect((error as Error | undefined)?.message).toBe('notFound')
    expect(calls).toEqual([])
  })
})
