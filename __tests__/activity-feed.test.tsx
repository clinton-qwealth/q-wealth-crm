import type { PostDoc, WorkflowPost } from '@/lib/workflow-board'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

vi.mock('@/app/(shell)/groups/actions', () => ({
  postWorkflowActivity: vi.fn(async () => ({ ok: true as const })),
  togglePostReaction: vi.fn(async () => ({ ok: true as const })),
}))

/**
 * The composer is ProseMirror, which a test cannot type into the way a person
 * does. It has its own test; here it is a button that hands the feed a fixed
 * document, so what is under test is the feed's own behaviour — ordering,
 * filtering, the optimistic entry, the refusal path, and reactions.
 */
const FIXED_DOC: PostDoc = {
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Posted from the test.' }] }],
}
let lastOnPost: ((doc: PostDoc) => Promise<boolean>) | null = null
vi.mock('@/components/post-composer', () => ({
  PostComposer: ({ onPost }: { onPost: (doc: PostDoc) => Promise<boolean> }) => {
    lastOnPost = onPost
    return (
      <button type="button" onClick={() => onPost(FIXED_DOC)}>
        Post
      </button>
    )
  },
}))

const actions = await import('@/app/(shell)/groups/actions')
const { ActivityFeed } = await import('@/components/activity-feed')
const { default: React } = await import('react')

const post = (o: Partial<WorkflowPost>): WorkflowPost => ({
  id: 'p',
  workflow_id: 'w1',
  task_id: 't1',
  author_staff_id: 's1',
  author_name: 'Sarah Chen',
  body: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Hello' }] }] },
  body_text: 'Hello',
  created_at: '2026-09-08T04:00:00Z',
  mentioned: [],
  reactions: [],
  media: [],
  ...o,
})

