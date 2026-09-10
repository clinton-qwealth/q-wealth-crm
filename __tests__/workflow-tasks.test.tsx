import type { TaskAction, WorkflowTask } from '@/lib/workflow-board'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

vi.mock('@/app/(shell)/groups/actions', () => ({
  createWorkflowTask: vi.fn(async () => ({ ok: true as const })),
  setWorkflowTaskStatus: vi.fn(async () => ({ ok: true as const })),
  setWorkflowTaskPriority: vi.fn(async () => ({ ok: true as const })),
  saveWorkflowTaskDetails: vi.fn(async () => ({ ok: true as const })),
  recordTaskAction: vi.fn(async () => ({ ok: true as const })),
}))

const actions = await import('@/app/(shell)/groups/actions')
const { WorkflowTasks } = await import('@/components/workflow-tasks')
const { formatCalendarDate, formatNoteDateTime, todayISO } = await import('@/lib/note-date')
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
const VIEWER = { id: 's2', name: 'Clinton Hatcher', email: 'clinton@qwealth.com.au', canRemoveAnyImage: false }
/* No recorded actions by default: History's empty state is the ordinary case. */
let ACTIONS: TaskAction[] = []
const RECIPIENT = { email: 'jane@testsmith.example', name: 'Jane Testsmith' }
const action = (o: Partial<TaskAction> = {}): TaskAction => ({
  id: 'a1',
  workflow_id: 'w1',
  task_id: 't7',
  kind: 'email',
  actor_staff_id: 's2',
  actor_name: 'Clinton Hatcher',
  recipient: 'jane@testsmith.example',
  sender: 'clinton@qwealth.com.au',
  subject: 'Rollover paperwork',
  body: null,
  body_text: '',
  occurred_at: '2026-09-09T04:32:00Z',
  ...o,
})
const show = (tasks: WorkflowTask[]) =>
  render(
    <WorkflowTasks
      workflowId="w1"
      workflowName="Annual review 2026"
      groupName="Testsmith Household"
      tasks={tasks}
      posts={[]}
      actions={ACTIONS}
      recipient={RECIPIENT}
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
        actions={ACTIONS}
        recipient={RECIPIENT}
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
        actions={ACTIONS}
        recipient={RECIPIENT}
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

    test('the eight tools, in order, each a square tile with a glyph', async () => {
      const panel = await tools()
      const names = within(panel)
        .getAllByRole('button')
        .map((b) => b.getAttribute('aria-label'))
      expect(names).toEqual([
        // Email is wired; the rest say so in their own names.
        'Email',
        'SMS — not built yet',
        'DocuSign — Send to sign — not built yet',
        'Generate document — not built yet',
        'Launch workflow — not built yet',
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
    test('Email is live; the other seven are genuinely disabled and say why', async () => {
      const panel = await tools()
      const buttons = within(panel).getAllByRole<HTMLButtonElement>('button')
      expect(buttons).toHaveLength(8)

      const [email, ...rest] = buttons
      expect(email.disabled).toBe(false)
      expect(email.getAttribute('aria-label')).toBe('Email')

      for (const b of rest) {
        expect(b.disabled).toBe(true)
        expect(b.getAttribute('aria-label')).toContain('not built yet')
      }
      // The count is derived from which tiles have a handler, not written twice.
      expect(panel.textContent).toContain('One tile is live; the rest are inactive')
    })

    /**
     * TWO alignments, doing different jobs: the cells pack against the left,
     * and each cell centres its own content. jsdom has no layout engine, so
     * this asserts the mechanism rather than the pixels — a wrapping flex row
     * of fixed-width items (left-packed, slack on the right) whose buttons
     * centre their glyph and label.
     *
     * A grid of equal shares is what the first half replaced: it spread the
     * cells across the whole column, so the tiles were evenly spaced but
     * aligned to nothing.
     */
    test('the cells pack from the left, and each centres its own label', async () => {
      const panel = await tools()
      const list = within(panel).getAllByRole('list')[0]
      // Left-packed: wrapping flex of fixed-width items, not a spreading grid.
      expect(list.className).toContain('flex-wrap')
      expect(list.className).not.toContain('grid')
      for (const item of list.querySelectorAll('li')) {
        expect(item.className).toMatch(/\bw-\d/)
      }
      // Centred within the cell: the label sits under its own glyph.
      const button = within(panel).getAllByRole('button')[0]
      expect(button.className).toContain('items-center')
      expect(button.className).toContain('text-center')
    })

    /**
     * Dashed reads as planned; dimmed reads as broken. A tile going LIVE takes
     * a solid border, so the promotion is visible rather than silent — which
     * is the whole reason the inactive ones were drawn dashed to begin with.
     */
    test('an inactive tile is dashed rather than dimmed; a live one is solid', async () => {
      const panel = await tools()
      const [email, sms] = within(panel).getAllByRole('button')

      const live = email.firstElementChild!
      expect(live.className).not.toContain('border-dashed')

      const inactive = sms.firstElementChild!
      expect(inactive.className).toContain('border-dashed')
      expect(inactive.className).not.toMatch(/opacity-(40|50)/)
    })

    /**
   * The Email tool, built 9 September. Nothing is sent — Send records what was
   * composed — so the assertions are about the fields, the prefills, and the
   * fact that the record is what reaches the server.
   */
  describe('the Email tool', () => {
    /* Calls only — the implementations set in the module mock above stay. Without
       this, "no call was made" would pass or fail depending on which tests ran
       before it. */
    beforeEach(() => vi.clearAllMocks())

    const openEmail = async () => {
      const { user, panel } = await open()
      await user.click(within(panel).getByRole('tab', { name: 'Tools' }))
      await user.click(within(panel).getByRole('button', { name: 'Email' }))
      return { user, dialog: screen.getByRole('dialog', { name: 'Draft Email' }) }
    }

    test('To prefills with the group’s primary contact, as a pill; From is the signed-in user and not editable', async () => {
      const { dialog } = await openEmail()
      /* The prefill arrives ALREADY FINISHED, so it is a pill rather than text
         in the input — the field's own statement of what it understood. */
      expect(
        within(dialog).getByRole('button', { name: 'Remove jane@testsmith.example' }),
      ).toBeTruthy()
      expect(within(dialog).getByRole<HTMLInputElement>('textbox', { name: /^To$/ }).value).toBe('')

      /* The hint names WHO was prefilled and stops there. It briefly also
         explained how to add a second address; the pills and the "Add another"
         placeholder do that job, so the sentence went. */
      const hint = dialog.querySelector('#email-to-hint')!
      expect(hint.textContent).toContain('primary contact for this workflow’s client group')
      expect(hint.textContent).not.toMatch(/press Enter|add it/i)

      // From is TEXT, not a field: an email that could claim to come from a
      // colleague is what the rest of this app refuses by construction.
      expect(dialog.textContent).toContain('clinton@qwealth.com.au')
      expect(within(dialog).queryByRole('textbox', { name: /^From$/ })).toBeNull()

      /* And it LOOKS unavailable: the house read-only ground, with the same
         padding as the two fields below it so all three share a left edge. A
         grey box that did not line up would read as a mistake rather than as a
         field nobody may change. */
      const from = within(dialog).getByText(/^From$/).parentElement!.querySelector('p')!
      expect(from.className).toContain('bg-neutral-50')
      const subject = within(dialog).getByRole('textbox', { name: /^Subject$/ })
      for (const geometry of ['rounded-md', 'px-2.5', 'py-1.5', 'border']) {
        expect(from.className).toContain(geometry)
        expect(subject.className).toContain(geometry)
      }
    })

    /**
     * The template picker sits at the BOTTOM LEFT, with Cancel and Send at the
     * bottom right. It has been among the fields, in the header opposite the
     * title, and beside Send; this is the arrangement it was looking for.
     *
     * jsdom has no layout, so these assert the MECHANISM rather than pixels,
     * and they name the specific element that does the work. An earlier version
     * only asked whether something in the row carried `mr-auto` — which a note
     * on the left satisfied, so the assertion survived the picker moving from
     * one end of the row to the other. It is the picker's own cluster that must
     * carry it.
     */
    test('the template picker sits at the bottom left, opposite Cancel and Send', async () => {
      const { dialog } = await openEmail()
      const template = within(dialog).getByRole('combobox', { name: /Template/ })
      const send = within(dialog).getByRole('button', { name: 'Send' })
      const cancel = within(dialog).getByRole('button', { name: 'Cancel' })

      // The footer row is the picker's and Send's nearest common container.
      const footer = send.parentElement!
      expect(footer.contains(template)).toBe(true)
      expect(footer.contains(cancel)).toBe(true)

      // FIRST in the row, and pinned there: its own cluster takes the margin
      // that pushes everything else to the right.
      const cluster = template.closest('div')!
      const order = Array.from(footer.children)
      expect(order.indexOf(cluster)).toBe(0)
      expect(order.indexOf(cluster)).toBeLessThan(order.indexOf(cancel))
      expect(order.indexOf(cancel)).toBeLessThan(order.indexOf(send))
      expect(cluster.className).toContain('mr-auto')
      expect(footer.className).toContain('justify-end')

      // And it is in neither the header nor the fields.
      const heading = within(dialog).getByRole('heading', { level: 2, name: 'Draft Email' })
      expect(heading.parentElement!.contains(template)).toBe(false)
      const to = within(dialog).getByRole('textbox', { name: /^To$/ })
      expect(to.closest('.overflow-y-auto')!.contains(template)).toBe(false)
    })

    /**
     * The content box is where the writer spends their time, so it opens at
     * roughly ten lines rather than the four a comment box gets. Asserted
     * through the size the editor was asked for, since jsdom has no layout.
     */
    test('the content box opens tall, and Send cannot be scrolled away from', async () => {
      const { dialog } = await openEmail()
      // The editor element is found by its prose class, as the composer's own
      // tests do — ProseMirror's contenteditable carries no textbox role here.
      const body = dialog.querySelector('.qw-post') as HTMLElement
      expect(body).toBeTruthy()
      expect(body.className).toContain('min-h-[15rem]')
      expect(body.className).not.toContain('min-h-[7rem]')

      // Only the fields scroll; the footer holding Send is pinned.
      const send = within(dialog).getByRole('button', { name: 'Send' })
      expect(send.parentElement!.className).toContain('shrink-0')
      expect(body.closest('.overflow-y-auto')).toBeTruthy()
    })

    test('the subject seeds from the task, and the template picker is inactive', async () => {
      const { dialog } = await openEmail()
      expect(within(dialog).getByRole<HTMLInputElement>('textbox', { name: /^Subject$/ }).value).toBe(
        'Confirm the rollover',
      )
      const template = within(dialog).getByRole<HTMLSelectElement>('combobox', { name: /Template/ })
      expect(template.disabled).toBe(true)
      expect(template.getAttribute('aria-label')).toContain('not built yet')
    })

    /**
     * The one claim that must not drift: nothing is delivered, and the dialog
     * says so.
     *
     * It used to say it TWICE — a line of subtext under the title and a note in
     * the footer — and both were removed on 9 September, the subtext for room
     * and the note to give the template picker the bottom left. So the word
     * DRAFT in the title is now the whole warning, which is why this test
     * pins the title itself rather than any sentence in the body. If sending
     * ever becomes real, this is the assertion that has to be changed
     * deliberately.
     */
    test('the dialog is titled a DRAFT, which is the only thing saying nothing is sent', async () => {
      const { dialog } = await openEmail()
      expect(
        within(dialog).getByRole('heading', { level: 2, name: 'Draft Email' }).textContent,
      ).toBe('Draft Email')
      // The dialog's accessible name is the title, so the warning is in it.
      expect(dialog.getAttribute('aria-labelledby')).toBe('email-tool-title')
      expect(dialog.textContent).toMatch(/\bDraft\b/)
      // And it does not claim delivery anywhere.
      expect(dialog.textContent).not.toMatch(/\bSent\b/)
    })

    test('Send records the action with the addresses as they stood, and closes', async () => {
      const { user, dialog } = await openEmail()
      await user.click(within(dialog).getByRole('button', { name: 'Remove jane@testsmith.example' }))
      /* Typed and NOT finished — no Enter, no comma. Send has to count it
         anyway; an address the writer typed and then sent must not be dropped
         because it never became a pill. */
      await user.type(within(dialog).getByRole('textbox', { name: /^To$/ }), 'accountant@example.com')
      await user.click(within(dialog).getByRole('button', { name: 'Send' }))

      // What was RECORDED is what the field said on Send, not the prefill.
      expect(actions.recordTaskAction).toHaveBeenCalledWith(
        'w1',
        't7',
        'email',
        'accountant@example.com',
        'clinton@qwealth.com.au',
        'Confirm the rollover',
        expect.anything(),
      )
      await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Draft Email' })).toBeNull())
    })

    /** The composer's standing contract, extended here: a refusal keeps the words. */
    test('a refused record keeps the modal open, with what was typed still in it', async () => {
      vi.mocked(actions.recordTaskAction).mockResolvedValueOnce({ error: 'Not yours to record' })
      const { user, dialog } = await openEmail()
      await user.click(within(dialog).getByRole('button', { name: 'Send' }))
      expect((await within(dialog).findByRole('alert')).textContent).toContain('Not yours to record')
      expect(screen.getByRole('dialog', { name: 'Draft Email' })).toBeTruthy()
      expect(within(dialog).getByRole<HTMLInputElement>('textbox', { name: /^Subject$/ }).value).toBe(
        'Confirm the rollover',
      )
    })

    test('a blank recipient is refused here, before any call', async () => {
      const { user, dialog } = await openEmail()
      await user.click(within(dialog).getByRole('button', { name: 'Remove jane@testsmith.example' }))
      await user.click(within(dialog).getByRole('button', { name: 'Send' }))
      expect((await within(dialog).findByRole('alert')).textContent).toContain('needs a recipient')
      expect(actions.recordTaskAction).not.toHaveBeenCalled()
    })

    /**
     * The recipient pills, added 9 September. The field is what tells the
     * writer what it understood, one address at a time, so these assert the
     * moment an address becomes a pill and every way of getting there.
     */
    describe('the To field’s pills', () => {
      const toField = async () => {
        const { user, dialog } = await openEmail()
        await user.click(within(dialog).getByRole('button', { name: 'Remove jane@testsmith.example' }))
        return { user, dialog, to: within(dialog).getByRole('textbox', { name: /^To$/ }) }
      }

      test('a finished address becomes a blue pill and the input clears', async () => {
        const { user, dialog, to } = await toField()
        await user.type(to, 'first@example.com{Enter}')

        const pill = within(dialog)
          .getByRole('button', { name: 'Remove first@example.com' })
          .parentElement!
        expect(pill.textContent).toContain('first@example.com')
        /* Blue, deliberately — not brand orange, which reads as something to
           click, and not amber, which is the app's warning tone. */
        expect(pill.className).toMatch(/bg-blue-\d/)
        expect(pill.className).toContain('rounded-full')
        // The input is empty and ready for the next one.
        expect((to as HTMLInputElement).value).toBe('')
      })

      /**
       * NO TRAILING ENTER, deliberately. Typing the whole run and then pressing
       * Enter passes whether or not a space finishes an address, because the
       * commit splits on whitespace anyway — which is how the first version of
       * this test managed to pass with the space handler removed entirely. The
       * assertion is that the FIRST address is already a pill while the second
       * is still being typed.
       */
      test('a second address needs no comma — a space finishes the first', async () => {
        const { user, dialog, to } = await toField()
        await user.type(to, 'one@example.com two@example.com')

        expect(within(dialog).getByRole('button', { name: 'Remove one@example.com' })).toBeTruthy()
        // The space finished an address instead of landing in the field.
        expect((to as HTMLInputElement).value).toBe('two@example.com')
        expect(within(dialog).queryByRole('button', { name: 'Remove two@example.com' })).toBeNull()
      })

      test('a typed comma or semicolon finishes one too, and never lands in the field', async () => {
        const { user, dialog, to } = await toField()

        await user.type(to, 'a@example.com,b@example.com')
        expect(within(dialog).getByRole('button', { name: 'Remove a@example.com' })).toBeTruthy()
        expect((to as HTMLInputElement).value).toBe('b@example.com')

        await user.type(to, ';c@example.com')
        expect(within(dialog).getByRole('button', { name: 'Remove b@example.com' })).toBeTruthy()
        expect((to as HTMLInputElement).value).toBe('c@example.com')
      })

      test('a pasted list becomes pills in one go', async () => {
        const { user, dialog, to } = await toField()
        await user.click(to)
        await user.paste('jo@example.com, sam@example.com; ali@example.com')
        for (const a of ['jo@example.com', 'sam@example.com', 'ali@example.com']) {
          expect(within(dialog).getByRole('button', { name: `Remove ${a}` })).toBeTruthy()
        }
      })

      /**
       * Leaving the field is the EVERYDAY way an address gets finished, and it
       * is one path — blur — not two. Tab was handled separately at first,
       * which masked the blur handler completely: removing the blur commit left
       * every test green because Tab was doing the work. Both ways of leaving
       * are asserted here, and both now go through the same handler.
       */
      test('leaving the field finishes the address being typed', async () => {
        const { user, dialog, to } = await toField()

        // Tabbing away.
        await user.type(to, 'tabbed@example.com')
        await user.tab()
        expect(within(dialog).getByRole('button', { name: 'Remove tabbed@example.com' })).toBeTruthy()

        // And clicking into another field, which sends no Tab key at all.
        await user.type(to, 'clicked@example.com')
        await user.click(within(dialog).getByRole('textbox', { name: /^Subject$/ }))
        expect(within(dialog).getByRole('button', { name: 'Remove clicked@example.com' })).toBeTruthy()
        expect((to as HTMLInputElement).value).toBe('')
      })

      /**
       * The one outcome this field must never produce: silently dropping what
       * somebody typed. Text that is not an address STAYS in the input, and the
       * field says why rather than leaving the writer to notice a missing pill.
       */
      test('text that is not an address is kept, not pilled, and is named', async () => {
        const { user, dialog, to } = await toField()
        await user.type(to, 'not-an-address{Enter}')
        expect((to as HTMLInputElement).value).toBe('not-an-address')
        expect(within(dialog).queryByRole('button', { name: /^Remove not-an-address$/ })).toBeNull()
        expect(dialog.textContent).toContain('does not look like an email address')
        expect(to.getAttribute('aria-invalid')).toBe('true')
      })

      /**
       * Send counts an address that is still being typed WITHOUT relying on the
       * click moving focus first.
       *
       * In a real browser, clicking Send blurs the input and the blur commits
       * the draft, so this path is a second line of defence rather than the
       * everyday one — which is exactly why it needs its own test: driven
       * through `user.click` the blur does the work and the code here is never
       * reached, so the first version of this assertion passed with the whole
       * thing deleted. `fireEvent.click` dispatches the click alone, with no
       * focus change, so what is under test is the send path itself.
       */
      test('Send counts an address still being typed, even with no blur first', async () => {
        const { user, dialog, to } = await toField()
        await user.type(to, 'typed@example.com')
        expect((to as HTMLInputElement).value).toBe('typed@example.com')

        fireEvent.click(within(dialog).getByRole('button', { name: 'Send' }))

        await waitFor(() =>
          expect(actions.recordTaskAction).toHaveBeenCalledWith(
            'w1',
            't7',
            'email',
            'typed@example.com',
            'clinton@qwealth.com.au',
            'Confirm the rollover',
            expect.anything(),
          ),
        )
      })

      test('a half-typed address is refused by Send by name, rather than dropped', async () => {
        const { user, dialog } = await openEmail()
        const to = within(dialog).getByRole('textbox', { name: /^To$/ })
        await user.type(to, 'jane@')
        await user.click(within(dialog).getByRole('button', { name: 'Send' }))
        expect((await within(dialog).findByRole('alert')).textContent).toContain('jane@')
        expect(actions.recordTaskAction).not.toHaveBeenCalled()
      })

      test('the same address twice is not added twice', async () => {
        const { user, dialog, to } = await toField()
        await user.type(to, 'dup@example.com{Enter}dup@example.com{Enter}')
        expect(within(dialog).getAllByRole('button', { name: 'Remove dup@example.com' })).toHaveLength(1)
        expect(dialog.textContent).toContain('already there')
      })

      test('Backspace on an empty input takes the last pill off', async () => {
        const { user, dialog, to } = await toField()
        await user.type(to, 'keep@example.com{Enter}drop@example.com{Enter}')
        await user.type(to, '{Backspace}')
        expect(within(dialog).getByRole('button', { name: 'Remove keep@example.com' })).toBeTruthy()
        expect(within(dialog).queryByRole('button', { name: 'Remove drop@example.com' })).toBeNull()
      })

      /**
       * Removing a pill mid-typing must cost neither the pill list nor the
       * words in the input. The remove button prevents the default on mousedown
       * so focus never leaves the field, which is why the draft survives.
       */
      test('removing a pill while typing keeps what is being typed', async () => {
        const { user, dialog, to } = await toField()
        await user.type(to, 'keep@example.com{Enter}gone@example.com{Enter}')
        await user.type(to, 'typing@example.com')
        await user.click(within(dialog).getByRole('button', { name: 'Remove gone@example.com' }))

        expect((to as HTMLInputElement).value).toBe('typing@example.com')
        expect(within(dialog).getByRole('button', { name: 'Remove keep@example.com' })).toBeTruthy()
        expect(within(dialog).queryByRole('button', { name: 'Remove gone@example.com' })).toBeNull()
        // And it is still the focused field, so typing continues.
        expect(document.activeElement).toBe(to)
      })

      /** Removing a pill takes that address off the record, not just off screen. */
      test('several recipients are recorded on one row, comma-separated and in order', async () => {
        const { user, dialog, to } = await toField()
        await user.type(to, 'first@example.com second@example.com third@example.com{Enter}')
        await user.click(within(dialog).getByRole('button', { name: 'Remove second@example.com' }))
        await user.click(within(dialog).getByRole('button', { name: 'Send' }))

        expect(actions.recordTaskAction).toHaveBeenCalledWith(
          'w1',
          't7',
          'email',
          'first@example.com, third@example.com',
          'clinton@qwealth.com.au',
          'Confirm the rollover',
          expect.anything(),
        )
      })
    })
  })

  /**
   * The History tab, which said "not recorded yet" from the day it was built.
   * It now has a real source for the half that is an ACTION, and still names
   * the half that is missing.
   */
  describe('the History tab', () => {
    const historyWithUser = async () => {
      const { user, panel } = await open()
      await user.click(within(panel).getByRole('tab', { name: 'History' }))
      return { user, panel: within(panel).getByRole('tabpanel', { name: 'History' }) }
    }
    const history = async () => (await historyWithUser()).panel

    test('with nothing recorded it says so, and still names what is missing', async () => {
      ACTIONS = []
      const panel = await history()
      expect(panel.textContent).toContain('Nothing recorded yet')
      // The audit-trigger gap is a separate fact and stays stated.
      expect(panel.textContent).toContain('Field changes are not recorded yet')
    })

    /**
     * The summary is four facts — kind, subject, moment, and who did it to
     * whom. The sender and the message are behind the gate.
     *
     * **This test used to assert the entry never said "sent".** It said
     * "Recorded by <name>", because nothing is delivered and a history claiming
     * an email went out is the lie the record was kept out of the client's file
     * to avoid. The wording was changed on instruction on 9 September, so the
     * assertion is inverted rather than deleted: the sentence is pinned here and
     * the reasoning is on ACTION_SENTENCE. The claim is confined to this line —
     * no `notes` row asserts it, which is what keeps it out of the client's
     * permanent record.
     */
    test('a recorded action shows its kind, subject, moment and what was done', async () => {
      ACTIONS = [action()]
      const panel = await history()
      expect(panel.textContent).toContain('Email')
      expect(panel.textContent).toContain('Rollover paperwork')
      expect(panel.textContent).toContain(formatNoteDateTime('2026-09-09T04:32:00Z'))
      expect(panel.textContent).toContain('You sent an email to jane@testsmith.example')
      expect(panel.textContent).not.toContain('Recorded by')
    })

    /**
     * "You" only when it WAS you. An action a colleague recorded, read back as
     * "You sent an email", would be plainly false to whoever is looking — and
     * the actor id is on the row, so there is no reason to get it wrong.
     */
    test('a colleague’s action names them instead of saying "You"', async () => {
      ACTIONS = [action({ actor_staff_id: 's9', actor_name: 'Dana Fields' })]
      const panel = await history()
      expect(panel.textContent).toContain('Dana Fields sent an email to jane@testsmith.example')
      expect(panel.textContent).not.toContain('You sent')
    })

    /**
     * The gate, added 9 September. An email body is a paragraph or more, so an
     * entry left open means one action fills the panel and the history stops
     * being a history.
     *
     * The RECIPIENT is in the summary now, so what the gate holds is the sender
     * and the message.
     */
    test('an entry opens CLOSED, and the message is not on screen until it is opened', async () => {
      ACTIONS = [action()]
      const { user, panel } = await historyWithUser()

      const gate = within(panel).getByRole('button', { expanded: false })
      expect(panel.textContent).not.toContain('clinton@qwealth.com.au')
      expect(panel.textContent).not.toContain('No message was recorded')

      await user.click(gate)
      expect(within(panel).getByRole('button', { expanded: true })).toBeTruthy()
      expect(panel.textContent).toContain('clinton@qwealth.com.au')
      expect(panel.textContent).toContain('No message was recorded')

      // And it closes again, so the list can be put back the way it was.
      await user.click(within(panel).getByRole('button', { expanded: true }))
      expect(panel.textContent).not.toContain('clinton@qwealth.com.au')
    })

    /**
     * The whole summary row is the gate, not a chevron beside it — a 16px
     * target in a list of entries is a control people miss.
     */
    test('the gate is the summary row itself, carrying the kind, subject and moment', async () => {
      ACTIONS = [action()]
      const { panel } = await historyWithUser()
      const gate = within(panel).getByRole('button', { expanded: false })
      expect(gate.textContent).toContain('Email')
      expect(gate.textContent).toContain('Rollover paperwork')
      expect(gate.textContent).toContain(formatNoteDateTime('2026-09-09T04:32:00Z'))
    })

    /**
     * The kind is a pill with a glyph, and the moment is opposite it. jsdom has
     * no layout, so this asserts the row that splits them and the glyph's
     * presence inside the pill.
     */
    test('the kind is a pill with a glyph, with the date opposite it', async () => {
      ACTIONS = [action()]
      const { panel } = await historyWithUser()
      const gate = within(panel).getByRole('button', { expanded: false })

      const pill = Array.from(gate.querySelectorAll('span')).find((el) =>
        el.className.includes('rounded-full'),
      )!
      expect(pill.textContent).toContain('Email')
      expect(pill.querySelector('svg')).toBeTruthy()

      // Same row as the date, pushed to opposite ends.
      const row = pill.parentElement!
      expect(row.className).toContain('justify-between')
      expect(row.textContent).toContain(formatNoteDateTime('2026-09-09T04:32:00Z'))

      // The subject is BELOW that row, not in it.
      expect(row.textContent).not.toContain('Rollover paperwork')
      expect(gate.textContent).toContain('Rollover paperwork')
    })

    test('only this task’s actions appear', async () => {
      ACTIONS = [action({ id: 'a1', subject: 'Mine' }), action({ id: 'a2', task_id: 'other', subject: 'Someone else’s' })]
      const panel = await history()
      expect(panel.textContent).toContain('Mine')
      expect(panel.textContent).not.toContain('Someone else’s')
    })

    test('an action from a departed colleague still names somebody', async () => {
      /* A DIFFERENT actor, or the viewer check would render "You" and the case
         under test would never be reached. */
      ACTIONS = [action({ actor_staff_id: 's9', actor_name: null })]
      const panel = await history()
      expect(panel.textContent).toContain('no longer on staff')
    })
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
