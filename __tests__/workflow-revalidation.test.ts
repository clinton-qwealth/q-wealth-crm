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
  postWorkflowActivity,
  togglePostReaction,
  startWorkflow,
} = await import(
  '@/app/(shell)/groups/actions'
)

const paths = () => vi.mocked(revalidatePath).mock.calls.map((c) => c[0])
/* The path AND its type. A dynamic route needs `'page'` or the call matches no
   cache entry, so asserting the path alone would pass on a broken call. */
const calls = () => vi.mocked(revalidatePath).mock.calls.map((c) => `${c[0]}|${c[1] ?? ''}`)

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
  test('posting to a task refreshes the workflow whose page the feed is on', async () => {
    await postWorkflowActivity('w1', 't1', { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'x' }] }] })
    expect(paths()).toContain('/workflows/w1')
  })

  test('reacting to a post refreshes the workflow whose page the feed is on', async () => {
    await togglePostReaction('w1', 'p1', 'thumbs_up')
    expect(paths()).toContain('/workflows/w1')
  })

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
   * revalidated the group page alone and a new card reached the board only on a
   * reload.
   *
   * The group page is `/groups/[id]` since 10 September, when /groups became
   * the index and the detail page moved under it.
   */
  test('starting a workflow refreshes both the group page and the board', async () => {
    await startWorkflow(null, form({ group_id: 'g1', name: 'Annual review 2027' }))
    expect(paths()).toContain('/groups/[id]')
    expect(paths()).toContain('/workflows')
  })

  /**
   * **A dynamic route must be revalidated WITH its type**, and this is the
   * assertion that says so.
   *
   * `revalidatePath('/groups/[id]')` on its own matches no cache entry, so
   * every write to a group would report success while the page kept showing
   * the old figures — a silent staleness that no other test here would catch,
   * because they all only look at the path. The literal `/groups` would fail
   * the same way now: it is the index, which shows none of this.
   */
  test('the group page is revalidated as a route PATTERN, with its type', async () => {
    await startWorkflow(null, form({ group_id: 'g1', name: 'Annual review 2027' }))
    expect(calls()).toContain('/groups/[id]|page')
    // Not the index, and not the pattern without its type.
    expect(paths()).not.toContain('/groups')
    expect(calls()).not.toContain('/groups/[id]|')
  })
})
