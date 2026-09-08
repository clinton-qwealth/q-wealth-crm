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
  priority: 'medium',
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

  test('a task row carries subject, description, comment and due date', () => {
    show([open, done])
    const row = screen.getByRole('checkbox', { name: /Collect signed authority/ }).closest('li')!
    expect(row.textContent).toContain('Collect signed authority')
    expect(row.textContent).toContain('Client to sign and return')
    expect(row.textContent).toContain('1 Oct 2026')
    const doneRow = screen.getByRole('checkbox', { name: /Send FSG/ }).closest('li')!
    expect(doneRow.textContent).toContain('“Sent by email on the 6th.”')
  })

  test('the assignee is named in words, with no initials tile', () => {
    show([open])
    const row = screen.getByRole('checkbox', { name: /Collect signed authority/ }).closest('li')!
    expect(row.textContent).toContain('Assigned to Sarah Chen')
    // The tile was removed: the name says who it is, and a circle of initials
    // beside it said the same thing twice.
    expect(row.querySelector('span[aria-hidden="true"]')).toBeNull()
    expect(row.textContent).not.toContain('SC')
  })

  test('an unassigned task says so rather than leaving the line blank', () => {
    show([task({ id: 't9', subject: 'Nobody owns this' })])
    const row = screen.getByRole('checkbox', { name: /Nobody owns this/ }).closest('li')!
    expect(row.textContent).toContain('Unassigned')
    expect(row.textContent).not.toContain('Assigned to')
  })

  test('each row carries a priority glyph, and it follows the record', () => {
    const { container } = show([
      task({ id: 'a', subject: 'Urgent one', priority: 'urgent' }),
      task({ id: 'b', subject: 'Low one', priority: 'low' }),
    ])
    const glyphs = [...container.querySelectorAll('li svg[aria-hidden]')]
    expect(glyphs.length).toBe(2)
    // Colour says the level as well as the shape — urgent is red, low is cool.
    expect(glyphs[0].parentElement!.className).toContain('text-red-600')
    expect(glyphs[1].parentElement!.className).toContain('text-sky-600')
  })

  test('the task’s type is a pill after the assignee', () => {
    show([open])
    const footer = screen.getByText('Assigned to Sarah Chen').parentElement!
    expect(footer.textContent).toBe('Assigned to Sarah ChenCheckbox')
    // Set off from the description above it, rather than running into it.
    expect(footer.className).toContain('mt-2')
  })

  /**
   * Scoped to the row, not the screen. The Add task dialog carries its own
   * "Due date" label and a closed <dialog> keeps its contents in the document
   * — the fourth time that has caught a query in this project.
   */
  const rowOf = (subject: string) =>
    screen.getByRole('checkbox', { name: new RegExp(subject) }).closest('li')! as HTMLElement

  test('the due date is labelled, and an overdue one is named as well as coloured', () => {
    // Fixed "today" cannot be injected through the component, so the two cases
    // are a date far in the past and one far in the future.
    show([
      task({ id: 'p', subject: 'Late one', due_at: '2020-01-15' }),
      task({ id: 'f', subject: 'Future one', due_at: '2099-01-15' }),
    ])
    const future = within(rowOf('Future one')).getByText(/^Due date/)
    expect(future.textContent).toContain('15 Jan 2099')
    expect(future.className).not.toContain('text-red-600')

    const late = within(rowOf('Late one')).getByText(/^Overdue/)
    expect(late.textContent).toContain('15 Jan 2020')
    // Colour is never the only signal: the label itself changes.
    expect(late.className).toContain('text-red-600')
  })

  test('a done task with a past due date is not marked overdue', () => {
    show([task({ id: 'd', subject: 'Late but finished', due_at: '2020-01-15', status: 'done' })])
    const row = within(rowOf('Late but finished'))
    expect(row.queryByText(/^Overdue/)).toBeNull()
    expect(row.getByText(/^Due date/).textContent).toContain('15 Jan 2020')
  })

  /**
   * The bug this was written for: a task added through the dialog revalidates
   * the page, the server re-renders with the new row, and the list went on
   * showing the array it had mounted with until the tab was reloaded.
   * `useState(serverValue)` reads its argument once. See useServerState.
   */
  test('rows the server sends after mount replace the list, without a reload', () => {
    const { rerender } = render(<WorkflowTasks workflowId="w1" tasks={[open]} staff={STAFF} />)
    expect(screen.queryByText('Lodge the claim')).toBeNull()

    // What a revalidation delivers: the same component, a new array.
    rerender(
      <WorkflowTasks
        workflowId="w1"
        tasks={[open, task({ id: 't4', subject: 'Lodge the claim' })]}
        staff={STAFF}
      />,
    )
    expect(screen.getByText('Lodge the claim')).toBeTruthy()
    expect(screen.getAllByRole('checkbox').length).toBe(2)
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

  test('the row opens a side panel; the checkbox does not', async () => {
    const user = userEvent.setup()
    const { container } = show([open])
    const panel = () => container.querySelector('dialog.qw-drawer')!
    expect(panel().hasAttribute('open')).toBe(false)

    // Ticking must not open anything — the checkbox is a sibling of the button,
    // not inside it.
    await user.click(screen.getByRole('checkbox', { name: /Collect signed authority/ }))
    expect(panel().hasAttribute('open')).toBe(false)

    await user.click(screen.getByRole('button', { name: 'Open task: Collect signed authority' }))
    expect(panel().hasAttribute('open')).toBe(true)
  })

  test('there is ONE panel for the list, not one per row', () => {
    const { container } = show([open, done, cancelled])
    // A closed <dialog> keeps its contents in the document, so a panel per task
    // would put every task's detail on the page at once.
    expect(container.querySelectorAll('dialog.qw-drawer').length).toBe(1)
  })

  test('the panel shows the task it was opened from, and closes', async () => {
    const user = userEvent.setup()
    const { container } = show([open, done])
    await user.click(screen.getByRole('button', { name: 'Open task: Send FSG' }))

    const panel = container.querySelector('dialog.qw-drawer')!
    expect(panel.querySelector('h2')!.textContent).toBe('Send FSG')
    expect(panel.textContent).toContain('Done')
    expect(panel.textContent).toContain('Sent by email on the 6th.')

    await user.click(within(panel as HTMLElement).getByRole('button', { name: 'Close panel' }))
    expect(panel.hasAttribute('open')).toBe(false)
  })

  test('the panel names an absent value rather than leaving it blank', async () => {
    const user = userEvent.setup()
    const { container } = show([task({ id: 'bare', subject: 'Bare task' })])
    await user.click(screen.getByRole('button', { name: 'Open task: Bare task' }))
    const panel = container.querySelector('dialog.qw-drawer')!
    expect(panel.textContent).toContain('Unassigned')
    // Due date, completed, description and comment are all absent.
    expect([...panel.querySelectorAll('dd')].filter((d) => d.textContent === '—').length).toBe(4)
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
    // Medium by default: an unprioritised task is unremarkable, not low.
    const priority = within(dialog).getByRole<HTMLSelectElement>('combobox', { name: 'Priority' })
    expect(priority.value).toBe('medium')
    expect([...priority.options].map((o) => o.textContent)).toEqual(['Low', 'Medium', 'High', 'Urgent'])

    await user.type(subject, 'Lodge the claim')
    await user.type(within(dialog).getByLabelText('Due date'), '2026-10-15')
    await user.selectOptions(assign, 's2')
    await user.click(within(dialog).getByRole('button', { name: 'Add task' }))

    const sent = vi.mocked(actions.createWorkflowTask).mock.calls.at(-1)![1]
    expect(sent.get('workflow_id')).toBe('w1')
    expect(sent.get('subject')).toBe('Lodge the claim')
    expect(sent.get('due_at')).toBe('2026-10-15')
    expect(sent.get('assigned_to_staff_id')).toBe('s2')
    expect(sent.get('priority')).toBe('medium')
    // No comment field: a comment is what the doer says, not the creator.
    expect(sent.has('comment')).toBe(false)
  })
})
