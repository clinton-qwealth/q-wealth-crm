import type { BoardCard } from '@/lib/workflow-board'
import { describe, expect, test, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import React from 'react'

vi.mock('@/app/(shell)/groups/actions', () => ({
  moveWorkflow: vi.fn(async () => ({ ok: true as const })),
  startWorkflow: vi.fn(),
}))

const actions = await import('@/app/(shell)/groups/actions')
const { KanbanBoard } = await import('@/components/kanban-board')
const { columnFor, BOARD_COLUMNS } = await import('@/lib/workflow-board')

const card = (over: Partial<BoardCard>): BoardCard => ({
  id: 'w1', name: 'Annual review 2026', workflow_type: 'annual_review', status: 'in_progress',
  group_id: 'g1', group_name: 'Testsmith Household', owner_name: 'Clinton Hatcher',
  started_at: '2026-09-01T00:00:00Z', completed_at: null, updated_at: '2026-09-06T00:00:00Z',
  ...over,
})

const lane = (label: string) => screen.getByRole('region', { name: label })
const dt = () => {
  const store: Record<string, string> = {}
  return { setData: (k: string, v: string) => { store[k] = v }, getData: (k: string) => store[k] ?? '', effectAllowed: '', dropEffect: '' }
}

describe('columnFor', () => {
  test('a status is its own lane', () => {
    for (const c of BOARD_COLUMNS) expect(columnFor(c.id)).toBe(c.id)
  })
  test('blocked lives in In progress; cancelled is off the board', () => {
    expect(columnFor('blocked')).toBe('in_progress')
    expect(columnFor('cancelled')).toBeNull()
  })
})

describe('KanbanBoard', () => {
  test('four lanes, in order, each counting its cards', () => {
    render(<KanbanBoard cancelled={0} cards={[card({}), card({ id: 'w2', name: 'Onboarding', status: 'not_started' })]} />)
    const names = screen.getAllByRole('region').map((r) => r.getAttribute('aria-labelledby')!.replace('lane-', ''))
    expect(names).toEqual(['not_started', 'in_progress', 'under_review', 'complete'])
    expect(within(lane('Not started')).getByRole('article')).toBeTruthy()
    expect(within(lane('In progress')).getByRole('article')).toBeTruthy()
    expect(within(lane('Under review')).queryByRole('article')).toBeNull()
  })

  test('a blocked workflow sits in In progress wearing the mark', () => {
    render(<KanbanBoard cancelled={0} cards={[card({ status: 'blocked' })]} />)
    const l = lane('In progress')
    expect(within(l).getByRole('article')).toBeTruthy()
    expect(within(l).getByText('Blocked')).toBeTruthy()
  })

  test('cancelled work is not on the board, and the board says so', () => {
    render(<KanbanBoard cancelled={2} cards={[]} />)
    expect(screen.queryByRole('article')).toBeNull()
    expect(screen.getByText(/2 cancelled workflows are not shown/)).toBeTruthy()
  })

  test('dropping a card on a lane moves it there and tells the server', async () => {
    render(<KanbanBoard cancelled={0} cards={[card({})]} />)
    const a = screen.getByRole('article')
    const data = dt()
    fireEvent.dragStart(a, { dataTransfer: data })
    fireEvent.dragOver(lane('Under review'), { dataTransfer: data })
    fireEvent.drop(lane('Under review'), { dataTransfer: data })

    expect(within(lane('Under review')).getByRole('article')).toBeTruthy()
    expect(within(lane('In progress')).queryByRole('article')).toBeNull()
    await waitFor(() => expect(actions.moveWorkflow).toHaveBeenCalledWith('w1', 'under_review'))
  })

  test('the Move-to select is the keyboard path to the same action', async () => {
    const user = userEvent.setup()
    render(<KanbanBoard cancelled={0} cards={[card({})]} />)
    await user.selectOptions(screen.getByRole('combobox', { name: /Move Annual review 2026 to/ }), 'complete')
    expect(within(lane('Completed')).getByRole('article')).toBeTruthy()
    await waitFor(() => expect(actions.moveWorkflow).toHaveBeenCalledWith('w1', 'complete'))
  })

  test('a refused move goes back where it was, with the reason', async () => {
    vi.mocked(actions.moveWorkflow).mockResolvedValueOnce({ error: 'Not within your access' })
    const user = userEvent.setup()
    render(<KanbanBoard cancelled={0} cards={[card({})]} />)
    await user.selectOptions(screen.getByRole('combobox', { name: /Move Annual review 2026 to/ }), 'complete')
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('Not within your access'))
    expect(within(lane('In progress')).getByRole('article')).toBeTruthy()
    expect(within(lane('Completed')).queryByRole('article')).toBeNull()
  })

  test('a DROP the server refuses snaps back too — not only the select path', async () => {
    vi.mocked(actions.moveWorkflow).mockResolvedValueOnce({ error: 'Not within your access' })
    render(<KanbanBoard cancelled={0} cards={[card({})]} />)
    const data = dt()
    fireEvent.dragStart(screen.getByRole('article'), { dataTransfer: data })
    fireEvent.drop(lane('Under review'), { dataTransfer: data })
    expect(within(lane('Under review')).getByRole('article')).toBeTruthy()
    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy())
    expect(within(lane('In progress')).getByRole('article')).toBeTruthy()
    expect(within(lane('Under review')).queryByRole('article')).toBeNull()
  })

  test('dropping a card back on its own lane is not a move', async () => {
    vi.mocked(actions.moveWorkflow).mockClear()
    render(<KanbanBoard cancelled={0} cards={[card({})]} />)
    const data = dt()
    fireEvent.dragStart(screen.getByRole('article'), { dataTransfer: data })
    fireEvent.drop(lane('In progress'), { dataTransfer: data })
    await new Promise((r) => setTimeout(r, 20))
    expect(actions.moveWorkflow).not.toHaveBeenCalled()
  })

  test('but dropping a BLOCKED card on In progress does move — it unblocks', async () => {
    vi.mocked(actions.moveWorkflow).mockClear()
    render(<KanbanBoard cancelled={0} cards={[card({ status: 'blocked' })]} />)
    const data = dt()
    fireEvent.dragStart(screen.getByRole('article'), { dataTransfer: data })
    fireEvent.drop(lane('In progress'), { dataTransfer: data })
    await waitFor(() => expect(actions.moveWorkflow).toHaveBeenCalledWith('w1', 'in_progress'))
    expect(within(lane('In progress')).queryByText('Blocked')).toBeNull()
  })
})
