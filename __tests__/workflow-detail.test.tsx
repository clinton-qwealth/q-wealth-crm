import type { WorkflowDetail } from '@/lib/workflow-board'
import { describe, expect, test, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'

/**
 * The detail page has two jobs today: refuse what it should, and lay out the
 * frame. The frame is tested through WorkflowWorkspace with a fixture; the
 * refusals through the page module with stubbed server dependencies, the way
 * the /groups round-trip test does it.
 */
const rows: Record<string, WorkflowDetail> = {}
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

const card: WorkflowDetail = {
  id: 'w1', name: 'Annual review 2026', workflow_type: 'annual_review', status: 'blocked', priority: 'high',
  group_id: 'g1', group_name: 'Testsmith Household', owner_name: 'Sarah Chen',
  started_at: '2026-07-06T02:00:00Z', completed_at: null, updated_at: '2026-07-06T02:00:00Z',
  created_at: '2026-07-06T02:00:00Z', due_at: '2026-09-30',
  description: 'Refresh the fact find and test the portfolio against the strategy.',
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

  test('kind, status and priority sit in one row directly under the name', () => {
    const { container } = render(<WorkflowWorkspace workflow={card} />)
    const h1 = container.querySelector('h1')!
    const marks = h1.nextElementSibling as HTMLElement
    // After the name in the DOM, so it reads as belonging under it...
    expect(h1.compareDocumentPosition(marks) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    // ...and in that order, kind then status then priority.
    expect([...marks.children].map((c) => c.textContent)).toEqual([
      'Annual review',
      'Blocked',
      'High',
    ])
  })

  /**
   * The status is printed twice in this card — as a pill under the name and as
   * the progress bar's left-hand label. That is deliberate, asked for, and the
   * reason several queries in this file are scoped rather than global: an
   * unscoped getByText('Blocked') now matches two elements. Asserting the
   * duplication keeps it a decision rather than something that looks like a
   * bug to the next reader.
   */
  test('the status is said twice on purpose: as a pill, and as the bar’s label', () => {
    const { container } = render(<WorkflowWorkspace workflow={card} />)
    expect(screen.getAllByText('Blocked').length).toBe(2)
    const marks = container.querySelector('h1')!.nextElementSibling as HTMLElement
    const barRow = screen.getByRole('progressbar').previousElementSibling!
    expect(within(marks).getByText('Blocked')).toBeTruthy()
    expect(barRow.firstElementChild!.textContent).toBe('Blocked')
  })

  test('three columns, 4 / 5 / 3 of twelve — the left column wider than the group page’s', () => {
    const { container } = render(<WorkflowWorkspace workflow={card} />)
    const cols = [...container.querySelectorAll('[class*="lg:col-span-"]')]
      .filter((el) => el.querySelector('section')) // the columns, not the heading grid
      .map((el) => el.className.match(/lg:col-span-(\d+)/)![1])
    expect(cols).toEqual(['4', '5', '3'])
  })

  test('the two unbuilt columns say what will go there; the left one no longer needs to', () => {
    const { container } = render(<WorkflowWorkspace workflow={card} />)
    expect(screen.getByText(/Steps and activity for this workflow go here/)).toBeTruthy()
    expect(screen.getByText(/File notes filed under this workflow go here/)).toBeTruthy()
    // The left column's placeholder named the group, owner and dates. Those are
    // real fields now, so the placeholder is gone rather than sitting under them.
    const left = container.querySelector('.lg\\:col-span-4')!
    expect(left.querySelector('.border-dashed')).toBeNull()
    // Exactly two placeholders remain on the page, both outside the left column.
    expect(container.querySelectorAll('.border-dashed').length).toBe(2)
  })

  test('three fields across one row: owner, date started, due date', () => {
    const { container } = render(<WorkflowWorkspace workflow={card} />)
    const row = container.querySelector('dl.grid-cols-3')!
    expect([...row.querySelectorAll('dt')].map((d) => d.textContent)).toEqual([
      'Owner',
      'Date started',
      'Due date',
    ])
    expect(row.textContent).toContain('Sarah Chen')
    expect(row.textContent).toContain('6 Jul 2026')
    expect(row.textContent).toContain('30 Sep 2026')
  })

  test('the due date is a calendar date and does not slip a day west of Greenwich', () => {
    const original = process.env.TZ
    process.env.TZ = 'America/New_York'
    try {
      render(<WorkflowWorkspace workflow={card} />)
      // `new Date('2026-09-30')` is UTC midnight, which renders as the 29th here.
      // Splitting the string is the only way this reads as written.
      expect(screen.getByText('30 Sep 2026')).toBeTruthy()
      expect(screen.queryByText('29 Sep 2026')).toBeNull()
    } finally {
      process.env.TZ = original
    }
  })

  test('the description gets its own row beneath the three fields', () => {
    const { container } = render(<WorkflowWorkspace workflow={card} />)
    const lists = [...container.querySelectorAll('dl')]
    expect(lists.length).toBe(2)
    expect(lists[1].querySelector('dt')!.textContent).toBe('Description')
    expect(lists[1].textContent).toContain('Refresh the fact find')
  })

  test('a field with nothing in it reads as an em-dash, not a blank', () => {
    const { container } = render(
      <WorkflowWorkspace workflow={{ ...card, owner_name: null, due_at: null, description: null }} />,
    )
    const dds = [...container.querySelectorAll('dd')].map((d) => d.textContent)
    // Owner, due date and description are all absent; date started is not.
    expect(dds.filter((t) => t === '—').length).toBe(3)
  })

  test('the status pill follows the record — an under-review workflow is not badged as blocked', () => {
    const { container } = render(
      <WorkflowWorkspace workflow={{ ...card, status: 'under_review', priority: 'low' }} />,
    )
    const marks = container.querySelector('h1')!.nextElementSibling as HTMLElement
    expect([...marks.children].map((c) => c.textContent)).toEqual([
      'Annual review',
      'Under review',
      'Low',
    ])
    expect(screen.queryByText('Blocked')).toBeNull()
  })

  test('the progress bar is green, labelled by status, and reports a percentage', () => {
    const { container } = render(<WorkflowWorkspace workflow={{ ...card, status: 'in_progress' }} />)
    const bar = screen.getByRole('progressbar')
    expect(bar.getAttribute('aria-valuenow')).toBe('33')
    expect(bar.getAttribute('aria-valuetext')).toBe('In progress, 33% complete')
    const fill = bar.firstElementChild as HTMLElement
    expect(fill.className).toContain('bg-emerald-600')
    expect(fill.style.width).toBe('33%')
    // The label and the figure sit at the two ends of the row above the bar.
    const row = bar.previousElementSibling!
    expect(row.firstElementChild!.textContent).toBe('In progress')
    expect(row.lastElementChild!.textContent).toBe('33%')
  })

  test('progress runs 0 / 33 / 67 / 100 across the four stages, and blocked holds its place', () => {
    for (const [status, percent] of [
      ['not_started', '0'],
      ['in_progress', '33'],
      ['blocked', '33'],
      ['under_review', '67'],
      ['complete', '100'],
    ] as const) {
      const { unmount } = render(<WorkflowWorkspace workflow={{ ...card, status }} />)
      expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe(percent)
      unmount()
    }
  })

  test('cancelled work reports no percentage rather than claiming nothing was done', () => {
    render(<WorkflowWorkspace workflow={{ ...card, status: 'cancelled' }} />)
    const bar = screen.getByRole('progressbar')
    expect(bar.getAttribute('aria-valuenow')).toBeNull()
    expect(bar.getAttribute('aria-valuetext')).toBe('Cancelled')
    expect((bar.firstElementChild as HTMLElement).className).not.toContain('emerald')
    expect(bar.previousElementSibling!.lastElementChild!.textContent).toBe('—')
  })

  test('the bar says Complete when the work is finished', () => {
    render(<WorkflowWorkspace workflow={{ ...card, status: 'complete' }} />)
    const row = screen.getByRole('progressbar').previousElementSibling!
    expect(row.firstElementChild!.textContent).toBe('Complete')
    expect(row.lastElementChild!.textContent).toBe('100%')
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
