import type { WorkflowDetail } from '@/lib/workflow-board'
import { describe, expect, test, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

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
/* The left card's marks are editable, so the workspace now renders a Client
   Component that imports the server actions. Mocked so the component's own
   behaviour can be tested; the actions themselves run against the database. */
vi.mock('@/app/(shell)/groups/actions', () => ({
  setWorkflowStatus: vi.fn(async () => ({ ok: true as const })),
  setWorkflowPriority: vi.fn(async () => ({ ok: true as const })),
  saveWorkflowDetails: vi.fn(async () => ({ ok: true as const })),
  createWorkflowTask: vi.fn(async () => ({ ok: true as const })),
  setWorkflowTaskStatus: vi.fn(async () => ({ ok: true as const })),
  setWorkflowTaskPriority: vi.fn(async () => ({ ok: true as const })),
  saveWorkflowTaskDetails: vi.fn(async () => ({ ok: true as const })),
}))
vi.mock('next/navigation', () => ({
  notFound: () => { throw NOT_FOUND },
  redirect: () => { throw REDIRECT },
}))
vi.mock('@/lib/staff', () => ({ getCurrentStaff: vi.fn(async () => ({ id: 's1', full_name: 'A Adviser' })) }))
vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: async () => ({
    from: (table: string) => {
      let id: string | undefined
      const chain: Record<string, unknown> = {
        select: () => chain,
        eq: (_col: string, v: string) => {
          if (table === 'workflow_board') id = v
          return chain
        },
        /* order() returns the chain, not a promise: the task query chains two
           of them — due date, then created_at as the tie-break. The chain is
           thenable instead, so `await`ing it ends the query. */
        order: () => chain,
        then: (resolve: (v: unknown) => unknown) =>
          Promise.resolve({
            data: table === 'staff_directory' ? [{ id: 's1', full_name: 'A Adviser', status: 'active' }] : [],
            error: null,
          }).then(resolve),
        maybeSingle: async () => ({ data: (id && rows[id]) ?? null, error: null }),
      }
      return chain
    },
  }),
}))

const staff = await import('@/lib/staff')
const actions = await import('@/app/(shell)/groups/actions')
const { default: WorkflowPage } = await import('@/app/(shell)/workflows/[id]/page')
const { WorkflowWorkspace } = await import('@/components/workflow-workspace')
const { default: React } = await import('react')

const card: WorkflowDetail = {
  id: 'w1', name: 'Annual review 2026', workflow_type: 'annual_review', status: 'blocked', priority: 'high',
  group_id: 'g1', group_name: 'Testsmith Household', owner_name: 'Sarah Chen',
  started_at: '2026-07-06T02:00:00Z', completed_at: null, updated_at: '2026-07-06T02:00:00Z',
  owner_staff_id: 's1', created_at: '2026-07-06T02:00:00Z', due_at: '2026-09-30',
  description: 'Refresh the fact find and test the portfolio against the strategy.',
}

const STAFF = [
  { id: 's1', name: 'Sarah Chen' },
  { id: 's2', name: 'Clinton Hatcher' },
]

/** Every render goes through here so the staff list is not repeated. */
const VIEWER = { id: 's1', name: 'Sarah Chen' }
const show = (workflow: WorkflowDetail = card) =>
  render(<WorkflowWorkspace workflow={workflow} staff={STAFF} tasks={[]} posts={[]} viewer={VIEWER} />)

