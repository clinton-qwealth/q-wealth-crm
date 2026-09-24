import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, test, vi } from 'vitest'

/**
 * The template editor's reorder controls.
 *
 * What a plausible implementation of this gets wrong, and what each test below
 * therefore exists to catch:
 *
 * - **Focus is lost after a move.** The DOM reorders under the focused node, so
 *   without putting focus back on the button that moved, a second press does
 *   nothing and a task cannot be moved more than one place by keyboard. This is
 *   the difference between the control being usable and being a demo.
 * - **An illegal move is simply disabled**, with no reason given, so an author
 *   sees a dead button and cannot tell whether it is broken or forbidden.
 * - **The move is allowed and the dependency is dropped** to make it fit, which
 *   is data loss discovered at deploy time.
 */
const reorderCalls: { templateId: string; order: string[] }[] = []
const addRoleCalls: { templateId: string; workflowRoleId: string }[] = []

vi.mock('@/app/(shell)/admin/actions', () => ({
  reorderTemplateTasks: vi.fn(async (templateId: string, order: string[]) => {
    reorderCalls.push({ templateId, order })
    return { ok: true as const }
  }),
  addTemplateRole: vi.fn(async (templateId: string, workflowRoleId: string) => {
    addRoleCalls.push({ templateId, workflowRoleId })
    return { ok: true as const }
  }),
  removeTemplateRole: vi.fn(async () => ({ ok: true as const })),
  removeTemplateTask: vi.fn(async () => ({ ok: true as const })),
  addTemplateTask: vi.fn(async () => ({ ok: true as const })),
  saveTemplateTask: vi.fn(async () => ({ ok: true as const })),
  saveWorkflowTemplate: vi.fn(async () => ({ ok: true as const })),
  setWorkflowTemplateStatus: vi.fn(async () => ({ ok: true as const })),
}))

const { TemplateEditor } = await import('@/components/template-editor')
const { default: React } = await import('react')
type TemplateDetail = import('@/lib/templates').TemplateDetail
type WorkflowRole = import('@/lib/templates').WorkflowRole

const task = (id: string, ordinal: number, subject: string, depends_on: string[] = []) => ({
  id,
  ordinal,
  subject,
  description: null,
  priority: 'medium',
  /* `r1` is the template's own role row — the id the task column holds. `w1` is
     the FIRM role behind it, which is what the "who does it" pickers are keyed
     by. They are different ids on purpose. */
  role_id: 'r1',
  workflow_role_id: 'w1',
  role_name: 'Adviser',
  due_offset_days: 0,
  depends_on,
})

/** A → B → C, and D which waits for nothing and can go anywhere. */
const TEMPLATE: TemplateDetail = {
  id: 'tpl1',
  name: 'New client onboarding',
  description: null,
  status: 'draft',
  workflow_type: null,
  task_count: 4,
  role_count: 1,
  deployment_count: 0,
  published_at: null,
  roles: [{ id: 'r1', workflow_role_id: 'w1', name: 'Adviser', task_count: 4 }],
  tasks: [
    task('a', 0, 'Book the meeting'),
    task('b', 1, 'Collect the authority', ['a']),
    task('c', 2, 'Issue the advice', ['b']),
    task('d', 3, 'Send the welcome pack'),
  ],
}

/** The firm's list, which is a DIFFERENT list from `template.roles`: it holds
 *  a role nothing on this template uses, so the pickers' options can be told
 *  apart from the template's own. */
const FIRM_ROLES: WorkflowRole[] = [
  { id: 'w1', name: 'Adviser', status: 'active', template_count: 1 },
  { id: 'w2', name: 'Paraplanner', status: 'active', template_count: 0 },
  { id: 'w3', name: 'Registry', status: 'archived', template_count: 0 },
]

const show = (template: TemplateDetail = TEMPLATE, firmRoles: WorkflowRole[] = FIRM_ROLES) =>
  render(<TemplateEditor template={template} firmRoles={firmRoles} />)

beforeEach(() => {
  reorderCalls.length = 0
  addRoleCalls.length = 0
})

