import type { WorkflowTask } from '@/lib/workflow-board'
import { describe, expect, test, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

vi.mock('@/app/(shell)/groups/actions', () => ({
  createWorkflowTask: vi.fn(async () => ({ ok: true as const })),
  setWorkflowTaskStatus: vi.fn(async () => ({ ok: true as const })),
  setWorkflowTaskPriority: vi.fn(async () => ({ ok: true as const })),
  saveWorkflowTaskDetails: vi.fn(async () => ({ ok: true as const })),
}))

const actions = await import('@/app/(shell)/groups/actions')
const { WorkflowTasks } = await import('@/components/workflow-tasks')
const { formatCalendarDate, todayISO } = await import('@/lib/note-date')
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

/** Every column filled, for the panel: each field has something to render. */
const withEverything = task({
  id: 't7',
  subject: 'Confirm the rollover',
  description: 'Check the receiving fund has the paperwork.',
  comment: 'Sent by email on the 6th.',
  due_at: '2026-10-01',
  status: 'done',
  priority: 'high',
  assigned_to_staff_id: 's1',
  assigned_to_name: 'Sarah Chen',
  completed_at: '2026-09-06T00:00:00Z',
})

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

  test('the priority is a picker at the row’s right, after the subject — not a glyph in front of it', () => {
    show([
      task({ id: 'a', subject: 'Urgent one', priority: 'urgent' }),
      task({ id: 'b', subject: 'Low one', priority: 'low' }),
    ])
    const urgent = screen.getByRole('button', { name: 'Priority: Urgent. Change priority of Urgent one' })
    const low = screen.getByRole('button', { name: 'Priority: Low. Change priority of Low one' })
    // Colour says the level as well as the shape — urgent is red, low is cool.
    expect(urgent.querySelector('svg')!.parentElement!.className).toContain('text-red-600')
    expect(low.querySelector('svg')!.parentElement!.className).toContain('text-sky-600')

    // After the subject in the DOM, i.e. to its right — the subject leads the row.
    const subject = screen.getByText('Urgent one')
    expect(subject.compareDocumentPosition(urgent) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    // And NOT inside the button that opens the panel: a control inside a
    // control is invalid, and changing a priority must not open anything.
    expect(screen.getByRole('button', { name: 'Open task: Urgent one' }).contains(urgent)).toBe(false)
  })

  test('choosing a priority changes the glyph at once and calls the action for this workflow', async () => {
    const user = userEvent.setup()
    show([task({ id: 'a', subject: 'Urgent one', priority: 'urgent' })])
    await user.click(screen.getByRole('button', { name: /Change priority of Urgent one/ }))
    const menu = screen.getByRole('menu', { name: 'Priority of Urgent one' })
    // Hangs from the trigger's RIGHT edge: the trigger sits at the right of the
    // row, and a menu opening rightwards from there would leave the card.
    expect(menu.className).toContain('right-0')
    // And the list is not a clipping sheet: in a browser the sheet's
    // overflow-hidden cut the last row's menu to one reachable item.
    expect(menu.closest('ul.divide-y')!.parentElement!.className).not.toContain('overflow-hidden')
    await user.click(within(menu).getByRole('menuitemradio', { name: /Low/ }))
    expect(actions.setWorkflowTaskPriority).toHaveBeenCalledWith('a', 'low', 'w1')
    expect(screen.getByRole('button', { name: /^Priority: Low\./ })).toBeTruthy()
  })

  test('a refused priority change is put back, with the reason', async () => {
    vi.mocked(actions.setWorkflowTaskPriority).mockResolvedValueOnce({ error: 'Not yours to change' })
    const user = userEvent.setup()
    show([task({ id: 'a', subject: 'Urgent one', priority: 'urgent' })])
    await user.click(screen.getByRole('button', { name: /Change priority of Urgent one/ }))
    await user.click(screen.getByRole('menuitemradio', { name: /Low/ }))
    expect((await screen.findByRole('alert')).textContent).toContain('Not yours to change')
    expect(screen.getByRole('button', { name: /^Priority: Urgent\./ })).toBeTruthy()
  })

  test('the task’s type is a pill after the assignee', () => {
    show([open])
    const footer = screen.getByText('Assigned to Sarah Chen').parentElement!
    expect(footer.textContent).toBe('Assigned to Sarah ChenCheckbox')
    // Set off from the description above it, rather than running into it —
    // 12px, widened from 8 on 8 September.
    expect(footer.className).toContain('mt-3')
  })

  /**
   * Scoped to the row, not the screen. The Add task dialog carries its own
   * "Due date" label and a closed <dialog> keeps its contents in the document
   * — the fourth time that has caught a query in this project.
   */
  const rowOf = (subject: string) =>
    screen.getByRole('checkbox', { name: new RegExp(subject) }).closest('li')! as HTMLElement

  test('the due date is a chip: the date with a calendar glyph, and "Due" for a screen reader', () => {
    show([task({ id: 'f', subject: 'Future one', due_at: '2099-01-15' })])
    const row = rowOf('Future one')
    const chip = within(row).getByText('15 Jan 2099').closest('.ring-1')!
    // Quiet tone, with the glyph, and the word spoken but not printed.
    expect(chip.className).toContain('text-neutral-600')
    expect(chip.querySelector('svg')).toBeTruthy()
    expect(chip.textContent).toBe('Due 15 Jan 2099')
    expect(within(row).getByText('Due').className).toContain('sr-only')
    expect(row.querySelector('.text-red-700, .text-amber-800')).toBeNull()
  })

  test('an overdue task says Overdue, in red — the word as well as the colour', () => {
    show([task({ id: 'p', subject: 'Late one', due_at: '2020-01-15' })])
    const late = within(rowOf('Late one')).getByText(/^Overdue/)
    expect(late.textContent).toBe('Overdue 15 Jan 2020')
    expect(late.className).toContain('text-red-700')
  })

  test('a task due today says so, in amber, with the date a hover away', () => {
    const today = todayISO()
    show([task({ id: 'n', subject: 'Today one', due_at: today })])
    const chip = within(rowOf('Today one')).getByText('Due today')
    expect(chip.className).toContain('text-amber-800')
    expect(chip.getAttribute('title')).toBe(`Due ${formatCalendarDate(today)}`)
  })

  test('a done task with a past due date is not marked overdue — it is finished, not late', () => {
    show([
      task({ id: 'd', subject: 'Late but finished', due_at: '2020-01-15', status: 'done' }),
      task({ id: 'c', subject: 'Today but cancelled', due_at: todayISO(), status: 'cancelled' }),
    ])
    const done = within(rowOf('Late but finished'))
    expect(done.queryByText(/^Overdue/)).toBeNull()
    expect(done.getByText('15 Jan 2020').closest('.ring-1')!.textContent).toBe('Due 15 Jan 2020')
    expect(within(rowOf('Today but cancelled')).queryByText('Due today')).toBeNull()
  })

  test('a long description is clamped to two lines on the row; the panel has the whole text', () => {
    show([task({ id: 'l', subject: 'Long one', description: 'A '.repeat(200) })])
    expect(within(rowOf('Long one')).getByText(/^A A A/).className).toContain('line-clamp-2')
  })

  /**
   * The subject is the task's NAME. Truncating it was safe while the centre
   * column was 6 of 12 and started cutting a long subject the moment it went to
   * 5 — measured in a browser, not guessed.
   */
  test('a long subject wraps rather than being truncated', () => {
    show([task({ id: 'w', subject: 'Chase the accountant for the trust return before the deadline' })])
    const subject = screen.getByText(/^Chase the accountant/)
    expect(subject.className).toContain('line-clamp-2')
    expect(subject.className).not.toContain('truncate')
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
    // not inside it. Nor must changing the priority.
    await user.click(screen.getByRole('checkbox', { name: /Collect signed authority/ }))
    expect(panel().hasAttribute('open')).toBe(false)
    await user.click(screen.getByRole('button', { name: /Change priority of Collect signed authority/ }))
    await user.click(screen.getByRole('menuitemradio', { name: /High/ }))
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
    const panel = container.querySelector('dialog.qw-drawer')! as HTMLElement
    // "Unassigned" is a word, not a gap — the state is worth naming.
    expect(panel.textContent).toContain('Unassigned')
    // Due date, description, completed and comment are all absent, and each
    // says so with an em-dash rather than rendering blank.
    const dashed = (label: string) =>
      [...panel.querySelectorAll('dt')].find((dt) => dt.textContent === label)!.nextElementSibling!
        .textContent
    for (const label of ['Due date', 'Description', 'Completed', 'Comment']) {
      expect(dashed(label)).toBe('—')
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

/**
 * The panel's tabs and its two field boxes.
 *
 * The boxes are `FieldBox` — the shared shell the workflow detail page and the
 * member record panel use — so what is asserted here is what THIS panel puts in
 * them, plus the two rules that travel with the shell and must hold everywhere:
 * nothing submittable while reading, and a box submits only its own fields.
 */
describe('the task panel', () => {
  const open = async (t = withEverything) => {
    const user = userEvent.setup()
    const { container } = show([t])
    await user.click(screen.getByRole('button', { name: `Open task: ${t.subject}` }))
    return { user, panel: container.querySelector('dialog.qw-drawer')! as HTMLElement }
  }

  const boxOf = (panel: HTMLElement, name: string) =>
    within(panel).getByRole('button', { name }).closest('form')! as HTMLElement

  test('three tabs — Activity, Log, Tools — with Activity showing first', async () => {
    const { panel } = await open()
    expect(within(panel).getAllByRole('tab').map((t) => t.textContent)).toEqual([
      'Activity',
      'Log',
      'Tools',
    ])
    expect(within(panel).getByRole('tab', { name: 'Activity' }).getAttribute('aria-selected')).toBe('true')
  })

  test('the tabs sit below the fields, and the description is the last of them', async () => {
    const { panel } = await open()
    const details = boxOf(panel, 'Edit details')
    const strip = within(panel).getByRole('tablist')
    // The box precedes the strip in the DOM, i.e. the tabs are below it.
    expect(details.compareDocumentPosition(strip) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    const labels = [...details.querySelectorAll('dt')].map((dt) => dt.textContent)
    expect(labels).toEqual(['Assigned to', 'Due date', 'Added', 'Description'])
  })

  test('the comment is in the Activity tab, not in the fields box', async () => {
    const { panel } = await open()
    const activity = within(panel).getByRole('tabpanel', { name: 'Activity' })
    expect(activity.textContent).toContain('Sent by email on the 6th.')
    expect(boxOf(panel, 'Edit details').textContent).not.toContain('Sent by email')
  })

  test('Log and Tools say what is missing rather than showing nothing', async () => {
    const { user, panel } = await open()
    await user.click(within(panel).getByRole('tab', { name: 'Log' }))
    expect(within(panel).getByRole('tabpanel', { name: 'Log' }).textContent).toContain(
      'not recorded yet',
    )
    await user.click(within(panel).getByRole('tab', { name: 'Tools' }))
    expect(within(panel).getByRole('tabpanel', { name: 'Tools' }).textContent).toContain('No tools yet')
  })

  test('both boxes are bordered, carry a pencil, and render nothing submittable while reading', async () => {
    const { panel } = await open()
    for (const name of ['Edit details', 'Edit completion']) {
      const box = boxOf(panel, name)
      expect(box.className).toContain('border')
      expect(box.querySelectorAll('input, select, textarea').length).toBe(0)
    }
  })

  test('the details pencil makes the assignee, due date and description editable — but not Added', async () => {
    const { user, panel } = await open()
    const box = boxOf(panel, 'Edit details')
    await user.click(within(box).getByRole('button', { name: 'Edit details' }))
    expect(within(box).getByRole('combobox', { name: 'Assigned to' })).toBeTruthy()
    expect(within(box).getByLabelText('Due date').getAttribute('type')).toBe('date')
    expect(within(box).getByLabelText('Description').tagName).toBe('TEXTAREA')
    // Added is created_at: a record of when the row was made, not a property of
    // the task. It stays a value in both modes.
    expect(within(box).queryByLabelText('Added')).toBeNull()
    expect(within(box).getByText('Added')).toBeTruthy()
  })

  test('saving the details box sends only its own fields — never the comment', async () => {
    const { user, panel } = await open()
    const box = boxOf(panel, 'Edit details')
    await user.click(within(box).getByRole('button', { name: 'Edit details' }))
    await user.selectOptions(within(box).getByRole('combobox', { name: 'Assigned to' }), 's2')
    await user.clear(within(box).getByLabelText('Description'))
    await user.type(within(box).getByLabelText('Description'), 'Rewritten.')
    await user.click(within(box).getByRole('button', { name: 'Save' }))

    const sent = vi.mocked(actions.saveWorkflowTaskDetails).mock.calls.at(-1)![1]
    expect(sent.get('task_id')).toBe('t7')
    expect(sent.get('workflow_id')).toBe('w1')
    expect(sent.get('assigned_to_staff_id')).toBe('s2')
    expect(sent.get('due_at')).toBe('2026-10-01')
    expect(sent.get('description')).toBe('Rewritten.')
    /* The load-bearing one. Both boxes call the SAME patch function, and key
       presence decides what it writes — so a box that submitted a field it does
       not show would clear the other box's column. */
    expect(sent.has('comment')).toBe(false)
    // Back to reading, so the box does not sit open over refreshed values.
    expect(await within(panel).findByRole('button', { name: 'Edit details' })).toBeTruthy()
  })

  test('saving the completion box sends only the comment — never the description', async () => {
    const { user, panel } = await open()
    const box = boxOf(panel, 'Edit completion')
    await user.click(within(box).getByRole('button', { name: 'Edit completion' }))
    await user.clear(within(box).getByLabelText('Comment'))
    await user.type(within(box).getByLabelText('Comment'), 'Client confirmed by phone.')
    await user.click(within(box).getByRole('button', { name: 'Save' }))

    const sent = vi.mocked(actions.saveWorkflowTaskDetails).mock.calls.at(-1)![1]
    expect(sent.get('comment')).toBe('Client confirmed by phone.')
    expect(sent.has('description')).toBe(false)
    expect(sent.has('due_at')).toBe(false)
    expect(sent.has('assigned_to_staff_id')).toBe(false)
    // Completed is stamped by the status function, so it is not submittable.
    expect(sent.has('completed_at')).toBe(false)
  })

  test('an empty field IS sent, because empty means clear', async () => {
    const { user, panel } = await open()
    const box = boxOf(panel, 'Edit details')
    await user.click(within(box).getByRole('button', { name: 'Edit details' }))
    await user.clear(within(box).getByLabelText('Description'))
    await user.click(within(box).getByRole('button', { name: 'Save' }))

    const sent = vi.mocked(actions.saveWorkflowTaskDetails).mock.calls.at(-1)![1]
    expect(sent.has('description')).toBe(true)
    expect(sent.get('description')).toBe('')
  })

  test('a refused save keeps the box open, with the reason', async () => {
    vi.mocked(actions.saveWorkflowTaskDetails).mockResolvedValueOnce({ error: 'Not yours to edit' })
    const { user, panel } = await open()
    const box = boxOf(panel, 'Edit details')
    await user.click(within(box).getByRole('button', { name: 'Edit details' }))
    await user.click(within(box).getByRole('button', { name: 'Save' }))

    expect((await within(box).findByRole('alert')).textContent).toContain('Not yours to edit')
    expect(within(box).getByRole('combobox', { name: 'Assigned to' })).toBeTruthy()
  })

  test('an assignee who has left the directory stays selectable', async () => {
    const { user, panel } = await open(
      task({ id: 't7', subject: 'Departed', assigned_to_staff_id: 'gone', assigned_to_name: 'Old Hand' }),
    )
    const box = boxOf(panel, 'Edit details')
    await user.click(within(box).getByRole('button', { name: 'Edit details' }))
    const select = within(box).getByRole<HTMLSelectElement>('combobox', { name: 'Assigned to' })
    // Without the extra option the select would fall back to Unassigned and the
    // next save would quietly reassign the task to nobody.
    expect(select.value).toBe('gone')
    expect([...select.options].map((o) => o.textContent)).toContain('Old Hand')
  })

  test('a finished task is not marked overdue in the panel either', async () => {
    const { panel } = await open(
      task({ id: 't7', subject: 'Late but done', due_at: '2020-01-15', status: 'done' }),
    )
    const due = [...panel.querySelectorAll('dt')].find((dt) => dt.textContent === 'Due date')!
      .nextElementSibling!
    expect(due.textContent).toBe('Due 15 Jan 2020')
    expect(due.textContent).not.toContain('Overdue')
  })

  test('the priority is shown in the panel but changed from the row', async () => {
    const { panel } = await open()
    expect(panel.textContent).toContain('High')
    // One control for one value: the row's picker. A second here would be a
    // second thing to keep in step.
    expect(within(panel).queryByRole('button', { name: /Change priority/ })).toBeNull()
  })
})
