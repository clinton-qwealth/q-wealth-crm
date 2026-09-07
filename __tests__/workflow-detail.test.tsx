import type { BoardCard } from '@/lib/workflow-board'
import { describe, expect, test, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

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
  test('the header names the workflow and says what it is, whose it is and where it stands', () => {
    render(<WorkflowWorkspace workflow={card} />)
    expect(screen.getByRole('heading', { level: 1, name: 'Annual review 2026' })).toBeTruthy()
    expect(screen.getByText('Annual review')).toBeTruthy()
    expect(screen.getByText('Blocked')).toBeTruthy()
    expect(screen.getByText('High')).toBeTruthy()
    expect(screen.getByText('Testsmith Household · Owner Sarah Chen · Started 6 Jul 2026')).toBeTruthy()
  })

  test('three columns in the group page’s spans — 3, 6 and 3 of twelve', () => {
    const { container } = render(<WorkflowWorkspace workflow={card} />)
    const cols = [...container.querySelectorAll('[class*="lg:col-span-"]')]
      .filter((el) => el.querySelector('section')) // the columns, not the heading grid
      .map((el) => el.className.match(/lg:col-span-(\d+)/)![1])
    expect(cols).toEqual(['3', '6', '3'])
  })

  test('every column holds a placeholder that says what will go there', () => {
    render(<WorkflowWorkspace workflow={card} />)
    expect(screen.getByText(/Kind, status, priority, owner and dates go here/)).toBeTruthy()
    expect(screen.getByText(/Steps and activity for this workflow go here/)).toBeTruthy()
    expect(screen.getByText(/File notes filed under this workflow go here/)).toBeTruthy()
  })

  test('a completed workflow says when it finished; an unstarted one says so', () => {
    const { unmount } = render(
      <WorkflowWorkspace workflow={{ ...card, status: 'complete', completed_at: '2026-08-01T02:00:00Z' }} />,
    )
    expect(screen.getByText(/Completed 1 Aug 2026$/)).toBeTruthy()
    unmount()
    render(<WorkflowWorkspace workflow={{ ...card, status: 'not_started', started_at: null, owner_name: null }} />)
    expect(screen.getByText('Testsmith Household · No owner · Not started yet')).toBeTruthy()
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
