import { act, fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, test, vi } from 'vitest'

/**
 * Deploying a template, and completing a task out of order.
 *
 * The two things a plausible implementation gets wrong here:
 *
 * - **The preview prints a full waterfall of dates.** It is what the code wants
 *   to do, and it contradicts the rule the database applies — a task waiting on
 *   another has NO due date until that other is done. The deployer would then
 *   open the workflow, find a column of blanks, and report it as a bug.
 * - **Ticking a blocked task writes straight through.** Every other change on
 *   that list is optimistic and silent because every other change is
 *   reversible; this one leaves a permanent record and must be agreed to.
 */
const completedEarly: { taskId: string; reason: string }[] = []

vi.mock('@/app/(shell)/groups/actions', () => ({
  deployWorkflowTemplate: vi.fn(async () => ({ ok: true as const })),
  completeWorkflowTaskEarly: vi.fn(async (taskId: string, _w: string, reason: string) => {
    completedEarly.push({ taskId, reason })
    return { ok: true as const }
  }),
  setWorkflowTaskStatus: vi.fn(async () => ({ ok: true as const })),
  setWorkflowTaskPriority: vi.fn(async () => ({ ok: true as const })),
  createWorkflowTask: vi.fn(async () => ({ ok: true as const })),
  saveWorkflowTaskDetails: vi.fn(async () => ({ ok: true as const })),
  postWorkflowActivity: vi.fn(async () => ({ ok: true as const })),
  recordTaskEmail: vi.fn(async () => ({ ok: true as const })),
}))

const { DeployTemplateDialog, DeployPreview } = await import('@/components/deploy-template-dialog')
const { WorkflowTasks } = await import('@/components/workflow-tasks')
const { previewSchedule } = await import('@/lib/templates')
const { default: React } = await import('react')
type WorkflowTask = import('@/lib/workflow-board').WorkflowTask
type DeployableTemplate = import('@/lib/templates').DeployableTemplate

const TEMPLATE: DeployableTemplate = {
  id: 'tpl1',
  name: 'New client onboarding',
  description: null,
  workflow_type: null,
  roles: [
    { id: 'r1', name: 'Adviser' },
    { id: 'r2', name: 'Paraplanner' },
  ],
  tasks: [
    { id: 'a', subject: 'Book the meeting', role_id: 'r1', due_offset_days: 1, depends_on: [] },
    { id: 'b', subject: 'Collect the authority', role_id: 'r2', due_offset_days: 3, depends_on: ['a'] },
  ],
}

const STAFF = [
  { id: 's1', name: 'Chen, Sarah' },
  { id: 's2', name: 'Nguyen, An' },
]

beforeEach(() => {
  completedEarly.length = 0
})

describe('the deploy dialog', () => {
  const open = async () => {
    render(<DeployTemplateDialog templates={[TEMPLATE]} workflowId="w1" staff={STAFF} />)
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Use a template/ }))
    })
  }

  test('asks for a person for every role, with nobody chosen by default', async () => {
    await open()
    const selects = [...document.querySelectorAll('[data-slot="deploy-roles"] select')]
    expect(selects).toHaveLength(2)
    /* No prefill. Dropping the workflow's owner into every role is the obvious
       convenience and it lands every task on one person. */
    expect(selects.every((s) => (s as HTMLSelectElement).value === '')).toBe(true)
  })

  test('deploy is refused until every role has somebody, and says how many are missing', async () => {
    await open()
    expect(screen.getByRole('button', { name: /Add 2 tasks/ }).hasAttribute('disabled')).toBe(true)
    expect(screen.getByText('2 roles need somebody')).toBeTruthy()
  })

  test('deploy opens once every role is filled', async () => {
    await open()
    const selects = [...document.querySelectorAll('[data-slot="deploy-roles"] select')] as HTMLSelectElement[]
    await act(async () => {
      fireEvent.change(selects[0], { target: { value: 's1' } })
      fireEvent.change(selects[1], { target: { value: 's2' } })
    })
    expect(screen.getByRole('button', { name: /Add 2 tasks/ }).hasAttribute('disabled')).toBe(false)
  })
})

