import type { BoardCard } from '@/lib/workflow-board'
import { describe, expect, test, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

vi.mock('@/app/(shell)/groups/actions', () => ({
  moveWorkflow: vi.fn(async () => ({ ok: true as const })),
  setWorkflowPriority: vi.fn(async () => ({ ok: true as const })),
  startWorkflow: vi.fn(),
}))

const actions = await import('@/app/(shell)/groups/actions')
const { WorkflowSection, cardSubtitle } = await import('@/components/workflow-section')
const { default: React } = await import('react')

const card = (o: Partial<BoardCard>): BoardCard => ({
  id: 'w',
  name: 'Workflow',
  workflow_type: 'ad_hoc',
  status: 'in_progress',
  priority: 'medium',
  group_id: 'g1',
  group_name: 'Testsmith Household',
  owner_name: 'Sarah Chen',
  started_at: '2026-07-06T02:00:00Z',
  completed_at: null,
  updated_at: '2026-07-06T02:00:00Z',
  ...o,
})

const review = card({ id: 'w1', name: 'Annual review 2026', workflow_type: 'annual_review', priority: 'high' })
const onboarding = card({ id: 'w2', name: 'Onboarding 2024', workflow_type: 'onboarding', status: 'complete', completed_at: '2026-08-01T02:00:00Z' })
const dropped = card({ id: 'w3', name: 'Abandoned SoA', status: 'cancelled' })

const show = (workflows: BoardCard[]) => render(<WorkflowSection groupId="g1" workflows={workflows} />)

describe('the group page’s workflow cards', () => {
  test('each workflow is the board’s card: name, priority button and a Move-to select', () => {
    show([review, onboarding])
    const c = screen.getByRole('article', { name: 'Annual review 2026' })
    expect(within(c).getByRole('button', { name: /^Priority: High/ })).toBeTruthy()
    expect(within(c).getByRole('combobox', { name: 'Move Annual review 2026 to' })).toBeTruthy()
    expect(within(c).getByText('Annual review')).toBeTruthy()
    expect(screen.getByRole('article', { name: 'Onboarding 2024' })).toBeTruthy()
  })

  test('the second line says when the work started or finished, not the group’s name', () => {
    show([review, onboarding])
    const a = screen.getByRole('article', { name: 'Annual review 2026' })
    expect(a.textContent).toContain('Started 6 Jul 2026')
    expect(a.textContent).not.toContain('Testsmith Household')
    const b = screen.getByRole('article', { name: 'Onboarding 2024' })
    expect(b.textContent).toContain('Completed 1 Aug 2026')
  })

  test('cardSubtitle covers every state', () => {
    expect(cardSubtitle(card({ status: 'not_started', started_at: null }))).toBe('Not started yet')
    expect(cardSubtitle(card({ status: 'blocked' }))).toBe('Started 6 Jul 2026')
    expect(cardSubtitle(card({ status: 'complete', completed_at: '2026-08-01T02:00:00Z' }))).toBe('Completed 1 Aug 2026')
    expect(cardSubtitle(card({ status: 'cancelled' }))).toBe('Cancelled')
  })

  test('cancelled work is off the tab, and the tab says how many', () => {
    show([review, dropped])
    expect(screen.queryByRole('article', { name: 'Abandoned SoA' })).toBeNull()
    expect(screen.getByText('1 cancelled workflow is not shown.')).toBeTruthy()
    expect(screen.getByText('1 workflow')).toBeTruthy()
  })

  test('the cards are not draggable here — there is no lane to drag to', () => {
    show([review])
    expect(screen.getByRole('article', { name: 'Annual review 2026' }).getAttribute('draggable')).toBeNull()
  })

  test('the right side is a blank placeholder, hidden from assistive technology', () => {
    const { container } = show([review])
    const slot = container.querySelector('[data-slot="placeholder"]')!
    expect(slot).toBeTruthy()
    expect(slot.getAttribute('aria-hidden')).toBe('true')
    expect(slot.textContent).toBe('')
  })

  test('the Move-to select calls the same action as the board', async () => {
    const user = userEvent.setup()
    show([review])
    await user.selectOptions(screen.getByRole('combobox', { name: 'Move Annual review 2026 to' }), 'under_review')
    expect(actions.moveWorkflow).toHaveBeenCalledWith('w1', 'under_review')
  })

  test('a refused move snaps back with the reason', async () => {
    vi.mocked(actions.moveWorkflow).mockResolvedValueOnce({ error: 'Not yours to move' })
    const user = userEvent.setup()
    show([review])
    const select = screen.getByRole<HTMLSelectElement>('combobox', { name: 'Move Annual review 2026 to' })
    await user.selectOptions(select, 'complete')
    expect((await screen.findByRole('alert')).textContent).toContain('Not yours to move')
    expect(select.value).toBe('in_progress')
  })

  test('no live workflows shows the empty state with the start button', () => {
    show([dropped])
    expect(screen.getByText('No workflows running')).toBeTruthy()
    expect(screen.getByRole('button', { name: /start workflow/i })).toBeTruthy()
    expect(screen.getByText('1 cancelled workflow is not shown.')).toBeTruthy()
  })
})