const older = post({ id: 'p1', created_at: '2026-09-07T01:00:00Z', body_text: 'Older', body: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Older' }] }] } })
const newer = post({ id: 'p2', created_at: '2026-09-08T09:30:00Z', body_text: 'Newer', body: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Newer' }] }] } })
const onOtherTask = post({ id: 'p3', task_id: 't2', body: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Elsewhere' }] }] } })
const onWorkflow = post({ id: 'p4', task_id: null, body: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Whole workflow' }] }] } })

const STAFF = [{ id: 's1', name: 'Sarah Chen' }, { id: 's2', name: 'Clinton Hatcher' }]
const VIEWER = { id: 's2', name: 'Clinton Hatcher', canRemoveAnyImage: false }
const show = (posts: WorkflowPost[], taskId: string | null = 't1') =>
  render(<ActivityFeed workflowId="w1" taskId={taskId} posts={posts} staff={STAFF} viewer={VIEWER} />)

const items = () => within(screen.getByRole('list', { name: 'Posts' })).getAllByRole('listitem')

describe('the activity feed', () => {
  test('shows the task’s posts in the order given — newest first is the query’s job', () => {
    show([newer, older])
    expect(items().map((li) => li.textContent)).toEqual([
      expect.stringContaining('Newer'),
      expect.stringContaining('Older'),
    ])
  })

  test('shows only this task’s posts, not another task’s and not the workflow’s own', () => {
    show([newer, onOtherTask, onWorkflow])
    expect(items().length).toBe(1)
    expect(screen.queryByText('Elsewhere')).toBeNull()
    expect(screen.queryByText('Whole workflow')).toBeNull()
  })

  test('with no task it is the workflow’s timeline: every post, with or without a task', () => {
    show([newer, onOtherTask, onWorkflow], null)
    expect(items().length).toBe(3)
  })

  test('a post names its author and its time in the reader’s timezone', () => {
    const original = process.env.TZ
    process.env.TZ = 'Australia/Sydney'
    try {
      show([newer]) // 09:30 UTC is 19:30 in Sydney
      const li = items()[0]
      expect(li.textContent).toContain('Sarah Chen')
      expect(li.textContent).toContain('8 Sep 2026, 19:30')
    } finally {
      process.env.TZ = original
    }
  })

  test('nothing posted shows an empty state that says where posts will also appear', () => {
    show([])
    expect(screen.getByText(/Nothing posted yet/).textContent).toContain('workflow’s timeline')
  })

  test('posting shows the new post at the top at once, as the viewer, marked as posting', async () => {
    const user = userEvent.setup()
    let release: (v: { ok: true }) => void = () => {}
    vi.mocked(actions.postWorkflowActivity).mockImplementationOnce(
      () => new Promise((r) => (release = r)),
    )
    show([older])
    await user.click(screen.getByRole('button', { name: 'Post' }))

    const first = items()[0]
    expect(first.textContent).toContain('Posted from the test.')
    expect(first.textContent).toContain('Clinton Hatcher')
    expect(first.textContent).toContain('Posting…')
    expect(items().length).toBe(2)
    expect(actions.postWorkflowActivity).toHaveBeenCalledWith('w1', 't1', FIXED_DOC)
    // Nothing to react to until the server has it.
    expect(within(first).queryByRole('button', { name: 'Add reaction' })).toBeNull()

    release({ ok: true })
    // The composer is told the post was accepted, so it may clear.
    expect(await lastOnPost!(FIXED_DOC)).toBe(true)
  })

  test('a refused post is removed again, the reason shown, and the composer told to keep its words', async () => {
    vi.mocked(actions.postWorkflowActivity).mockResolvedValueOnce({ error: 'A post may not contain "table"' })
    show([older])
    // Through the composer's own callback, so its answer can be checked: false
    // is what tells it not to clear.
    let accepted: boolean | null = null
    await act(async () => {
      accepted = await lastOnPost!(FIXED_DOC)
    })
    expect(accepted).toBe(false)
    expect((await screen.findByRole('alert')).textContent).toContain('may not contain "table"')
    expect(items().length).toBe(1)
    expect(screen.queryByText('Posted from the test.')).toBeNull()
  })

  test('an action that THROWS is a refusal too: the provisional entry goes, a message shows, the words are kept', async () => {
    vi.mocked(actions.postWorkflowActivity).mockRejectedValueOnce(new Error('boom'))
    show([older])
    let accepted: boolean | null = null
    await act(async () => {
      accepted = await lastOnPost!(FIXED_DOC)
    })
    expect(accepted).toBe(false)
    expect((await screen.findByRole('alert')).textContent).toContain('could not be saved')
    expect(items().length).toBe(1)
    expect(screen.queryByText('Posting…')).toBeNull()
  })

  test('posts the server sends after mount replace the list, without a reload', () => {
    const { rerender } = render(
      <ActivityFeed workflowId="w1" taskId="t1" posts={[older]} staff={STAFF} viewer={VIEWER} />,
    )
    expect(items().length).toBe(1)
    rerender(<ActivityFeed workflowId="w1" taskId="t1" posts={[newer, older]} staff={STAFF} viewer={VIEWER} />)
    expect(items().length).toBe(2)
    expect(items()[0].textContent).toContain('Newer')
  })

  test('a mention in a post reads as the person’s current name', () => {
    show([
      post({
        id: 'pm',
        body: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'mention', attrs: { id: 's2', label: 'Clint' } }] }] },
        mentioned: [{ staff_id: 's2', full_name: 'Clinton Hatcher' }],
      }),
    ])
    expect(items()[0].textContent).toContain('@Clinton Hatcher')
  })
})

/**
 * Reactions: a chip per kind with its count, pressed when the viewer is among
 * them, an add button offering the six, and the same optimistic-then-revert
 * contract as every other control on the page.
 */
describe('reactions on a post', () => {
  beforeEach(() => vi.mocked(actions.togglePostReaction).mockClear())
  const reacted = post({
    id: 'pr',
    reactions: [
      { reaction: 'thumbs_up', by: [{ staff_id: 's1', full_name: 'Sarah Chen' }, { staff_id: 's2', full_name: 'Clinton Hatcher' }] },
      { reaction: 'eyes', by: [{ staff_id: 's1', full_name: 'Sarah Chen' }] },
    ],
  })

  test('each kind is a chip with its count, pressed when the viewer gave it, naming who did', () => {
    show([reacted])
    const thumbs = screen.getByRole<HTMLButtonElement>('button', { name: 'Thumbs up: 2' })
    const eyes = screen.getByRole<HTMLButtonElement>('button', { name: 'Looking at this: 1' })
    expect(thumbs.getAttribute('aria-pressed')).toBe('true')
    expect(eyes.getAttribute('aria-pressed')).toBe('false')
    expect(thumbs.title).toBe('Sarah Chen, Clinton Hatcher')
  })

  test('pressing a chip you have not given adds you at once and calls the action; pressing one you have takes you off', async () => {
    const user = userEvent.setup()
    show([reacted])
    await user.click(screen.getByRole('button', { name: 'Looking at this: 1' }))
    expect(screen.getByRole('button', { name: 'Looking at this: 2' }).getAttribute('aria-pressed')).toBe('true')
    expect(actions.togglePostReaction).toHaveBeenCalledWith('w1', 'pr', 'eyes')

    await user.click(screen.getByRole('button', { name: 'Thumbs up: 2' }))
    expect(screen.getByRole('button', { name: 'Thumbs up: 1' }).getAttribute('aria-pressed')).toBe('false')
    expect(actions.togglePostReaction).toHaveBeenCalledWith('w1', 'pr', 'thumbs_up')
  })

  test('taking away the last of a kind removes its chip', async () => {
    const user = userEvent.setup()
    show([post({ id: 'pr', reactions: [{ reaction: 'heart', by: [{ staff_id: 's2', full_name: 'Clinton Hatcher' }] }] })])
    await user.click(screen.getByRole('button', { name: 'Love: 1' }))
    expect(screen.queryByRole('button', { name: /^Love:/ })).toBeNull()
  })

  test('Add reaction opens the six on offer; choosing one adds a new chip and calls the action', async () => {
    const user = userEvent.setup()
    show([reacted])
    await user.click(screen.getByRole('button', { name: 'Add reaction' }))
    const group = screen.getByRole('group', { name: 'Add a reaction' })
    expect(within(group).getAllByRole('button').map((b) => b.getAttribute('aria-label'))).toEqual([
      'Thumbs up', 'Done', 'Looking at this', 'Celebrate', 'Love', 'Thanks',
    ])
    await user.click(within(group).getByRole('button', { name: 'Celebrate' }))
    expect(screen.queryByRole('group', { name: 'Add a reaction' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Celebrate: 1' }).getAttribute('aria-pressed')).toBe('true')
    expect(actions.togglePostReaction).toHaveBeenCalledWith('w1', 'pr', 'party')
  })

  test('a refused reaction is put back, with the reason', async () => {
    const user = userEvent.setup()
    vi.mocked(actions.togglePostReaction).mockResolvedValueOnce({ error: 'permission denied for function toggle_post_reaction' })
    show([reacted])
    await user.click(screen.getByRole('button', { name: 'Looking at this: 1' }))
    expect((await screen.findByRole('alert')).textContent).toContain('permission denied')
    const eyes = screen.getByRole('button', { name: 'Looking at this: 1' })
    expect(eyes.getAttribute('aria-pressed')).toBe('false')
  })

  test('a reaction action that THROWS is put back too', async () => {
    const user = userEvent.setup()
    vi.mocked(actions.togglePostReaction).mockRejectedValueOnce(new Error('boom'))
    show([reacted])
    await user.click(screen.getByRole('button', { name: 'Thumbs up: 2' }))
    expect((await screen.findByRole('alert')).textContent).toContain('could not be saved')
    expect(screen.getByRole('button', { name: 'Thumbs up: 2' }).getAttribute('aria-pressed')).toBe('true')
  })

  test('Escape closes the add-reaction popover without choosing', async () => {
    const user = userEvent.setup()
    show([reacted])
    await user.click(screen.getByRole('button', { name: 'Add reaction' }))
    expect(screen.getByRole('group', { name: 'Add a reaction' })).toBeTruthy()
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('group', { name: 'Add a reaction' })).toBeNull()
    expect(actions.togglePostReaction).not.toHaveBeenCalledWith('w1', 'pr', expect.anything())
  })
})