describe('the workflow detail page', () => {
  test('the workflow’s name is the page’s one h1, and it sits in the left card', () => {
    const { container } = show()
    const h1s = container.querySelectorAll('h1')
    expect(h1s.length).toBe(1)
    expect(h1s[0].textContent).toBe('Annual review 2026')
    // Inside the first column's card, not in a header band above the columns.
    const left = container.querySelector('.lg\\:col-span-3')!
    expect(left.contains(h1s[0])).toBe(true)
  })

  test('kind, status and priority sit in one row directly under the name', () => {
    const { container } = show()
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
    const { container } = show()
    expect(screen.getAllByText('Blocked').length).toBe(2)
    const marks = container.querySelector('h1')!.nextElementSibling as HTMLElement
    const barRow = screen.getByRole('progressbar').previousElementSibling!
    expect(within(marks).getByText('Blocked')).toBeTruthy()
    expect(barRow.firstElementChild!.textContent).toBe('Blocked')
  })

  /**
   * 3 / 5 / 4 since 8 September: the right column was widened by one step and
   * the centre gave up the point. The page no longer matches the group page's
   * 3 / 6 / 3, deliberately — the assertion that would catch a stray change to
   * the proportions, and the one that records they are no longer shared.
   */
  test('three columns, 3 / 5 / 4 of twelve — the right column one point wider', () => {
    const { container } = show()
    const cols = [...container.querySelectorAll('[class*="lg:col-span-"]')]
      .filter((el) => el.querySelector('section')) // the columns, not the heading grid
      .map((el) => el.className.match(/lg:col-span-(\d+)/)![1])
    expect(cols).toEqual(['3', '5', '4'])
    expect(cols.reduce((a, b) => a + Number(b), 0)).toBe(12)
  })

  /**
   * The wiring, not the rendering: the panel names the CLIENT GROUP, and the
   * only place that name exists is the workflow row the page fetched. A test
   * that rendered the task list directly would pass with any string passed in.
   */
  test('a task opened from the page names the client group the workflow is for', async () => {
    const user = userEvent.setup()
    const { container } = render(
      <WorkflowWorkspace
        workflow={card}
        staff={STAFF}
        posts={[]}
        viewer={VIEWER}
        tasks={[
          {
            id: 't1', workflow_id: 'w1', task_type: 'checkbox', subject: 'Collect the authority',
            description: null, comment: null, due_at: null, status: 'open', priority: 'medium',
            assigned_to_staff_id: null, assigned_to_name: null, completed_at: null,
            created_at: '2026-09-07T00:00:00Z', updated_at: '2026-09-07T00:00:00Z',
          },
        ]}
      />,
    )
    await user.click(screen.getByRole('button', { name: 'Open task: Collect the authority' }))
    const panel = container.querySelector('dialog.qw-drawer')!
    expect(panel.textContent).toContain('For Testsmith Household')
    // Not the workflow's own name, which is the thing most easily passed by mistake.
    expect(panel.textContent).not.toContain('For Annual review 2026')
  })

  test('only the right column is still a placeholder; the centre is the task list', () => {
    const { container } = show()
    expect(screen.getByText(/File notes filed under this workflow go here/)).toBeTruthy()
    // The centre's "steps and activity" placeholder is gone: tasks are real.
    expect(screen.queryByText(/Steps and activity/)).toBeNull()
    expect(screen.getByRole('button', { name: /Add task/ })).toBeTruthy()
    // The left column has no placeholder at all any more.
    const left = container.querySelector('.lg\\:col-span-3')!
    expect(left.querySelector('.border-dashed')).toBeNull()
  })

  test('the progress bar sits between the marks and the fields, not at the bottom', () => {
    const { container } = show()
    const marks = container.querySelector('h1')!.nextElementSibling!
    const bar = screen.getByRole('progressbar')
    const fields = container.querySelector('form dl')!
    expect(marks.compareDocumentPosition(bar) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(bar.compareDocumentPosition(fields) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  test('owner on its own row, the two dates side by side beneath, description last', () => {
    const { container } = show()
    const grid = container.querySelector('form dl')!
    const fields = [...grid.children] as HTMLElement[]
    expect(fields.map((f) => f.querySelector('dt')!.textContent)).toEqual([
      'Owner',
      'Date started',
      'Due date',
      'Description',
    ])
    /* Owner and description take the full row; the dates share one.
       `col-span-full`, not `col-span-2`: the shared Field crosses whatever
       grid it lands in, because the task panel's is three across. */
    expect(fields[0].className).toContain('col-span-full')
    expect(fields[1].className).not.toContain('col-span-full')
    expect(fields[2].className).not.toContain('col-span-full')
    expect(fields[3].className).toContain('col-span-full')
    expect(grid.textContent).toContain('Sarah Chen')
    expect(grid.textContent).toContain('6 Jul 2026')
    expect(grid.textContent).toContain('30 Sep 2026')
  })

  test('the owner carries an initials tile, the site’s mark for a person; unassigned carries none', () => {
    const { container, unmount } = show()
    const owner = () => container.querySelector('form dl > div')!
    expect(owner().querySelector('dd span[aria-hidden="true"]')!.textContent).toBe('SC')
    unmount()
    const { container: c2 } = show({ ...card, owner_name: null, owner_staff_id: null })
    expect(c2.querySelector('form dl > div dd span[aria-hidden="true"]')).toBeNull()
  })

  test('the due date is a calendar date and does not slip a day west of Greenwich', () => {
    const original = process.env.TZ
    process.env.TZ = 'America/New_York'
    try {
      show()
      // `new Date('2026-09-30')` is UTC midnight, which renders as the 29th here.
      // Splitting the string is the only way this reads as written.
      expect(screen.getByText('30 Sep 2026')).toBeTruthy()
      expect(screen.queryByText('29 Sep 2026')).toBeNull()
    } finally {
      process.env.TZ = original
    }
  })

  test('the description is the last field and takes the full width', () => {
    const { container } = show()
    const fields = [...container.querySelectorAll('form dl > div')] as HTMLElement[]
    const last = fields.at(-1)!
    expect(last.querySelector('dt')!.textContent).toBe('Description')
    expect(last.className).toContain('col-span-full')
    expect(last.textContent).toContain('Refresh the fact find')
  })

  test('a field with nothing in it reads as an em-dash, not a blank', () => {
    const { container } = show({ ...card, owner_name: null, owner_staff_id: null, due_at: null, description: null })
    const dds = [...container.querySelectorAll('dd')].map((d) => d.textContent)
    // Due date and description are absent and say so with a dash; date started
    // is never absent; the owner has its own word — see the next test.
    expect(dds.filter((t) => t === '—').length).toBe(2)
  })

  test('no owner reads "Unassigned" — the board’s word for it — not a dash', () => {
    const { container } = show({ ...card, owner_name: null, owner_staff_id: null })
    const owner = [...container.querySelectorAll('dt')].find((d) => d.textContent === 'Owner')!
      .nextElementSibling as HTMLElement
    expect(owner.textContent).toBe('Unassigned')
    // Quieter than a real name, as an absent value should be.
    expect(owner.className).toContain('text-neutral-400')
  })

  test('the three cards take the roomy padding, together', () => {
    const { container } = show()
    const cards = [...container.querySelectorAll('section.rounded-lg.border')].filter(
      (el) => el.className.includes('shadow-'),
    )
    expect(cards.length).toBe(3)
    for (const c of cards) expect(c.className).toContain('p-6')
  })

  test('the status pill follows the record — an under-review workflow is not badged as blocked', () => {
    const { container } = show({ ...card, status: 'under_review', priority: 'low' })
    const marks = container.querySelector('h1')!.nextElementSibling as HTMLElement
    expect([...marks.children].map((c) => c.textContent)).toEqual([
      'Annual review',
      'Under review',
      'Low',
    ])
    expect(screen.queryByText('Blocked')).toBeNull()
  })

  test('the progress bar is green, labelled by status, and reports a percentage', () => {
    show({ ...card, status: 'in_progress' })
    const bar = screen.getByRole('progressbar')
    expect(bar.getAttribute('aria-valuenow')).toBe('33')
    expect(bar.getAttribute('aria-valuetext')).toBe('In progress, 33% complete')
    const fill = bar.firstElementChild as HTMLElement
    expect(fill.className).toContain('bg-emerald-600')
    // Thicker than the 6px it started at, so the fill is legible at a glance.
    expect(bar.className).toContain('h-2')
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
      const { unmount } = show({ ...card, status })
      expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe(percent)
      unmount()
    }
  })

  test('cancelled work reports no percentage rather than claiming nothing was done', () => {
    show({ ...card, status: 'cancelled' })
    const bar = screen.getByRole('progressbar')
    expect(bar.getAttribute('aria-valuenow')).toBeNull()
    expect(bar.getAttribute('aria-valuetext')).toBe('Cancelled')
    expect((bar.firstElementChild as HTMLElement).className).not.toContain('emerald')
    expect(bar.previousElementSibling!.lastElementChild!.textContent).toBe('—')
  })

  test('the bar says Complete when the work is finished', () => {
    show({ ...card, status: 'complete' })
    const row = screen.getByRole('progressbar').previousElementSibling!
    expect(row.firstElementChild!.textContent).toBe('Complete')
    expect(row.lastElementChild!.textContent).toBe('100%')
  })

  test('the status pill is a button that opens all six statuses, lanes and not', async () => {
    const user = userEvent.setup()
    show()
    await user.click(screen.getByRole('button', { name: /^Status: Blocked\. Change status of/ }))
    const menu = screen.getByRole('menu', { name: /Status of Annual review 2026/ })
    expect([...menu.querySelectorAll('[role=menuitemradio]')].map((b) => b.textContent)).toEqual([
      'Not started',
      'In progress',
      'Blockednow',
      'Under review',
      'Complete',
      'Cancelled',
    ])
    // The current one is marked, so the reader knows what they are changing from.
    expect(within(menu).getByRole('menuitemradio', { name: /Blocked/ }).getAttribute('aria-checked')).toBe('true')
  })

  test('choosing a status updates the pill, calls the action, and moves the bar with it', async () => {
    const user = userEvent.setup()
    show()
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('33')

    await user.click(screen.getByRole('button', { name: /Change status of/ }))
    await user.click(screen.getByRole('menuitemradio', { name: 'Complete' }))

    expect(actions.setWorkflowStatus).toHaveBeenCalledWith('w1', 'complete')
    // The bar is derived from the status, so it has to move in the same render.
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('100')
    expect(screen.getByRole('button', { name: /^Status: Complete/ })).toBeTruthy()
  })

  test('a refused status change puts the pill and the bar back, with the reason', async () => {
    vi.mocked(actions.setWorkflowStatus).mockResolvedValueOnce({ error: 'Not yours to change' })
    const user = userEvent.setup()
    show()

    await user.click(screen.getByRole('button', { name: /Change status of/ }))
    await user.click(screen.getByRole('menuitemradio', { name: 'Cancelled' }))

    expect((await screen.findByRole('alert')).textContent).toContain('Not yours to change')
    expect(screen.getByRole('button', { name: /^Status: Blocked/ })).toBeTruthy()
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('33')
  })

  test('priority is editable too, and shows the level in words beside the glyph', async () => {
    const user = userEvent.setup()
    show()
    const trigger = screen.getByRole('button', { name: /^Priority: High\. Change priority of/ })
    expect(trigger.textContent).toBe('High')

    await user.click(trigger)
    await user.click(screen.getByRole('menuitemradio', { name: 'Urgent' }))

    expect(actions.setWorkflowPriority).toHaveBeenCalledWith('w1', 'urgent')
    expect(screen.getByRole('button', { name: /^Priority: Urgent/ })).toBeTruthy()
  })

  test('a refused priority change reverts it', async () => {
    vi.mocked(actions.setWorkflowPriority).mockResolvedValueOnce({ error: 'Refused' })
    const user = userEvent.setup()
    show()
    await user.click(screen.getByRole('button', { name: /Change priority of/ }))
    await user.click(screen.getByRole('menuitemradio', { name: 'Low' }))
    expect((await screen.findByRole('alert')).textContent).toContain('Refused')
    expect(screen.getByRole('button', { name: /^Priority: High/ })).toBeTruthy()
  })

  test('the fields sit in a bordered box with a pencil, and a rule divides it from the bar', () => {
    const { container } = show()
    const box = screen.getByRole('button', { name: 'Edit details' }).closest('form')!
    expect(box.className).toContain('border-neutral-200')
    expect(box.className).toContain('rounded-lg')
    // The rule sits between the bar and the box.
    const hr = container.querySelector('hr')!
    const bar = screen.getByRole('progressbar')
    expect(bar.compareDocumentPosition(hr) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(hr.compareDocumentPosition(box) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  /**
   * The load-bearing one, carried over from the member panel: a section being
   * read renders nothing a submit could send, so "reading a record cannot
   * change it" is true of the DOM and not merely of intent.
   */
  test('reading the box renders nothing submittable', () => {
    show()
    const box = screen.getByRole('button', { name: 'Edit details' }).closest('form')!
    expect(box.querySelectorAll('input, select, textarea').length).toBe(0)
  })

  /* Queries here are scoped to the details box. The centre column's Add task
     dialog is closed but — as the member panel taught — a closed <dialog> still
     has its contents in the document, and it too has a "Due date" and a
     "Description". */
  test('the pencil makes owner, due date and description editable — but not the started date', async () => {
    const user = userEvent.setup()
    show()
    const box = screen.getByRole('button', { name: 'Edit details' }).closest('form')! as HTMLElement
    await user.click(within(box).getByRole('button', { name: 'Edit details' }))

    const owner = within(box).getByRole<HTMLSelectElement>('combobox', { name: 'Owner' })
    expect(owner.value).toBe('s1')
    expect([...owner.options].map((o) => o.textContent)).toEqual([
      'Unassigned',
      'Sarah Chen',
      'Clinton Hatcher',
    ])
    expect(within(box).getByLabelText('Due date').getAttribute('type')).toBe('date')
    expect((within(box).getByLabelText('Due date') as HTMLInputElement).value).toBe('2026-09-30')
    expect(within(box).getByLabelText('Description').tagName).toBe('TEXTAREA')

    // Date started is created_at: a record of when the row was made, not a
    // property of the work, so there is no input for it.
    expect(within(box).queryByLabelText('Date started')).toBeNull()
    expect(within(box).getByText('6 Jul 2026')).toBeTruthy()
  })

  test('saving sends the three editable fields and closes the section', async () => {
    const user = userEvent.setup()
    show()
    const box = screen.getByRole('button', { name: 'Edit details' }).closest('form')! as HTMLElement
    await user.click(within(box).getByRole('button', { name: 'Edit details' }))
    await user.clear(within(box).getByLabelText('Description'))
    await user.type(within(box).getByLabelText('Description'), 'Rewritten.')
    await user.selectOptions(within(box).getByRole('combobox', { name: 'Owner' }), 's2')
    await user.click(within(box).getByRole('button', { name: 'Save' }))

    const sent = vi.mocked(actions.saveWorkflowDetails).mock.calls.at(-1)![1]
    expect(sent.get('workflow_id')).toBe('w1')
    expect(sent.get('owner_staff_id')).toBe('s2')
    expect(sent.get('due_at')).toBe('2026-09-30')
    expect(sent.get('description')).toBe('Rewritten.')
    // Back to reading, so the section does not sit open over refreshed values.
    expect(await screen.findByRole('button', { name: 'Edit details' })).toBeTruthy()
  })

  test('a refused save keeps the section open with the reason', async () => {
    vi.mocked(actions.saveWorkflowDetails).mockResolvedValueOnce({ error: 'Not yours to edit' })
    const user = userEvent.setup()
    show()
    await user.click(screen.getByRole('button', { name: 'Edit details' }))
    await user.click(screen.getByRole('button', { name: 'Save' }))

    expect((await screen.findByRole('alert')).textContent).toContain('Not yours to edit')
    expect(screen.getByRole('button', { name: 'Save' })).toBeTruthy()
  })

  test('an owner who has left the directory stays selectable rather than being cleared', async () => {
    const user = userEvent.setup()
    show({ ...card, owner_staff_id: 'gone', owner_name: 'Departed Adviser' })
    await user.click(screen.getByRole('button', { name: 'Edit details' }))
    const owner = screen.getByRole<HTMLSelectElement>('combobox', { name: 'Owner' })
    expect(owner.value).toBe('gone')
    expect([...owner.options].map((o) => o.textContent)).toContain('Departed Adviser')
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
