import type { NoteHeader, WorkflowOption } from '@/lib/notes'
import { describe, expect, test, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

/**
 * The server actions import next/headers, which cannot run outside a request.
 * Mocked so the component's own behaviour can be tested — the actions
 * themselves are exercised against the real database, not here.
 */
vi.mock('@/app/(shell)/groups/actions', () => ({
  createFileNote: vi.fn(),
  startWorkflow: vi.fn(),
  attachNoteToWorkflow: vi.fn(async () => ({ ok: true as const })),
  fileNoteUnderNewWorkflow: vi.fn(async () => ({ ok: true as const })),
}))

const actions = await import('@/app/(shell)/groups/actions')
const { FileNotes, formatNoteDate } = await import('@/components/file-notes')
const { default: React } = await import('react')

const workflows: WorkflowOption[] = [
  { id: 'w1', name: 'Annual review 2026', workflow_type: 'annual_review', status: 'in_progress' },
  { id: 'w2', name: 'Onboarding 2024', workflow_type: 'onboarding', status: 'complete' },
]

/* Typed, so the fixture has to keep up with NoteHeader rather than drifting
   into a shape the view no longer produces. */
const filed: NoteHeader = {
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
}

const unfiled: NoteHeader = {
  note_id: 'n2',
  note_type: 'phone_call',
  title: 'Called about rollover',
  occurred_at: '2026-08-31T04:30:00Z',
  author_name: 'Clinton Hatcher',
  source: 'manual',
  workflow_id: null,
  workflow_name: null,
  workflow_status: null,
  /* Short enough to be the whole body, so this fixture is the not-truncated
     case and `filed` is the truncated one. */
  body_excerpt: 'Client rang about the paperwork.',
  body_is_truncated: false,
}

function show(notes: NoteHeader[]) {
  return render(
    <FileNotes groupId="g1" notes={notes} workflows={workflows} />,
  )
}

/** The visible list, excluding anything sitting inside a closed <dialog>. */
function rows() {
  return screen
    .getAllByRole('listitem')
    .filter((el) => !el.closest('dialog'))
}

describe('file notes list', () => {
  test('a note shows its title, date and who added it', () => {
    show([filed])
    const row = rows()[0]
    expect(within(row).getByText('Annual review meeting')).toBeTruthy()
    expect(row.textContent).toContain('Sarah Chen')
    expect(row.textContent).toContain('Jul 2026')
  })

  test('a note in a workflow shows it as a pill, not as an add button', () => {
    show([filed])
    const row = rows()[0]
    expect(within(row).getByText('Annual review 2026')).toBeTruthy()
    expect(within(row).queryByText(/add to workflow/i)).toBeNull()
  })

  test('a note with no workflow offers the add button instead of a pill', () => {
    show([unfiled])
    const row = rows()[0]
    expect(within(row).getByRole('button', { name: /add to workflow/i })).toBeTruthy()
    // and none of the workflow names leak into the row
    expect(row.textContent).not.toContain('Annual review 2026')
  })

  /**
   * The record's summary is three facts: what kind of note it is, what it is
   * called, and who wrote it — with the moment opposite the kind. The same
   * shape as a task's History entry, on purpose.
   */
  test('the summary is a kind pill with a glyph, the date opposite, then title and byline', () => {
    show([filed])
    const gate = within(rows()[0]).getByRole('button', { expanded: false })

    const pill = Array.from(gate.querySelectorAll('span')).find((el) =>
      el.className.includes('rounded-full'),
    )!
    expect(pill.textContent).toContain('Meeting summary')
    expect(pill.querySelector('svg')).toBeTruthy()

    // Kind and moment share a row, pushed to opposite ends.
    const row = pill.parentElement!
    expect(row.className).toContain('justify-between')
    expect(row.textContent).toContain('Jul 2026')

    // Title and byline are below that row, not in it.
    expect(row.textContent).not.toContain('Annual review meeting')
    expect(gate.textContent).toContain('Annual review meeting')
    expect(gate.textContent).toContain('Sarah Chen')
  })

  /**
   * The gate. A file note's body is a paragraph or several, so an entry left
   * open means one note fills the column and the list stops being a list.
   */
  test('a note opens CLOSED, and its words are not on screen until it is opened', async () => {
    const user = userEvent.setup()
    show([filed])
    const row = rows()[0]

    expect(row.textContent).not.toContain('Discussed the superannuation rollover')
    await user.click(within(row).getByRole('button', { expanded: false }))
    expect(row.textContent).toContain('Discussed the superannuation rollover')

    // And it closes again.
    await user.click(within(row).getByRole('button', { expanded: true }))
    expect(row.textContent).not.toContain('Discussed the superannuation rollover')
  })

  /**
   * Read more is offered only where there IS more, and it says plainly that
   * reading a note in full is not built. A live-looking control that did
   * nothing would be worse than one that admits what it is.
   */
  test('a truncated note offers Read more, disabled and named as unbuilt', async () => {
    const user = userEvent.setup()
    show([filed])
    const row = rows()[0]
    await user.click(within(row).getByRole('button', { expanded: false }))

    const more = within(row).getByRole('button', { name: /read more/i })
    expect((more as HTMLButtonElement).disabled).toBe(true)
    expect(more.textContent).toMatch(/not built yet/i)
    expect(more.className).toContain('border-dashed')
  })

  test('a note that fits offers no Read more at all', async () => {
    const user = userEvent.setup()
    show([unfiled])
    const row = rows()[0]
    await user.click(within(row).getByRole('button', { expanded: false }))

    expect(row.textContent).toContain('Client rang about the paperwork.')
    expect(within(row).queryByRole('button', { name: /read more/i })).toBeNull()
    // No trailing ellipsis either: nothing was cut.
    expect(row.textContent).not.toContain('…')
  })

  test('a note with no written body says so rather than opening onto nothing', async () => {
    const user = userEvent.setup()
    show([{ ...unfiled, body_excerpt: '', body_is_truncated: false }])
    const row = rows()[0]
    await user.click(within(row).getByRole('button', { expanded: false }))
    expect(row.textContent).toContain('no written body')
  })

  /**
   * The workflow control is the row's one ACTION, so it stays out of the gate.
   * An action behind a disclosure is an action nobody finds — and a button
   * inside the gate's button would not be valid HTML either.
   */
  test('the workflow control is visible while the note is closed, outside the gate', () => {
    show([unfiled])
    const row = rows()[0]
    const gate = within(row).getByRole('button', { expanded: false })
    const add = within(row).getByRole('button', { name: /add to workflow/i })

    expect(gate.contains(add)).toBe(false)
    expect(row.contains(add)).toBe(true)
  })

  test('a filed note shows its workflow without being opened', () => {
    show([filed])
    const row = rows()[0]
    expect(within(row).getByRole('button', { expanded: false })).toBeTruthy()
    expect(within(row).getByText('Annual review 2026')).toBeTruthy()
  })

  test('an untitled note falls back to its kind rather than rendering nameless', () => {
    show([{ ...unfiled, title: null }])
    expect(rows()[0].textContent).toContain('Phone call')
  })

  test('a note from an integration says so rather than naming nobody', () => {
    show([{ ...unfiled, author_name: null, source: 'integration' }])
    expect(rows()[0].textContent).toContain('Added by an integration')
  })

  /**
   * The load-bearing one. group_notes_summary carries no body by design, and
   * this asserts the component never gained a way to show one — if a body field
   * is ever added to the view and rendered here, the content of a client
   * meeting starts arriving in the markup of a list that only shows dates.
   */
  test('no note content reaches the page, only headers', () => {
    const withBody = { ...filed, body: 'Client disclosed a health condition.' } as NoteHeader
    const { container } = show([withBody])
    expect(container.textContent).not.toContain('health condition')
  })

  test('the add-file-note action sits at the top of a populated list', () => {
    show([filed])
    const list = screen.getByRole('listitem').closest('ul')!
    const add = screen.getAllByRole('button', { name: /add file note/i })[0]
    // The toolbar action precedes the records in the DOM, so it stays put as
    // the list grows rather than sliding below the fold.
    expect(add.compareDocumentPosition(list) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  test('an empty group gets the empty state, not a bare heading', () => {
    show([])
    expect(screen.getByText(/no file notes yet/i)).toBeTruthy()
  })
})

describe('filing a note under a workflow', () => {
  test('the picker attaches the chosen workflow to the clicked note', async () => {
    const user = userEvent.setup()
    show([unfiled])

    await user.click(screen.getByRole('button', { name: /add to workflow/i }))
    const dialog = screen.getByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: /Annual review 2026/i }))

    expect(actions.attachNoteToWorkflow).toHaveBeenCalledWith('n2', 'w1')
  })

  test('finished work is not offered, so a note cannot reopen a closed review', async () => {
    const user = userEvent.setup()
    show([unfiled])

    await user.click(screen.getByRole('button', { name: /add to workflow/i }))
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).queryByRole('button', { name: /Onboarding 2024/i })).toBeNull()
  })

  test('a filed note can be taken back out', async () => {
    const user = userEvent.setup()
    show([filed])

    /* Scoped to the row: the picker dialog also contains that workflow's name,
       and a closed <dialog> still has its contents in the document. */
    await user.click(within(rows()[0]).getByRole('button', { name: 'Annual review 2026' }))
    const dialog = screen.getByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: /remove from workflow/i }))

    expect(actions.attachNoteToWorkflow).toHaveBeenCalledWith('n1', null)
  })

  test('a note with no workflow is not offered a remove control', async () => {
    const user = userEvent.setup()
    show([unfiled])

    await user.click(screen.getByRole('button', { name: /add to workflow/i }))
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).queryByRole('button', { name: /remove from workflow/i })).toBeNull()
  })
})

