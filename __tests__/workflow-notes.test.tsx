import type { NoteHeader } from '@/lib/notes'
import { describe, expect, test } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { WorkflowNotes } from '@/components/workflow-notes'

/**
 * The File Notes tab in the workflow detail page's right column.
 *
 * The ROW is the group page's `NoteRecord`, imported rather than rebuilt, so
 * the disclosure's own behaviour is covered by `file-notes.test.tsx`. What is
 * tested here is what this screen does differently: no workflow control on the
 * row, and an empty state that says how a note gets filed.
 */
const note = (o: Partial<NoteHeader> = {}): NoteHeader => ({
  note_id: 'n1',
  note_type: 'meeting_summary',
  title: 'Annual review meeting',
  occurred_at: '2026-07-06T02:00:00Z',
  author_name: 'Sarah Chen',
  source: 'manual',
  workflow_id: 'w1',
  workflow_name: 'Annual review 2026',
  workflow_status: 'in_progress',
  body_excerpt: 'Discussed the superannuation rollover and the insurance review',
  body_is_truncated: true,
  ...o,
})

describe('the workflow’s file notes tab', () => {
  test('a note reads as the same record the group page shows', async () => {
    render(<WorkflowNotes notes={[note()]} />)
    const row = screen.getByRole('listitem')

    // Kind as a pill with its glyph, the date opposite, then title and author.
    const pill = Array.from(row.querySelectorAll('span')).find((el) =>
      el.className.includes('rounded-full'),
    )!
    expect(pill.textContent).toContain('Meeting summary')
    expect(pill.querySelector('svg')).toBeTruthy()
    expect(row.textContent).toContain('Jul 2026')
    expect(row.textContent).toContain('Annual review meeting')
    expect(row.textContent).toContain('Sarah Chen')
  })

  test('the note opens onto its first words, closed by default', async () => {
    const user = userEvent.setup()
    render(<WorkflowNotes notes={[note()]} />)
    const row = screen.getByRole('listitem')

    expect(row.textContent).not.toContain('Discussed the superannuation rollover')
    await user.click(within(row).getByRole('button', { expanded: false }))
    expect(row.textContent).toContain('Discussed the superannuation rollover')
  })

  /**
   * **No workflow control here.** On the group's page that pill is the fact
   * that tells one note from another; on a workflow's own page every note is
   * filed under this workflow, so it would read the same on every row — the
   * one-value pill the task list removed on 9 September.
   */
  test('no row offers a workflow pill or an Add to workflow button', () => {
    render(<WorkflowNotes notes={[note(), note({ note_id: 'n2', workflow_id: null, workflow_name: null })]} />)
    expect(screen.queryByRole('button', { name: /add to workflow/i })).toBeNull()
    expect(screen.queryByText('Annual review 2026')).toBeNull()
  })

  test('the notes are one list, and the count says how many', () => {
    render(<WorkflowNotes notes={[note(), note({ note_id: 'n2' })]} />)
    expect(screen.getAllByRole('listitem')).toHaveLength(2)
    expect(screen.getAllByRole('list')).toHaveLength(1)
    expect(screen.getByText('2 notes')).toBeTruthy()
  })

  test('one note is counted in the singular', () => {
    render(<WorkflowNotes notes={[note()]} />)
    expect(screen.getByText('1 note')).toBeTruthy()
  })

  /**
   * There is no way to write a note from this screen, so the empty state has
   * to say where one comes from. Without that sentence an adviser cannot tell
   * whether the feature is missing or the notes are.
   */
  test('an empty tab says HOW a note gets filed under a workflow', () => {
    render(<WorkflowNotes notes={[]} />)
    expect(screen.queryByRole('list')).toBeNull()
    expect(screen.getByText(/No file notes filed here yet/)).toBeTruthy()
    expect(document.body.textContent).toMatch(/group’s own file notes list/)
    expect(document.body.textContent).toMatch(/Add to workflow/)
  })
})
