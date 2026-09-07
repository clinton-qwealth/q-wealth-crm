import { describe, expect, test, vi, beforeEach } from 'vitest'

/**
 * `saveWorkflowDetails` sends a JSONB patch where KEY PRESENCE means "change
 * this". That is the contract `set_workflow_details()` reads, and it exists
 * because of the bug `update_person` had: with one null meaning both "leave
 * alone" and "clear", a caller sending one field wipes the others.
 *
 * So what matters here is not what the patch contains but what it OMITS.
 */
const calls: { name: string; args: Record<string, unknown> }[] = []
let failure: string | null = null

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('next/headers', () => ({ cookies: async () => ({ getAll: () => [], set: () => {} }) }))
vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: async () => ({
    rpc: async (name: string, args: Record<string, unknown>) => {
      calls.push({ name, args })
      return { error: failure ? { message: failure } : null }
    },
  }),
}))

const { saveWorkflowDetails } = await import('@/app/(shell)/groups/actions')

const form = (entries: Record<string, string>) => {
  const fd = new FormData()
  for (const [k, v] of Object.entries(entries)) fd.set(k, v)
  return fd
}

beforeEach(() => {
  calls.length = 0
  failure = null
})

describe('saveWorkflowDetails', () => {
  test('sends only the keys the form carried', async () => {
    await saveWorkflowDetails(null, form({ workflow_id: 'w1', description: 'Only this' }))
    expect(calls[0].name).toBe('set_workflow_details')
    expect(calls[0].args.p_id).toBe('w1')
    // due_at and owner_staff_id were not submitted, so they must not appear —
    // present-but-empty would CLEAR them.
    expect(calls[0].args.p_patch).toEqual({ description: 'Only this' })
  })

  test('all three when all three are submitted', async () => {
    await saveWorkflowDetails(
      null,
      form({ workflow_id: 'w1', owner_staff_id: 's2', due_at: '2026-12-01', description: 'All' }),
    )
    expect(calls[0].args.p_patch).toEqual({
      owner_staff_id: 's2',
      due_at: '2026-12-01',
      description: 'All',
    })
  })

  test('an empty field is sent, because empty means clear', async () => {
    await saveWorkflowDetails(null, form({ workflow_id: 'w1', due_at: '', description: '' }))
    expect(calls[0].args.p_patch).toEqual({ due_at: '', description: '' })
  })

  test('the workflow id is never part of the patch', async () => {
    await saveWorkflowDetails(null, form({ workflow_id: 'w1', description: 'x' }))
    expect(calls[0].args.p_patch).not.toHaveProperty('workflow_id')
  })

  test('no id is refused before any call is made', async () => {
    const result = await saveWorkflowDetails(null, form({ description: 'x' }))
    expect(result).toEqual({ error: 'No workflow selected.' })
    expect(calls.length).toBe(0)
  })

  test('the database’s own message is returned, not a generic failure', async () => {
    failure = 'No such workflow, or not within your access'
    const result = await saveWorkflowDetails(null, form({ workflow_id: 'w1', description: 'x' }))
    expect(result).toEqual({ error: 'No such workflow, or not within your access' })
  })
})