/**
 * The timezone rule, and why it is the OPPOSITE of the one for a date of birth.
 *
 * formatDate() in the member panel splits the ISO string and never touches
 * Date, because a date of birth is a calendar date and `new Date('1985-04-12')`
 * is UTC midnight — which renders as the previous day west of Greenwich.
 *
 * occurred_at is a timestamptz: a moment. The calendar date it falls on really
 * does depend on where the reader is, and their own timezone is the right
 * answer. Splitting the string would show the UTC date, which in Sydney is
 * yesterday for the first ten hours of every morning.
 */
describe('formatNoteDate', () => {
  const withTz = (tz: string, run: () => void) => {
    const original = process.env.TZ
    process.env.TZ = tz
    try {
      run()
    } finally {
      process.env.TZ = original
    }
  }

  test('renders the date in the reader’s timezone', () => {
    // 23:30 UTC on 6 September is already the 7th in Sydney.
    withTz('Australia/Sydney', () => {
      expect(formatNoteDate('2026-09-06T23:30:00Z')).toContain('7 Sep')
    })
  })

  test('the same instant is the previous day further west', () => {
    withTz('America/New_York', () => {
      expect(formatNoteDate('2026-09-06T23:30:00Z')).toContain('6 Sep')
    })
  })

  test('splitting the ISO string would have been wrong — proof', () => {
    // What the date-of-birth helper would produce for the same value.
    const split = '2026-09-06T23:30:00Z'.slice(0, 10)
    expect(split).toBe('2026-09-06')
    withTz('Australia/Sydney', () => {
      expect(formatNoteDate('2026-09-06T23:30:00Z')).not.toContain('6 Sep')
    })
  })

  test('an unparseable value is returned rather than rendering “Invalid Date”', () => {
    expect(formatNoteDate('not a date')).toBe('not a date')
  })
})
