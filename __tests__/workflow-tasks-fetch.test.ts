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

  test('soonest due first, undated last, created_at breaking the tie', async () => {
    await getWorkflowTasks('w1')
    expect(ordered).toEqual([
      // Ascending puts the closest date at the top...
      { column: 'due_at', options: { ascending: true, nullsFirst: false } },
      // ...and the tie-break keeps same-day tasks in the order they were made.
      { column: 'created_at', options: { ascending: true } },
    ])
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