describe('the preview', () => {
  /**
   * THE BLANKS ARE THE POINT. Mutation: compute a cumulative waterfall from the
   * start date — which is what this looks like it should do — and the second
   * row gains a confident date the database will never write.
   */
  test('only a task that waits for nothing shows a date; the rest name what they wait for', () => {
    render(<DeployPreview rows={previewSchedule(TEMPLATE, '2026-10-01')} />)
    const rows = [...document.querySelectorAll('[data-slot="deploy-preview"] li')]
    expect(rows[0].textContent).toContain('due')
    expect(rows[1].textContent).not.toContain('due')
    expect(rows[1].textContent).toContain('after “Book the meeting”')
  })

  test('each row names the person who will own it', () => {
    render(<DeployPreview rows={previewSchedule(TEMPLATE, '2026-10-01')} />)
    const rows = [...document.querySelectorAll('[data-slot="deploy-preview"] li')]
    expect(rows[0].textContent).toContain('Adviser')
    expect(rows[1].textContent).toContain('Paraplanner')
  })
})

/* -------------------------------------------------------------------------- */

const task = (o: Partial<WorkflowTask>): WorkflowTask => ({
  id: 't1',
  workflow_id: 'w1',
  task_type: 'checkbox',
  subject: 'Issue the advice',
  description: null,
  comment: null,
  due_at: null,
  status: 'open',
  priority: 'medium',
  assigned_to_staff_id: null,
  assigned_to_name: null,
  completed_at: null,
  created_at: '2026-09-23T00:00:00Z',
  updated_at: '2026-09-23T00:00:00Z',
  template_task_id: null,
  plan_position: null,
  due_offset_days: null,
  depends_on: [],
  blocked_by: [],
  is_blocked: false,
  completed_while_blocked: false,
  ...o,
})

const showTasks = (tasks: WorkflowTask[]) =>
  render(
    <WorkflowTasks
      workflowId="w1"
      workflowName="Onboarding"
      groupName="Millar Household"
      templates={[]}
      tasks={tasks}
      posts={[]}
      actions={[]}
      recipient={null}
      staff={STAFF}
      viewer={{ id: 's1', name: 'Sarah Chen', email: 's@x.com', canRemoveAnyImage: false }}
    />,
  )

describe('a blocked task', () => {
  const blocked = task({
    is_blocked: true,
    blocked_by: ['Collect the authority'],
    due_offset_days: 3,
    plan_position: 2,
  })

  test('names what it is waiting for, rather than just saying blocked', () => {
    showTasks([blocked])
    expect(screen.getByText('Waiting on “Collect the authority”')).toBeTruthy()
  })

  /**
   * Half a deployed plan has no due date at any moment — that is the rule, not
   * missing data — so a blank right edge on half the rows reads as broken.
   */
  test('says when it will be due instead of leaving the due slot empty', () => {
    showTasks([blocked])
    expect(screen.getByText('Due 3d after it starts')).toBeTruthy()
  })

  /** The decision was that it CAN be completed. A disabled checkbox would
   *  contradict it outright. */
  test('can still be ticked', () => {
    showTasks([blocked])
    const box = screen.getByRole('checkbox', { name: /Issue the advice/ }) as HTMLInputElement
    expect(box.disabled).toBe(false)
  })

  test('ticking it asks first, naming what is still open', async () => {
    showTasks([blocked])
    await act(async () => {
      fireEvent.click(screen.getByRole('checkbox', { name: /Issue the advice/ }))
    })
    expect(screen.getByText('Complete this out of order?')).toBeTruthy()
    /* Scoped to the dialog: the blocker's name is also on the row behind it,
       which is correct and would make an unscoped query ambiguous. */
    const dialog = document.querySelector('[data-slot="complete-early"]')!
    expect(dialog.textContent).toContain('Collect the authority')
    /* Nothing written yet — the confirm is the point. */
    expect(completedEarly).toEqual([])
  })

  test('confirming completes it and carries the reason', async () => {
    showTasks([blocked])
    await act(async () => {
      fireEvent.click(screen.getByRole('checkbox', { name: /Issue the advice/ }))
    })
    await act(async () => {
      fireEvent.change(screen.getByRole('textbox', { name: /Why, for the record/ }), {
        target: { value: 'Client signed in the meeting.' },
      })
    })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Complete anyway' }))
    })
    expect(completedEarly).toEqual([{ taskId: 't1', reason: 'Client signed in the meeting.' }])
  })

  test('an unblocked task is ticked straight through, with no confirm', async () => {
    showTasks([task({ is_blocked: false })])
    await act(async () => {
      fireEvent.click(screen.getByRole('checkbox', { name: /Issue the advice/ }))
    })
    expect(screen.queryByText('Complete this out of order?')).toBeNull()
  })

  /** Permanent, and one rule: the mark does not go quiet once the prerequisite
   *  catches up, which would be two rules for one thing. */
  test('a task completed early is marked so afterwards', () => {
    showTasks([task({ status: 'done', completed_while_blocked: true, is_blocked: false })])
    expect(screen.getByText('Completed early')).toBeTruthy()
  })
})
