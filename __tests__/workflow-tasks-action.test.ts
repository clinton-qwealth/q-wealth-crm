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

const { createWorkflowTask, setWorkflowTaskStatus, setWorkflowTaskPriority, saveWorkflowTaskDetails, postWorkflowActivity, togglePostReaction } =
  await import('@/app/(shell)/groups/actions')

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

/**
 * The patch contract, which is the whole reason the panel can have two boxes
 * writing through one function: key presence decides what gets written, so a
 * box only ever sends the fields it actually shows.
 */
describe('saveWorkflowTaskDetails', () => {
  test('the patch carries only the keys the form submitted', async () => {
    await saveWorkflowTaskDetails(null, form({ task_id: 't1', workflow_id: 'w1', comment: 'Done by phone' }))
    expect(calls[0].name).toBe('set_workflow_task_details')
    expect(calls[0].args).toEqual({ p_id: 't1', p_patch: { comment: 'Done by phone' } })
  })

  test('all four go when all four are sent', async () => {
    await saveWorkflowTaskDetails(
      null,
      form({
        task_id: 't1',
        workflow_id: 'w1',
        assigned_to_staff_id: 's2',
        due_at: '2026-10-15',
        description: 'Why',
        comment: 'How it went',
      }),
    )
    expect(calls[0].args).toEqual({
      p_id: 't1',
      p_patch: {
        assigned_to_staff_id: 's2',
        due_at: '2026-10-15',
        description: 'Why',
        comment: 'How it went',
      },
    })
  })

  test('an empty field IS sent, because empty means clear', async () => {
    await saveWorkflowTaskDetails(null, form({ task_id: 't1', workflow_id: 'w1', due_at: '', description: '' }))
    expect(calls[0].args).toEqual({ p_id: 't1', p_patch: { due_at: '', description: '' } })
  })

  test('neither identifier ever leaks into the patch', async () => {
    await saveWorkflowTaskDetails(null, form({ task_id: 't1', workflow_id: 'w1', comment: 'x' }))
    const patch = calls[0].args.p_patch as Record<string, string>
    expect('task_id' in patch).toBe(false)
    expect('workflow_id' in patch).toBe(false)
  })

  test('no task is refused before any call is made', async () => {
    expect(await saveWorkflowTaskDetails(null, form({ comment: 'x' }))).toEqual({
      error: 'No task selected.',
    })
    expect(calls.length).toBe(0)
  })

  test('the database\u2019s own message is returned', async () => {
    failure = 'No such task, or not within your access'
    expect(await saveWorkflowTaskDetails(null, form({ task_id: 't1', comment: 'x' }))).toEqual({
      error: 'No such task, or not within your access',
    })
  })
})

const DOC = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Hello' }] }] }

describe('postWorkflowActivity', () => {
  test('calls the post function with the workflow, the task and the document as given', async () => {
    await postWorkflowActivity('w1', 't1', DOC)
    expect(calls[0]).toEqual({
      name: 'post_workflow_activity',
      args: { p_workflow_id: 'w1', p_task_id: 't1', p_body: DOC, p_parent_post_id: null },
    })
  })

  /**
   * A reply sends only the parent's id. The thread's root is derived by the
   * database from that parent and never travels from here — a client that
   * could name its own root could put a reply in somebody else's conversation.
   */
  test('a reply sends the parent’s id, and nothing about the thread', async () => {
    await postWorkflowActivity('w1', 't1', DOC, 'parent-1')
    expect(calls[0]).toEqual({
      name: 'post_workflow_activity',
      args: { p_workflow_id: 'w1', p_task_id: 't1', p_body: DOC, p_parent_post_id: 'parent-1' },
    })
    expect(JSON.stringify(calls[0])).not.toContain('root')
  })

  test('a post on the workflow itself sends a null task', async () => {
    await postWorkflowActivity('w1', null, DOC)
    expect(calls[0].args).toMatchObject({ p_task_id: null })
  })

  test('the document is sent as a document — never serialised, never HTML', async () => {
    await postWorkflowActivity('w1', 't1', DOC)
    expect(typeof calls[0].args.p_body).toBe('object')
  })

  test('something that is not a document is refused before any call', async () => {
    expect(await postWorkflowActivity('w1', 't1', '<p>hi</p>')).toEqual({ error: 'A post must be a document.' })
    expect(await postWorkflowActivity('w1', 't1', { type: 'paragraph' })).toEqual({ error: 'A post must be a document.' })
    expect(calls.length).toBe(0)
  })

  test('an empty document is refused before any call', async () => {
    expect(await postWorkflowActivity('w1', 't1', { type: 'doc', content: [{ type: 'paragraph' }] })).toEqual({
      error: 'Write something before posting.',
    })
    expect(calls.length).toBe(0)
  })

  test('no workflow is refused before any call', async () => {
    expect(await postWorkflowActivity('', 't1', DOC)).toEqual({ error: 'No workflow selected.' })
    expect(calls.length).toBe(0)
  })

  test('the database’s own message is returned', async () => {
    failure = 'A post may not contain "heading"'
    expect(await postWorkflowActivity('w1', 't1', DOC)).toEqual({ error: 'A post may not contain "heading"' })
  })
})

describe('togglePostReaction', () => {
  test('calls the toggle with the post and the key — the workflow is for revalidation only', async () => {
    await togglePostReaction('w1', 'p1', 'thumbs_up')
    expect(calls[0].name).toBe('toggle_post_reaction')
    expect(calls[0].args).toEqual({ p_post_id: 'p1', p_reaction: 'thumbs_up' })
  })

  test('refuses a key the feed does not offer before any call — the glyph itself included', async () => {
    expect(await togglePostReaction('w1', 'p1', 'poop')).toEqual({ error: 'Not a reaction this feed offers.' })
    expect(await togglePostReaction('w1', 'p1', '👍')).toEqual({ error: 'Not a reaction this feed offers.' })
    expect(calls.length).toBe(0)
  })

  test('refuses a missing post or workflow before any call', async () => {
    expect(await togglePostReaction('w1', '', 'tick')).toEqual({ error: 'No post selected.' })
    expect(await togglePostReaction('', 'p1', 'tick')).toEqual({ error: 'No workflow selected.' })
    expect(calls.length).toBe(0)
  })

  test('returns the database’s own message', async () => {
    failure = 'No such post, or not within your access'
    expect(await togglePostReaction('w1', 'p1', 'tick')).toEqual({ error: 'No such post, or not within your access' })
  })
})

describe('setWorkflowTaskPriority', () => {
  test('calls the priority function with the task and the level', async () => {
    await setWorkflowTaskPriority('t1', 'urgent', 'w1')
    expect(calls[0]).toEqual({ name: 'set_workflow_task_priority', args: { p_id: 't1', p_priority: 'urgent' } })
  })

  test('no task is refused before any call is made', async () => {
    expect(await setWorkflowTaskPriority('', 'low', 'w1')).toEqual({ error: 'No task selected.' })
    expect(calls.length).toBe(0)
  })

  test('the database’s own message is returned', async () => {
    failure = 'No such task, or not within your access'
    expect(await setWorkflowTaskPriority('t1', 'low', 'w1')).toEqual({ error: 'No such task, or not within your access' })
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
