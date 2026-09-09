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
const VIEWER = { id: 's2', name: 'Clinton Hatcher', canRemoveAnyImage: false }
const show = (tasks: WorkflowTask[]) =>
  render(
    <WorkflowTasks
      workflowId="w1"
      workflowName="Annual review 2026"
      groupName="Testsmith Household"
      tasks={tasks}
      posts={[]}
      staff={STAFF}
      viewer={VIEWER}
    />,
  )

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

  test('a task row carries subject, description and due date — and no longer the comment', () => {
    show([open, done])
    const row = screen.getByRole('checkbox', { name: /Collect signed authority/ }).closest('li')!
    expect(row.textContent).toContain('Collect signed authority')
    expect(row.textContent).toContain('Client to sign and return')
    expect(row.textContent).toContain('1 Oct 2026')
    /* The comment column is superseded by posts. A row is scanned; what people
       said about a task is read in the panel's feed. */
    const doneRow = screen.getByRole('checkbox', { name: /Send FSG/ }).closest('li')!
    expect(doneRow.textContent).not.toContain('Sent by email')
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

  /**
   * There is one task type. A pill reading "Checkbox" on every row told no row
   * from another, so it went on 9 September — from the row and from the panel.
   * The enum stays in the data for the second kind to arrive.
   */
  test('the row’s footer names the assignee, and does not display the one task type', () => {
    show([open])
    const footer = screen.getByText('Assigned to Sarah Chen').parentElement!
    expect(footer.textContent).toBe('Assigned to Sarah Chen')
    expect(screen.queryByText('Checkbox')).toBeNull()
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
    const { rerender } = render(
      <WorkflowTasks
        workflowId="w1"
        workflowName="Annual review 2026"
        groupName="Testsmith Household"
        tasks={[open]}
        posts={[]}
        staff={STAFF}
        viewer={VIEWER}
      />,
    )
    expect(screen.queryByText('Lodge the claim')).toBeNull()

    // What a revalidation delivers: the same component, a new array.
    rerender(
      <WorkflowTasks
        workflowId="w1"
        workflowName="Annual review 2026"
        groupName="Testsmith Household"
        tasks={[open, task({ id: 't4', subject: 'Lodge the claim' })]}
        posts={[]}
        staff={STAFF}
        viewer={VIEWER}
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
    // The Activity tab is the feed now: a composer, then the posts.
    expect(within(panel as HTMLElement).getByRole('button', { name: 'Post' })).toBeTruthy()
    expect(panel.textContent).not.toContain('Sent by email on the 6th.')

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
    // Due date and description are absent, and each says so with an em-dash
    // rather than rendering blank.
    const dashed = (label: string) =>
      [...panel.querySelectorAll('dt')].find((dt) => dt.textContent === label)!.nextElementSibling!
        .textContent
    for (const label of ['Due date', 'Description']) {
      expect(dashed(label)).toBe('—')
    }
    // Completed is not a field on an OPEN task: "Completed —" would say
    // nothing the Open pill has not. It appears once the task is done.
    expect([...panel.querySelectorAll('dt')].map((dt) => dt.textContent)).not.toContain('Completed')
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

  test('three tabs — Activity, History, Tools — with Activity showing first', async () => {
    const { panel } = await open()
    expect(within(panel).getAllByRole('tab').map((t) => t.textContent)).toEqual([
      'Activity',
      'History',
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
    // withEverything is DONE, so Completed follows the description.
    const labels = [...details.querySelectorAll('dt')].map((dt) => dt.textContent)
    expect(labels).toEqual(['Assigned to', 'Added', 'Due date', 'Description', 'Completed'])
  })

  test('the top row is three fields — assignee, added, due date — with the description below', async () => {
    const { panel } = await open()
    const details = boxOf(panel, 'Edit details')
    const grid = details.querySelector('dl')!
    // Three across, not two: this box is 607px, where a cell fits a real name.
    expect(grid.className).toContain('grid-cols-3')
    expect([...grid.querySelectorAll('dt')].map((dt) => dt.textContent)).toEqual([
      'Assigned to',
      'Added',
      'Due date',
      'Description',
      'Completed',
    ])
    // The description and the completion both cross the whole grid, whatever
    // the column count.
    for (const label of ['Description', 'Completed']) {
      const dt = [...grid.querySelectorAll('dt')].find((d) => d.textContent === label)!
      expect(dt.parentElement!.className).toContain('col-span-full')
    }
    // ...and the first three do not.
    for (const label of ['Assigned to', 'Added', 'Due date']) {
      const dt = [...grid.querySelectorAll('dt')].find((d) => d.textContent === label)!
      expect(dt.parentElement!.className).not.toContain('col-span-full')
    }
  })

  /**
   * Green means live work, and it is the WORKFLOW's rule: `in_progress` is
   * green on a workflow's pill and `complete` is neutral. Until this changed,
   * a done task was green while a completed workflow was grey — the two
   * screens disagreeing about what green meant.
   */
  test('the status pill is green while open and neutral once it has stopped', async () => {
    const pillOf = (panel: HTMLElement, text: string) =>
      within(panel).getByText(text).closest('.ring-1')!

    const a = await open(task({ id: 't7', subject: 'Live one', status: 'open' }))
    expect(pillOf(a.panel, 'Open').className).toContain('emerald')

    const b = await open(task({ id: 't7', subject: 'Done one', status: 'done' }))
    const done = pillOf(b.panel, 'Done')
    expect(done.className).toContain('neutral')
    expect(done.className).not.toContain('emerald')

    const c = await open(task({ id: 't7', subject: 'Dropped one', status: 'cancelled' }))
    expect(pillOf(c.panel, 'Cancelled').className).toContain('neutral')
  })

  /**
   * The eyebrow says WHERE the task is. The panel hides the page behind it, so
   * the client and the workflow are named in the one place they cannot be seen.
   * Until 9 September it read "Task", the client was a grey sentence at the end
   * of the marks row, and the workflow's name was nowhere in the panel.
   */
  test('the eyebrow names the client group and the workflow, above the subject', async () => {
    const { panel } = await open()
    const eyebrow = within(panel).getByText('Testsmith Household · Annual review 2026')
    const subject = within(panel).getByRole('heading', { level: 2, name: 'Confirm the rollover' })
    expect(eyebrow.compareDocumentPosition(subject) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    // Not the old forms.
    expect(panel.textContent).not.toContain('For Testsmith')
    expect(within(panel).queryByText('Task')).toBeNull()
    expect(within(panel).queryByText('Checkbox')).toBeNull()
  })

  /** Two states, one idiom: status and priority are both pills, so they read as a pair. */
  test('status and priority are drawn the same way, as pills', async () => {
    const { panel } = await open()
    const status = within(panel).getByText('Done').closest('.ring-1')!
    const priority = within(panel).getByText('High').closest('.ring-1')!
    expect(status).toBeTruthy()
    expect(priority).toBeTruthy()
    expect(priority.parentElement).toBe(status.parentElement)
  })

  /**
   * The row's tick, reachable from the record. Reading a thread is how someone
   * decides a task is finished, and the only tick used to be behind the inert
   * backdrop. Same `toggle` as the checkbox, so the two cannot disagree.
   */
  test('Mark done in the header sets the status, and becomes Reopen', async () => {
    const { user, panel } = await open(task({ id: 't1', subject: 'Collect signed authority', status: 'open' }))
    const button = within(panel).getByRole('button', { name: 'Mark done' })
    await user.click(button)
    expect(actions.setWorkflowTaskStatus).toHaveBeenCalledWith('t1', 'done', 'w1')
    // Optimistic: the pill and the button both say so at once.
    expect(within(panel).getByText('Done').closest('.ring-1')).toBeTruthy()
    expect(within(panel).getByRole('button', { name: 'Reopen' })).toBeTruthy()
    expect(within(panel).queryByRole('button', { name: 'Mark done' })).toBeNull()
  })

  test('a cancelled task offers neither Mark done nor Reopen', async () => {
    const { panel } = await open(cancelled)
    expect(within(panel).queryByRole('button', { name: 'Mark done' })).toBeNull()
    expect(within(panel).queryByRole('button', { name: 'Reopen' })).toBeNull()
  })

  test('the Activity tab is the feed: a composer above what has been posted, and no comment field', async () => {
    const { panel } = await open()
    const activity = within(panel).getByRole('tabpanel', { name: 'Activity' })
    expect(within(activity).getByRole('button', { name: 'Post' })).toBeTruthy()
    expect(within(activity).getByRole('toolbar', { name: 'Formatting' })).toBeTruthy()
    // No box, no pencil, no comment: the column is superseded by posts.
    expect(within(activity).queryByRole('button', { name: /^Edit /i })).toBeNull()
    expect(activity.textContent).not.toContain('Comment')
    expect(panel.textContent).not.toContain('Sent by email on the 6th.')
  })

  test('History says what is missing rather than showing nothing', async () => {
    const { user, panel } = await open()
    await user.click(within(panel).getByRole('tab', { name: 'History' }))
    expect(within(panel).getByRole('tabpanel', { name: 'History' }).textContent).toContain(
      'not recorded yet',
    )
  })

  /**
   * The Tools tab, built 9 September. Every tile is deliberately inactive, so
   * the assertions are about the SET and about the honesty of the disabled
   * state — not about behaviour, because there is none yet.
   */
  describe('the Tools tab', () => {
    const tools = async () => {
      const { user, panel } = await open()
      await user.click(within(panel).getByRole('tab', { name: 'Tools' }))
      return within(panel).getByRole('tabpanel', { name: 'Tools' })
    }

    test('two sections, Actions then Apps, each an h3 under the panel’s h2', async () => {
      const panel = await tools()
      const headings = within(panel)
        .getAllByRole('heading', { level: 3 })
        .map((h) => h.textContent)
      expect(headings).toEqual(['Actions', 'Apps'])
    })

    test('the seven tools, in order, each a square tile with a glyph', async () => {
      const panel = await tools()
      const names = within(panel)
        .getAllByRole('button')
        .map((b) => b.getAttribute('aria-label'))
      expect(names).toEqual([
        'Email — not built yet',
        'SMS — not built yet',
        'DocuSign — Send to sign — not built yet',
        'Generate document — not built yet',
        'Pathway to Wealth — Wealth modelling — not built yet',
        'How long will my money last — Projection modelling — not built yet',
        'STAR Calculator — Investment modelling — not built yet',
      ])
      // A square: the same height and width class on the tile face, with a glyph in it.
      for (const button of within(panel).getAllByRole('button')) {
        const face = button.firstElementChild!
        expect(face.className).toContain('h-16')
        expect(face.className).toContain('w-16')
        expect(face.querySelector('svg')).toBeTruthy()
      }
    })

    /**
     * A real `disabled`, not `aria-disabled` — so the seven leave the tab
     * order rather than being seven stops that do nothing. The mutation to
     * catch is somebody making them look inactive while still clickable.
     */
    test('every tile is genuinely disabled, and says why in its name', async () => {
      const panel = await tools()
      const buttons = within(panel).getAllByRole('button')
      expect(buttons).toHaveLength(7)
      for (const b of buttons) {
        expect((b as HTMLButtonElement).disabled).toBe(true)
        expect(b.getAttribute('aria-label')).toContain('not built yet')
      }
      expect(panel.textContent).toContain('Every tile is inactive')
    })

    /**
     * Packed from the left, not spread across the column. jsdom has no layout
     * engine, so this asserts the mechanism rather than the pixels: a wrapping
     * flex row of fixed-width items, and a tile that aligns to the start of
     * its item — which together put the first tile on the panel's own left
     * edge. A grid of equal cells is what this replaced, and it centred every
     * tile in its own share of the row.
     */
    test('the tiles pack from the left rather than spreading across the width', async () => {
      const panel = await tools()
      const list = within(panel).getAllByRole('list')[0]
      expect(list.className).toContain('flex-wrap')
      expect(list.className).not.toContain('grid')
      // Fixed-width items, so four fit the column and the slack falls on the right.
      for (const item of list.querySelectorAll('li')) {
        expect(item.className).toMatch(/\bw-\d/)
      }
      // And the tile sits at the start of its item, not centred in it.
      const button = within(panel).getAllByRole('button')[0]
      expect(button.className).toContain('items-start')
      expect(button.className).not.toContain('items-center')
    })

    /** Dashed reads as planned; dimmed reads as broken. See the component note. */
    test('a tile is dashed rather than dimmed', async () => {
      const panel = await tools()
      const face = within(panel).getAllByRole('button')[0].firstElementChild!
      expect(face.className).toContain('border-dashed')
      expect(face.className).not.toMatch(/opacity-(40|50)/)
    })

    /** An app's name does not say what it does, so the descriptor is rendered, not only announced. */
    test('an app shows what it models beneath its name', async () => {
      const panel = await tools()
      expect(within(panel).getByText('Projection modelling')).toBeTruthy()
      expect(within(panel).getByText('How long will my money last')).toBeTruthy()
    })
  })

  test('the Details box is bordered, carries a pencil, and renders nothing submittable while reading', async () => {
    const { panel } = await open()
    const box = boxOf(panel, 'Edit details')
    expect(box.className).toContain('border')
    expect(box.querySelectorAll('input, select, textarea').length).toBe(0)
    // And it is the only field box: the Completion box went with the comment.
    expect(within(panel).queryByRole('button', { name: 'Edit completion' })).toBeNull()
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
