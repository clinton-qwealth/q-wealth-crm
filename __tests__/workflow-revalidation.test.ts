import { describe, expect, test, vi, beforeEach } from 'vitest'

/**
 * A write has to tell every screen that shows the thing it wrote.
 *
 * Two bugs of this shape were fixed together on 8 September: a task appeared on
 * its workflow's page only after a reload, and a workflow started from the
 * board never reached the board at all. The first was a client holding stale
 * state; the second was the write simply not revalidating the board's route.
 * This file covers the second half — that the paths are named.
 */
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('next/headers', () => ({ cookies: async () => ({ getAll: () => [], set: () => {} }) }))
vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: async () => ({
    rpc: async () => ({ data: 'new-id', error: null }),
  }),
}))

const { revalidatePath } = await import('next/cache')
const {
  createWorkflowTask,
  setWorkflowTaskStatus,
  setWorkflowTaskPriority,
  saveWorkflowTaskDetails,
  startWorkflow,
} = await import(
  '@/app/(shell)/groups/actions'
)

const paths = () => vi.mocked(revalidatePath).mock.calls.map((c) => c[0])

const form = (entries: Record<string, string>) => {
  const fd = new FormData()
  for (const [k, v] of Object.entries(entries)) fd.set(k, v)
  return fd
}

beforeEach(() => vi.mocked(revalidatePath).mockClear())

describe('a write revalidates every screen that shows it', () => {
  test('adding a task refreshes the workflow it belongs to', async () => {
    await createWorkflowTask(null, form({ workflow_id: 'w1', subject: 'Lodge the claim' }))
    expect(paths()).toContain('/workflows/w1')
  })

  test('ticking a task refreshes the workflow it belongs to', async () => {
    await setWorkflowTaskStatus('t1', 'done', 'w1')
    expect(paths()).toContain('/workflows/w1')
  })

  test('changing a task’s priority refreshes the workflow it belongs to', async () => {
    await setWorkflowTaskPriority('t1', 'high', 'w1')
    expect(paths()).toContain('/workflows/w1')
  })

  /**
   * The panel is open when the save lands, and it reads the task out of the
   * same array the rows do — so the revalidation is what puts the saved values
   * behind it. Without this path the box would close over stale text.
   */
  test('saving a task’s details refreshes the workflow whose page the panel is on', async () => {
    const fd = new FormData()
    fd.set('task_id', 't1')
    fd.set('workflow_id', 'w1')
    fd.set('comment', 'Done')
    await saveWorkflowTaskDetails(null, fd)
    expect(paths()).toContain('/workflows/w1')
  })

  /**
   * The board lists every workflow across every group, so a workflow started
   * from either screen belongs on it. Until this was fixed, `startWorkflow`
   * revalidated `/groups` alone and a new card reached the board only on a
   * reload.
   */
  test('starting a workflow refreshes both the group page and the board', async () => {
    await startWorkflow(null, form({ group_id: 'g1', name: 'Annual review 2027' }))
    expect(paths()).toContain('/groups')
    expect(paths()).toContain('/workflows')
  })
})
