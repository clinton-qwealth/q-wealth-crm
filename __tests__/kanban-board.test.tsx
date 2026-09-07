import type { BoardCard } from '@/lib/workflow-board'
import { describe, expect, test, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import React from 'react'

vi.mock('@/app/(shell)/groups/actions', () => ({
  moveWorkflow: vi.fn(async () => ({ ok: true as const })),
  setWorkflowPriority: vi.fn(async () => ({ ok: true as const })),
  startWorkflow: vi.fn(),
}))

const actions = await import('@/app/(shell)/groups/actions')
const { KanbanBoard } = await import('@/components/kanban-board')
const { columnFor, BOARD_COLUMNS, applyFilters, filterOptions, reconcileFilters, NO_FILTERS, UNASSIGNED } = await import('@/lib/workflow-board')

const card = (over: Partial<BoardCard>): BoardCard => ({
  id: 'w1', name: 'Annual review 2026', workflow_type: 'annual_review', status: 'in_progress', priority: 'medium',
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

describe('priority', () => {
  const glyph = () => screen.getByRole('button', { name: /^Priority: / })

  test('a card shows its priority as a labelled glyph button', () => {
    render(<KanbanBoard cancelled={0} cards={[card({ priority: 'high' })]} />)
    expect(glyph().getAttribute('aria-label')).toMatch(/^Priority: High/)
    expect(glyph().querySelector('svg')).toBeTruthy()
  })

  test('pressing it opens a menu of the four levels with the current one checked', async () => {
    const user = userEvent.setup()
    render(<KanbanBoard cancelled={0} cards={[card({})]} />)
    await user.click(glyph())
    const items = screen.getAllByRole('menuitemradio')
    expect(items.map((i) => i.textContent?.replace(/now$/, ''))).toEqual(['Low', 'Medium', 'High', 'Urgent'])
    expect(items[1].getAttribute('aria-checked')).toBe('true')
  })

  test('choosing a level updates the glyph at once and tells the server', async () => {
    const user = userEvent.setup()
    render(<KanbanBoard cancelled={0} cards={[card({})]} />)
    await user.click(glyph())
    await user.click(screen.getByRole('menuitemradio', { name: /Urgent/ }))
    expect(glyph().getAttribute('aria-label')).toMatch(/^Priority: Urgent/)
    expect(screen.queryByRole('menu')).toBeNull()
    await waitFor(() => expect(actions.setWorkflowPriority).toHaveBeenCalledWith('w1', 'urgent'))
  })

  test('a refused change reverts the glyph with the reason', async () => {
    vi.mocked(actions.setWorkflowPriority).mockResolvedValueOnce({ error: 'Not within your access' })
    const user = userEvent.setup()
    render(<KanbanBoard cancelled={0} cards={[card({})]} />)
    await user.click(glyph())
    await user.click(screen.getByRole('menuitemradio', { name: /Low/ }))
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('Not within your access'))
    expect(glyph().getAttribute('aria-label')).toMatch(/^Priority: Medium/)
  })

  test('Escape closes the menu without changing anything', async () => {
    vi.mocked(actions.setWorkflowPriority).mockClear()
    const user = userEvent.setup()
    render(<KanbanBoard cancelled={0} cards={[card({})]} />)
    await user.click(glyph())
    expect(screen.getByRole('menu')).toBeTruthy()
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('menu')).toBeNull()
    expect(actions.setWorkflowPriority).not.toHaveBeenCalled()
  })
})

describe('filters', () => {
  const set = [
    card({ id: 'a', name: 'A review', owner_name: 'Clinton Hatcher', workflow_type: 'annual_review', priority: 'high' }),
    card({ id: 'b', name: 'B claim', owner_name: 'Sarah Chen', workflow_type: 'insurance_claim', priority: 'urgent' }),
    card({ id: 'c', name: 'C onboarding', owner_name: 'Sarah Chen', workflow_type: 'onboarding', priority: 'medium' }),
    card({ id: 'd', name: 'D ad hoc', owner_name: null, workflow_type: 'ad_hoc', priority: 'low' }),
  ]

  test('applyFilters ANDs the three layers', () => {
    expect(applyFilters(set, { ...NO_FILTERS, owner: 'Sarah Chen' }).map((c) => c.id)).toEqual(['b', 'c'])
    expect(applyFilters(set, { owner: 'Sarah Chen', type: 'onboarding', priority: null }).map((c) => c.id)).toEqual(['c'])
    expect(applyFilters(set, { owner: 'Sarah Chen', type: 'onboarding', priority: 'urgent' })).toEqual([])
    expect(applyFilters(set, { ...NO_FILTERS, owner: UNASSIGNED }).map((c) => c.id)).toEqual(['d'])
  })

  test('each layer is offered only what the layers above leave', () => {
    const o = filterOptions(set, { ...NO_FILTERS, owner: 'Sarah Chen' })
    expect(o.types).toEqual(['insurance_claim', 'onboarding'])
    expect(o.priorities).toEqual(['medium', 'urgent'])
    const o2 = filterOptions(set, { owner: 'Sarah Chen', type: 'onboarding', priority: null })
    expect(o2.priorities).toEqual(['medium'])
    // owners are alphabetical with Unassigned last
    expect(filterOptions(set, NO_FILTERS).owners).toEqual(['Clinton Hatcher', 'Sarah Chen', UNASSIGNED])
  })

  test('a downstream filter the upstream change strands is cleared, not left matching nothing', () => {
    const r = reconcileFilters(set, { owner: 'Clinton Hatcher', type: 'insurance_claim', priority: 'urgent' })
    expect(r).toEqual({ owner: 'Clinton Hatcher', type: null, priority: null })
  })

  test('the board shows only matching cards, counts them, and clears', async () => {
    const user = userEvent.setup()
    render(<KanbanBoard cancelled={0} cards={set} />)
    expect(screen.getAllByRole('article')).toHaveLength(4)
    await user.selectOptions(screen.getByRole('combobox', { name: 'Filter by owner' }), 'Sarah Chen')
    expect(screen.getAllByRole('article').map((a) => a.getAttribute('aria-label'))).toEqual(['B claim', 'C onboarding'])
    expect(screen.getByText('Showing 2 of 4')).toBeTruthy()
    // the type filter now offers only Sarah's kinds
    const typeOpts = [...screen.getByRole('combobox', { name: 'Filter by type' }).querySelectorAll('option')].map((o) => o.textContent)
    expect(typeOpts).toEqual(['All types', 'Insurance claim', 'Onboarding'])
    await user.click(screen.getByRole('button', { name: 'Clear' }))
    expect(screen.getAllByRole('article')).toHaveLength(4)
    expect(screen.queryByText(/Showing/)).toBeNull()
  })

  test('an emptied lane says nothing matches, not nothing here', async () => {
    const user = userEvent.setup()
    render(<KanbanBoard cancelled={0} cards={set} />)
    await user.selectOptions(screen.getByRole('combobox', { name: 'Filter by owner' }), UNASSIGNED)
    expect(screen.getAllByText('Nothing matches').length).toBeGreaterThan(0)
    expect(screen.queryByText('Nothing here')).toBeNull()
  })
})
