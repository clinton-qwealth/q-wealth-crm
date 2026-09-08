import { describe, expect, test, vi, beforeEach } from 'vitest'

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

const { createWorkflowTask, setWorkflowTaskStatus } = await import('@/app/(shell)/groups/actions')

const form = (entries: Record<string, string>) => {
  const fd = new FormData()
  for (const [k, v] of Object.entries(entries)) fd.set(k, v)
  return fd
}

beforeEach(() => {
  calls.length = 0
  failure = null
})

describe('createWorkflowTask', () => {
  test('sends every field, with blanks as null rather than empty strings', async () => {
    await createWorkflowTask(null, form({ workflow_id: 'w1', subject: '  Lodge the claim ', description: '', due_at: '', assigned_to_staff_id: '' }))
    expect(calls[0].name).toBe('create_workflow_task')
    expect(calls[0].args).toEqual({
      p_workflow_id: 'w1',
      p_subject: 'Lodge the claim',
      p_description: null,
      // A `date` column refuses '' outright, so a blank date must be null.
      p_due_at: null,
      p_assigned_to_staff_id: null,
      // Null lets the database's own default (medium) stand.
      p_priority: null,
    })
  })

  test('passes a description, due date and assignee through when given', async () => {
    await createWorkflowTask(null, form({ workflow_id: 'w1', subject: 'x', description: 'Why', due_at: '2026-10-15', assigned_to_staff_id: 's2', priority: 'high' }))
    expect(calls[0].args).toMatchObject({ p_description: 'Why', p_due_at: '2026-10-15', p_assigned_to_staff_id: 's2', p_priority: 'high' })
  })

  test('a blank subject is refused before any call is made', async () => {
    const result = await createWorkflowTask(null, form({ workflow_id: 'w1', subject: '   ' }))
    expect(result).toEqual({ error: 'Give the task a subject.' })
    expect(calls.length).toBe(0)
  })

  test('no workflow is refused before any call is made', async () => {
    const result = await createWorkflowTask(null, form({ subject: 'x' }))
    expect(result).toEqual({ error: 'No workflow selected.' })
    expect(calls.length).toBe(0)
  })

  test('the database’s own message is returned', async () => {
    failure = 'No such workflow, or not within your access'
    const result = await createWorkflowTask(null, form({ workflow_id: 'w1', subject: 'x' }))
    expect(result).toEqual({ error: 'No such workflow, or not within your access' })
  })
})

describe('setWorkflowTaskStatus', () => {
  test('calls the status function with the task and the status', async () => {
    await setWorkflowTaskStatus('t1', 'done', 'w1')
    expect(calls[0]).toEqual({ name: 'set_workflow_task_status', args: { p_id: 't1', p_status: 'done' } })
  })

  test('the database’s own message is returned', async () => {
    failure = 'No such task, or not within your access'
    expect(await setWorkflowTaskStatus('t1', 'open', 'w1')).toEqual({ error: 'No such task, or not within your access' })
  })
})
