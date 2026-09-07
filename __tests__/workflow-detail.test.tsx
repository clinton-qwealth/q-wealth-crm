import type { BoardCard } from '@/lib/workflow-board'
import { describe, expect, test, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'

/**
 * The detail page has two jobs today: refuse what it should, and lay out the
 * frame. The frame is tested through WorkflowWorkspace with a fixture; the
 * refusals through the page module with stubbed server dependencies, the way
 * the /groups round-trip test does it.
 */
const rows: Record<string, BoardCard> = {}
const NOT_FOUND = new Error('notFound')
const REDIRECT = new Error('redirect')

vi.mock('next/headers', () => ({ cookies: async () => ({ getAll: () => [], set: () => {} }) }))
vi.mock('next/navigation', () => ({
  notFound: () => { throw NOT_FOUND },
  redirect: () => { throw REDIRECT },
}))
vi.mock('@/lib/staff', () => ({ getCurrentStaff: vi.fn(async () => ({ id: 's1', full_name: 'A Adviser' })) }))
vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: async () => ({
    from: () => {
      let id: string | undefined
      const chain = {
        select: () => chain,
        eq: (_col: string, v: string) => { id = v; return chain },
        maybeSingle: async () => ({ data: (id && rows[id]) ?? null, error: null }),
      }
      return chain
    },
  }),
}))

const staff = await import('@/lib/staff')
const { default: WorkflowPage } = await import('@/app/(shell)/workflows/[id]/page')
const { WorkflowWorkspace } = await import('@/components/workflow-workspace')
const { default: React } = await import('react')

const card: BoardCard = {
  id: 'w1', name: 'Annual review 2026', workflow_type: 'annual_review', status: 'blocked', priority: 'high',
  group_id: 'g1', group_name: 'Testsmith Household', owner_name: 'Sarah Chen',
  started_at: '2026-07-06T02:00:00Z', completed_at: null, updated_at: '2026-07-06T02:00:00Z',
}

describe('the workflow detail page', () => {
  test('the workflow’s name is the page’s one h1, and it sits in the left card', () => {
    const { container } = render(<WorkflowWorkspace workflow={card} />)
    const h1s = container.querySelectorAll('h1')
    expect(h1s.length).toBe(1)
    expect(h1s[0].textContent).toBe('Annual review 2026')
    // Inside the first column's card, not in a header band above the columns.
    const left = container.querySelector('.lg\\:col-span-4')!
    expect(left.contains(h1s[0])).toBe(true)
  })

  test('kind, status and priority sit under the name in the same card', () => {
    const { container } = render(<WorkflowWorkspace workflow={card} />)
    const left = container.querySelector('.lg\\:col-span-4')!
    const h1 = left.querySelector('h1')!
    for (const label of ['Annual review', 'Blocked', 'High']) {
      const mark = within(left as HTMLElement).getByText(label)
      // After the name in the DOM, so it reads as belonging under it.
      expect(h1.compareDocumentPosition(mark) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    }
  })

  test('three columns, 4 / 5 / 3 of twelve — the left column wider than the group page’s', () => {
    const { container } = render(<WorkflowWorkspace workflow={card} />)
    const cols = [...container.querySelectorAll('[class*="lg:col-span-"]')]
      .filter((el) => el.querySelector('section')) // the columns, not the heading grid
      .map((el) => el.className.match(/lg:col-span-(\d+)/)![1])
    expect(cols).toEqual(['4', '5', '3'])
  })

  test('every column holds a placeholder that says what will go there', () => {
    render(<WorkflowWorkspace workflow={card} />)
    expect(screen.getByText(/The client group, the owner and the dates go here/)).toBeTruthy()
    expect(screen.getByText(/Steps and activity for this workflow go here/)).toBeTruthy()
    expect(screen.getByText(/File notes filed under this workflow go here/)).toBeTruthy()
  })

  test('the status pill follows the record — an under-review workflow is not badged as blocked', () => {
    render(<WorkflowWorkspace workflow={{ ...card, status: 'under_review', priority: 'low' }} />)
    expect(screen.getByText('Under review')).toBeTruthy()
    expect(screen.queryByText('Blocked')).toBeNull()
    expect(screen.getByText('Low')).toBeTruthy()
  })

  test('the page renders the workflow it is asked for', async () => {
    rows.w1 = card
    const el = await WorkflowPage({ params: Promise.resolve({ id: 'w1' }) })
    render(el)
    expect(screen.getByRole('heading', { level: 1, name: 'Annual review 2026' })).toBeTruthy()
  })

  test('a workflow that does not exist — or that the caller may not see — is a 404', async () => {
    await expect(WorkflowPage({ params: Promise.resolve({ id: 'nope' }) })).rejects.toBe(NOT_FOUND)
  })

  test('no staff session is sent to sign in before anything is fetched', async () => {
    vi.mocked(staff.getCurrentStaff).mockResolvedValueOnce(null)
    await expect(WorkflowPage({ params: Promise.resolve({ id: 'w1' }) })).rejects.toBe(REDIRECT)
  })
})
