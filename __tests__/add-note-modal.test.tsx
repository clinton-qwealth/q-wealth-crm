import type { WorkflowOption } from '@/lib/notes'
import { describe, expect, test, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

/**
 * `AddNoteModal`'s workflow select, and the default added on 10 September for
 * the workflow detail page's File Notes tab.
 *
 * **The default is not a convenience.** A note added from that tab and not
 * filed under that workflow would save successfully and then not appear in the
 * list it was added from — which reads as a broken button rather than as a note
 * filed elsewhere.
 */
vi.mock('@/app/(shell)/groups/actions', () => ({
  createFileNote: vi.fn(async () => ({ ok: true as const })),
}))

const { AddNoteModal } = await import('@/components/add-note-modal')

const wf = (o: Partial<WorkflowOption> = {}): WorkflowOption => ({
  id: 'w1',
  name: 'Annual review 2026',
  workflow_type: 'annual_review',
  status: 'in_progress',
  ...o,
})

const open = async (props: Parameters<typeof AddNoteModal>[0]) => {
  const user = userEvent.setup()
  render(<AddNoteModal {...props} />)
  await user.click(screen.getByRole('button', { name: /add file note/i }))
  return screen.getByRole<HTMLSelectElement>('combobox', { name: 'Workflow' })
}
const openWithoutSelect = async (props: Parameters<typeof AddNoteModal>[0]) => {
  const user = userEvent.setup()
  render(<AddNoteModal {...props} />)
  await user.click(screen.getByRole('button', { name: /add file note/i }))
  return screen.queryByRole('combobox', { name: 'Workflow' })
}

describe('the note modal’s workflow select', () => {
  test('defaults to nothing when no default is given', async () => {
    const select = await open({ groupId: 'g1', workflows: [wf()] })
    expect(select.value).toBe('')
    expect([...select.options].map((o) => o.textContent)).toEqual([
      'Not part of a workflow',
      'Annual review 2026',
    ])
  })

  /** The whole reason the prop exists. */
  test('pre-selects the workflow it was given', async () => {
    const select = await open({ groupId: 'g1', workflows: [wf()], defaultWorkflowId: 'w1' })
    expect(select.value).toBe('w1')
  })

  /**
   * A finished workflow cannot take a new note — filing one under a completed
   * review would quietly reopen closed work — so it is filtered out of the
   * options. With nothing left to offer **the select is not rendered at all**,
   * which is how the workflow page came to withhold its Add file note button
   * on finished work: refusing the workflow here would otherwise file the note
   * under nothing and it would never appear in the list it was added from.
   */
  test('a completed workflow leaves no select to render at all', async () => {
    expect(
      await openWithoutSelect({
        groupId: 'g1',
        workflows: [wf({ status: 'complete' })],
        defaultWorkflowId: 'w1',
      }),
    ).toBeNull()
  })

  test('a cancelled workflow is treated the same way', async () => {
    expect(
      await openWithoutSelect({
        groupId: 'g1',
        workflows: [wf({ status: 'cancelled' })],
        defaultWorkflowId: 'w1',
      }),
    ).toBeNull()
  })

  /** With another workflow still open, the finished one is simply not listed. */
  test('a finished workflow is dropped from a list that still has an open one', async () => {
    const select = await open({
      groupId: 'g1',
      workflows: [wf({ status: 'complete' }), wf({ id: 'w2', name: 'Onboarding' })],
      defaultWorkflowId: 'w1',
    })
    expect([...select.options].map((o) => o.value)).toEqual(['', 'w2'])
    // The default named the finished one, so nothing is pre-selected.
    expect(select.value).toBe('')
  })

  /** A default naming a workflow that is not in the list cannot take effect. */
  test('a default that is not among the options falls back to no workflow', async () => {
    const select = await open({
      groupId: 'g1',
      workflows: [wf()],
      defaultWorkflowId: 'some-other-workflow',
    })
    expect(select.value).toBe('')
  })

  test('the opt-out is always offered, so a note need not join the workflow', async () => {
    const select = await open({ groupId: 'g1', workflows: [wf()], defaultWorkflowId: 'w1' })
    expect([...select.options].map((o) => o.value)).toContain('')
  })
})