describe('reordering a template’s tasks', () => {
  test('the list is numbered, so a prerequisite can be named by position', () => {
    show()
    const rows = [...document.querySelectorAll('[data-slot="template-tasks"] > li')]
    expect(rows.map((r) => r.textContent?.slice(0, 2))).toEqual(['01', '02', '03', '04'])
  })

  test('moving a free task up sends the whole list in its new order', async () => {
    show()
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Move “Send the welcome pack” up' }))
    })
    expect(reorderCalls).toEqual([{ templateId: 'tpl1', order: ['a', 'b', 'd', 'c'] }])
  })

  /**
   * Three presses to move a task three places is only possible if focus stays
   * with it. It does, because the rows are keyed by task id and React MOVES the
   * existing node rather than rebuilding it.
   *
   * So this does not test an effect — an explicit focus-restore was written
   * first and turned out to change nothing. It tests the property the keying
   * gives us. Mutation: key the rows by index → React updates the nodes in
   * place, focus stays on a button that now belongs to a different task, and
   * this fails.
   */
  test('focus stays with the moved task, so it can be moved again', async () => {
    show()
    const button = screen.getByRole('button', { name: 'Move “Send the welcome pack” up' })
    await act(async () => {
      button.focus()
      fireEvent.click(button)
    })
    expect(document.activeElement).toBe(
      screen.getByRole('button', { name: 'Move “Send the welcome pack” up' }),
    )
  })

  test('the move is announced, because a button that does something silently is not usable', async () => {
    show()
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Move “Send the welcome pack” up' }))
    })
    const live = document.querySelector('[aria-live="polite"]')!
    expect(live.textContent).toContain('Send the welcome pack')
    expect(live.textContent).toContain('position 3 of 4')
  })
})

describe('a move that would break a dependency', () => {
  /**
   * Disabled AND explained. Mutation: leave the accessible name as "Move X up"
   * → the author meets a dead control with no way to learn why.
   */
  test('is refused, and the button says which task is in the way', () => {
    show()
    const up = screen.getByRole('button', {
      name: 'Cannot move “Collect the authority” above “Book the meeting”, which it waits for',
    })
    expect(up.hasAttribute('disabled')).toBe(true)
  })

  test('is refused downwards too, naming the task that waits for it', () => {
    show()
    const down = screen.getByRole('button', {
      name: 'Cannot move “Collect the authority” below “Issue the advice”, which waits for it',
    })
    expect(down.hasAttribute('disabled')).toBe(true)
  })

  test('nothing is sent when the move is impossible', async () => {
    show()
    await act(async () => {
      fireEvent.click(
        screen.getByRole('button', {
          name: 'Cannot move “Collect the authority” above “Book the meeting”, which it waits for',
        }),
      )
    })
    expect(reorderCalls).toEqual([])
  })
})

describe('what a row tells you before you touch it', () => {
  test('a task that starts immediately says so, rather than showing nothing', () => {
    show()
    const first = document.querySelectorAll('[data-slot="template-tasks"] > li')[0]
    expect(first.textContent).toContain('Starts immediately')
  })

  test('a task names what it waits for by position', () => {
    show()
    const second = document.querySelectorAll('[data-slot="template-tasks"] > li')[1]
    expect(second.textContent).toContain('Waits for 01')
  })

  /** The fact you need before moving or deleting a task, and one a
   *  forward-only view cannot show. */
  test('a task says how many are waiting for it', () => {
    show()
    const first = document.querySelectorAll('[data-slot="template-tasks"] > li')[0]
    expect(first.textContent).toContain('1 waiting')
  })

  /**
   * The offset means days from the plan's start for a task that waits for
   * nothing, and days from its prerequisite for every other — and there is no
   * way to tell which from the number alone. Mutation: one fixed phrase → the
   * author cannot recover the zero point they chose.
   */
  test('the offset says which zero point it counts from', () => {
    const rows = document.createElement('div')
    void rows
    show({
      ...TEMPLATE,
      tasks: [task('a', 0, 'Book the meeting'), { ...task('b', 1, 'Collect', ['a']), due_offset_days: 3 }],
    })
    const list = document.querySelectorAll('[data-slot="template-tasks"] > li')
    expect(list[0].textContent).toContain('Due the day the plan starts')
    expect(list[1].textContent).toContain('Due 3 days after the one before it')
  })
})

describe('publishing', () => {
  test('a template with an unused role cannot be published, and the button says how many to fix', () => {
    show({
      ...TEMPLATE,
      roles: [
        { id: 'r1', workflow_role_id: 'w1', name: 'Adviser', task_count: 4 },
        { id: 'r2', workflow_role_id: 'w2', name: 'Paraplanner', task_count: 0 },
      ],
    })
    const publish = screen.getByRole('button', { name: /Publish/ })
    expect(publish.hasAttribute('disabled')).toBe(true)
    expect(publish.textContent).toContain('1 to fix first')
  })

  test('a complete draft can be published', () => {
    show()
    const publish = screen.getByRole('button', { name: 'Publish' })
    expect(publish.hasAttribute('disabled')).toBe(false)
  })

  /** Editing a published template is allowed and reaches future deployments
   *  only — the decision taken on 23 Sep, stated where a reader will meet it. */
  test('a published template says that editing it will not disturb running workflows', () => {
    show({ ...TEMPLATE, status: 'published', deployment_count: 4 })
    expect(screen.getByText(/Editing it changes future deployments only/)).toBeTruthy()
  })
})

