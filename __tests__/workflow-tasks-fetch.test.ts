import { describe, expect, test, vi, beforeEach } from 'vitest'

/**
 * The order tasks come back in is a decision, and it lives in the query rather
 * than in the component — one source of truth, right for any other consumer.
 * So it is asserted where it is made.
 */
const ordered: { column: string; options?: { ascending?: boolean; nullsFirst?: boolean } }[] = []
let table = ''
let filtered: [string, string] | null = null

vi.mock('next/headers', () => ({ cookies: async () => ({ getAll: () => [], set: () => {} }) }))
vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: async () => ({
    from: (t: string) => {
      table = t
      const chain: Record<string, unknown> = {
        select: () => chain,
        eq: (column: string, value: string) => {
          filtered = [column, value]
          return chain
        },
        order: (column: string, options?: { ascending?: boolean; nullsFirst?: boolean }) => {
          ordered.push({ column, options })
          return chain
        },
        then: (resolve: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(resolve),
      }
      return chain
    },
  }),
}))

const { getWorkflowTasks, getWorkflowPosts } = await import('@/lib/workflows')

beforeEach(() => {
  ordered.length = 0
  filtered = null
  table = ''
})

describe('getWorkflowTasks', () => {
  test('reads the view, not the table, and only this workflow’s tasks', async () => {
    await getWorkflowTasks('w1')
    // The view names the assignee; the table cannot.
    expect(table).toBe('workflow_tasks_summary')
    expect(filtered).toEqual(['workflow_id', 'w1'])
  })

  /**
   * PLAN ORDER FIRST — changed 23 Sep 2026, when templates arrived.
   *
   * This used to lead with `due_at` and break ties on `created_at`, and the
   * comment beside it said that tasks sharing a due date, "which
   * template-generated tasks will", would keep the order they were made in.
   * They would not: `now()` is the TRANSACTION timestamp, so every task one
   * deploy creates carries the identical `created_at` and the tie-break does
   * nothing at all. Since a task waiting on another has no due date until that
   * other is done, most of a deployed plan would have sorted into one
   * undifferentiated block in whatever order the heap returned.
   *
   * Mutation: drop the plan_position order → this fails, and a deployed plan
   * renders scrambled.
   */
  test('plan order first, then soonest due, then the order they were made', async () => {
    await getWorkflowTasks('w1')
    expect(ordered).toEqual([
      { column: 'plan_position', options: { ascending: true, nullsFirst: false } },
      { column: 'due_at', options: { ascending: true, nullsFirst: false } },
      { column: 'created_at', options: { ascending: true } },
    ])
  })

  /**
   * `nullsFirst: false` on plan_position is what keeps a workflow with no
   * template looking exactly as it did before templates existed: a hand-made
   * task has no position, sorts after the plan, and then falls through to the
   * due-date ordering this function has always used.
   *
   * Mutation: nullsFirst: true → every hand-added task jumps above the plan.
   */
  test('a task with no plan position sorts after the plan, not before it', async () => {
    await getWorkflowTasks('w1')
    expect(ordered.find((o) => o.column === 'plan_position')!.options?.nullsFirst).toBe(false)
  })

  test('a task with no due date is not treated as due soonest', async () => {
    await getWorkflowTasks('w1')
    const due = ordered.find((o) => o.column === 'due_at')!
    expect(due.options?.nullsFirst).toBe(false)
  })

  test('no rows is an empty list, never null', async () => {
    expect(await getWorkflowTasks('w1')).toEqual([])
  })
})

/**
 * Posts come back newest first, for the whole workflow. The task panel filters
 * them to its own task; the workflow's timeline shows all of them. Ordered in
 * the query, with a tie-break on id so two posts in the same instant do not
 * shuffle between renders.
 */
describe('getWorkflowPosts', () => {
  test('reads the summary view — the only thing that names the author — for this workflow', async () => {
    await getWorkflowPosts('w1')
    expect(table).toBe('workflow_posts_summary')
    expect(filtered).toEqual(['workflow_id', 'w1'])
  })

  test('newest first, ties broken by id', async () => {
    await getWorkflowPosts('w1')
    expect(ordered).toEqual([
      { column: 'created_at', options: { ascending: false } },
      { column: 'id', options: { ascending: false } },
    ])
  })

  test('no posts is an empty list, not null', async () => {
    expect(await getWorkflowPosts('w1')).toEqual([])
  })
})
