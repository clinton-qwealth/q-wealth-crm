import type { WorkflowTask } from '@/lib/workflow-board'
import { describe, expect, test, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

vi.mock('@/app/(shell)/groups/actions', () => ({
  createWorkflowTask: vi.fn(async () => ({ ok: true as const })),
  setWorkflowTaskStatus: vi.fn(async () => ({ ok: true as const })),
}))

const actions = await import('@/app/(shell)/groups/actions')
const { WorkflowTasks } = await import('@/components/workflow-tasks')
const { default: React } = await import('react')

const task = (o: Partial<WorkflowTask>): WorkflowTask => ({
  id: 't',
  workflow_id: 'w1',
  task_type: 'checkbox',
  subject: 'Task',
  description: null,
  comment: null,
  due_at: null,
  status: 'open',
  assigned_to_staff_id: null,
  assigned_to_name: null,
  completed_at: null,
  created_at: '2026-09-07T00:00:00Z',
  updated_at: '2026-09-07T00:00:00Z',
  ...o,
})

const open = task({
  id: 't1',
  subject: 'Collect signed authority',
  description: 'Client to sign and return the authority to proceed.',
  due_at: '2026-10-01',
  assigned_to_staff_id: 's1',
  assigned_to_name: 'Sarah Chen',
})
const done = task({
  id: 't2',
  subject: 'Send FSG',
  status: 'done',
  completed_at: '2026-09-06T00:00:00Z',
  comment: 'Sent by email on the 6th.',
})
const cancelled = task({ id: 't3', subject: 'Not applicable', status: 'cancelled' })

const STAFF = [
  { id: 's1', name: 'Sarah Chen' },
  { id: 's2', name: 'Clinton Hatcher' },
]
const show = (tasks: WorkflowTask[]) =>
  render(<WorkflowTasks workflowId="w1" tasks={tasks} staff={STAFF} />)

describe('the workflow’s tasks', () => {
  test('the header is the template name’s placeholder on the left and Add task on the right', () => {
    show([])
    const chip = screen.getByText('Workflow template name')
    expect(chip.getAttribute('data-slot')).toBe('placeholder')
    expect(chip.className).toContain('border-dashed')
    const add = screen.getByRole('button', { name: /Add task/ })
    // After the placeholder in the DOM, i.e. to its right in the row.
    expect(chip.compareDocumentPosition(add) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  test('a task row carries subject, description, comment, due date and the assignee’s initials', () => {
    show([open, done])
    const row = screen.getByRole('checkbox', { name: /Collect signed authority/ }).closest('li')!
    expect(row.textContent).toContain('Collect signed authority')
    expect(row.textContent).toContain('Client to sign and return')
    expect(row.textContent).toContain('1 Oct 2026')
    expect(row.querySelector('[title="Sarah Chen"]')!.textContent).toBe('SC')
    const doneRow = screen.getByRole('checkbox', { name: /Send FSG/ }).closest('li')!
    expect(doneRow.textContent).toContain('“Sent by email on the 6th.”')
  })

  test('every task is a checkbox — a boolean selection — labelled by what ticking it does', () => {
    show([open, done])
    const a = screen.getByRole<HTMLInputElement>('checkbox', { name: 'Mark done: Collect signed authority' })
    expect(a.checked).toBe(false)
    const b = screen.getByRole<HTMLInputElement>('checkbox', { name: 'Reopen: Send FSG' })
    expect(b.checked).toBe(true)
    // A done subject is struck through.
    expect(b.closest('li')!.querySelector('.line-through')!.textContent).toBe('Send FSG')
    expect(a.closest('li')!.querySelector('.line-through')).toBeNull()
  })

  test('ticking calls the action for this workflow and checks the box at once', async () => {
    const user = userEvent.setup()
    show([open])
    const box = screen.getByRole<HTMLInputElement>('checkbox', { name: /Collect signed authority/ })
    await user.click(box)
    expect(actions.setWorkflowTaskStatus).toHaveBeenCalledWith('t1', 'done', 'w1')
    expect(screen.getByRole<HTMLInputElement>('checkbox', { name: 'Reopen: Collect signed authority' }).checked).toBe(true)
  })

  test('a refused tick is put back, with the reason', async () => {
    vi.mocked(actions.setWorkflowTaskStatus).mockResolvedValueOnce({ error: 'Not yours to tick' })
    const user = userEvent.setup()
    show([open])
    await user.click(screen.getByRole('checkbox', { name: /Collect signed authority/ }))
    expect((await screen.findByRole('alert')).textContent).toContain('Not yours to tick')
    expect(screen.getByRole<HTMLInputElement>('checkbox', { name: 'Mark done: Collect signed authority' }).checked).toBe(false)
  })

  test('a cancelled task is struck, marked, and cannot be ticked', () => {
    show([cancelled])
    const box = screen.getByRole<HTMLInputElement>('checkbox', { name: /Not applicable/ })
    expect(box.disabled).toBe(true)
    const row = box.closest('li')!
    expect(within(row).getByText('Cancelled')).toBeTruthy()
    expect(row.querySelector('.line-through')).toBeTruthy()
  })

  test('the count reads done over live, and names the cancelled ones separately', () => {
    show([open, done, cancelled])
    expect(screen.getByText('1 of 2 done · 1 cancelled')).toBeTruthy()
  })

  test('no tasks shows the empty state, and says where tasks will come from', () => {
    show([])
    expect(screen.getByText('No tasks yet')).toBeTruthy()
    expect(screen.getByText(/generated from the workflow template/)).toBeTruthy()
  })

  test('a due date is a calendar date and does not slip a day west of Greenwich', () => {
    const original = process.env.TZ
    process.env.TZ = 'America/New_York'
    try {
      show([open])
      expect(screen.getByText('1 Oct 2026')).toBeTruthy()
      expect(screen.queryByText('30 Sep 2026')).toBeNull()
    } finally {
      process.env.TZ = original
    }
  })

  test('Add task opens a dialog with subject, description, due date and assignee, and submits them', async () => {
    const user = userEvent.setup()
    show([])
    await user.click(screen.getByRole('button', { name: /Add task/ }))
    const dialog = screen.getByRole('dialog')

    const subject = within(dialog).getByLabelText('Subject') as HTMLInputElement
    expect(subject.required).toBe(true)
    expect(within(dialog).getByLabelText('Description').tagName).toBe('TEXTAREA')
    expect(within(dialog).getByLabelText('Due date').getAttribute('type')).toBe('date')
    const assign = within(dialog).getByRole<HTMLSelectElement>('combobox', { name: 'Assign to' })
    expect([...assign.options].map((o) => o.textContent)).toEqual(['Unassigned', 'Sarah Chen', 'Clinton Hatcher'])

    await user.type(subject, 'Lodge the claim')
    await user.type(within(dialog).getByLabelText('Due date'), '2026-10-15')
    await user.selectOptions(assign, 's2')
    await user.click(within(dialog).getByRole('button', { name: 'Add task' }))

    const sent = vi.mocked(actions.createWorkflowTask).mock.calls.at(-1)![1]
    expect(sent.get('workflow_id')).toBe('w1')
    expect(sent.get('subject')).toBe('Lodge the claim')
    expect(sent.get('due_at')).toBe('2026-10-15')
    expect(sent.get('assigned_to_staff_id')).toBe('s2')
    // No comment field: a comment is what the doer says, not the creator.
    expect(sent.has('comment')).toBe(false)
  })
})