/**
 * Roles came off the template and onto the firm on 24 September.
 *
 * Before that, writing a template meant typing a role name into it, so every
 * template invented its own and the firm ended up with several spellings of
 * "Adviser". A task now names one of `workflow_roles`, and
 * `ensure_workflow_template_role` attaches whichever is picked — which is why
 * the pickers offer the WHOLE firm list rather than the subset this template
 * has already used.
 *
 * What a plausible implementation gets wrong, and what each test catches:
 *
 * - **The picker is still fed `template.roles`.** It renders, it looks right,
 *   and the author simply cannot give a task to anyone the template has not
 *   used before — the exact problem the change was made to remove.
 * - **The field is still called `role_id`.** The server action reads
 *   `workflow_role_id`, gets nothing, and every save fails with "Say who does
 *   this task" while a role is plainly selected.
 * - **Archived roles are offered.** `ensure_workflow_template_role` refuses
 *   them, so the author picks a name and is refused by the database.
 * - **Archived roles are filtered out of a task that already has one.** The
 *   select falls back to its first option, and saving anything else on the
 *   task silently reassigns it.
 */
describe('who does a task', () => {
  const openAddTask = async () => {
    show()
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Add task' }))
    })
    /* `dialog[open]`, not `getByRole('dialog')`: the drawer is a second
       <dialog> in this tree and jsdom shows both to the role query. */
    const dialog = document.querySelector('dialog[open]') as HTMLDialogElement
    return within(dialog).getByLabelText(/Who does it/i) as HTMLSelectElement
  }

  test('offers every role the firm has, not only the ones this template uses', async () => {
    const select = await openAddTask()
    /* Paraplanner is on the FIRM's list and on no task here, so a picker fed
       `template.roles` would not show it. Mutation, and it was run: change
       `<RoleOptions firmRoles={firmRoles} />` back to `template.roles.map(...)`
       — this fails on Paraplanner. */
    expect([...select.options].map((o) => o.textContent)).toContain('Paraplanner')
  })

  test('does not offer an archived role for a new task', async () => {
    const select = await openAddTask()
    /* By VALUE, not by label. An archived role renders as "Registry
       (archived)", so `not.toContain('Registry')` on the labels passed whether
       or not the option was there — it was written that way first and the
       mutation below sailed through it. */
    expect([...select.options].map((o) => o.value)).not.toContain('w3')
  })

  test('sends the FIRM role id, under the name the server action reads', async () => {
    const select = await openAddTask()
    /* Both halves matter. The name is what `addTemplateTask` reads out of the
       FormData; the value is the firm role, not the template's own join row —
       `w2`, never `r2`. */
    expect(select.name).toBe('workflow_role_id')
    expect([...select.options].map((o) => o.value)).toContain('w2')
    expect([...select.options].map((o) => o.value)).not.toContain('r1')
  })

  test('a task keeps a role that has since been archived', async () => {
    show({
      ...TEMPLATE,
      roles: [{ id: 'r1', workflow_role_id: 'w3', name: 'Registry', task_count: 4 }],
      tasks: [{ ...task('a', 0, 'Book the meeting'), workflow_role_id: 'w3' }],
    })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Open Book the meeting' }))
    })
    /* The panel's fields are a FieldBox, so the select does not exist until the
       details are put into edit. Without this step the only "Who does it" in
       the document is the Add-task dialog's, which is empty and would have made
       the assertion below fail for the wrong reason. */
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Edit details' }))
    })
    const drawer = document.querySelector('[data-slot="drawer"], dialog[open]') as HTMLElement
    const select = within(drawer).getByLabelText(/Who does it/i) as HTMLSelectElement
    /* `w3` is archived firm-wide. It is offered HERE, marked, because this
       task already has it — otherwise the select would sit on Adviser and the
       next save would reassign the task without anyone asking for it. */
    expect(select.value).toBe('w3')
    expect([...select.options].map((o) => o.textContent)).toContain('Registry (archived)')
  })
})

describe('the roles a template uses', () => {
  test('is a picklist of the firm’s roles, not a box to type a name into', async () => {
    show()
    const add = screen.getByLabelText('Add a role') as HTMLSelectElement
    expect(add.tagName).toBe('SELECT')
    /* Only what is NOT already on the template, and only what the firm still
       offers: Adviser is used here, Registry is archived. */
    expect([...add.options].map((o) => o.value).filter(Boolean)).toEqual(['w2'])
  })

  test('adds by id, so two templates naming the same role mean the same role', async () => {
    show()
    await act(async () => {
      fireEvent.change(screen.getByLabelText('Add a role'), { target: { value: 'w2' } })
    })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Add' }))
    })
    expect(addRoleCalls).toEqual([{ templateId: 'tpl1', workflowRoleId: 'w2' }])
  })

  test('says so plainly when the firm has no roles left to add', () => {
    show(TEMPLATE, [{ id: 'w1', name: 'Adviser', status: 'active', template_count: 1 }])
    expect(screen.getByText('Every role the firm has is already on this plan.')).toBeTruthy()
  })
})
