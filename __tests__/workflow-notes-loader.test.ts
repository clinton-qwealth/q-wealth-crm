import { beforeEach, describe, expect, test, vi } from 'vitest'

/**
 * `getWorkflowNotes()` — the one query behind the workflow's File Notes tab.
 *
 * The case worth having a file for is the DEDUPLICATION. `group_notes_summary`
 * has one row per (note, group) pair, because a note reaches a group either by
 * naming it or by naming one of its members and the view keeps both routes. So
 * a note whose subjects span two groups comes back twice when the filter is the
 * workflow rather than the group.
 *
 * **Two notes in the live database already reach more than one group**, checked
 * before this was written, and neither is filed under a workflow yet — so the
 * duplicate would have been latent until the day somebody filed one.
 */
let RESULT: { data: unknown; error: { message: string } | null } = { data: [], error: null }
const calls: { table: string; filters: [string, string][]; ordered: string[]; limit: number | null }[] = []

vi.mock('next/headers', () => ({ cookies: async () => ({ getAll: () => [], set: () => {} }) }))
vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: async () => ({
    from: (table: string) => {
      const record = { table, filters: [] as [string, string][], ordered: [] as string[], limit: null as number | null }
      calls.push(record)
      const chain = {
        select: () => chain,
        eq: (column: string, value: string) => {
          record.filters.push([column, value])
          return chain
        },
        order: (column: string) => {
          record.ordered.push(column)
          return chain
        },
        limit: (n: number) => {
          record.limit = n
          return chain
        },
        then: (res: (v: typeof RESULT) => unknown, rej: (e: unknown) => unknown) =>
          Promise.resolve(RESULT).then(res, rej),
      }
      return chain
    },
  }),
}))

const { getWorkflowNotes } = await import('@/lib/notes')

const row = (o: Record<string, unknown> = {}) => ({
  note_id: 'n1',
  note_type: 'meeting_summary',
  title: 'Annual review meeting',
  occurred_at: '2026-07-06T02:00:00Z',
  author_name: 'Sarah Chen',
  source: 'manual',
  workflow_id: 'w1',
  workflow_name: 'Annual review 2026',
  workflow_status: 'in_progress',
  body_excerpt: 'Discussed the rollover',
  body_is_truncated: false,
  ...o,
})

beforeEach(() => {
  calls.length = 0
  RESULT = { data: [], error: null }
})

describe('getWorkflowNotes', () => {
  test('reads the notes view filtered to the workflow, newest first, capped', async () => {
    await getWorkflowNotes('w1')
    expect(calls).toHaveLength(1)
    expect(calls[0].table).toBe('group_notes_summary')
    expect(calls[0].filters).toEqual([['workflow_id', 'w1']])
    expect(calls[0].ordered).toEqual(['occurred_at'])
    expect(calls[0].limit).toBe(50)
  })

  /**
   * The whole reason this file exists. A note naming parties in two groups
   * comes back twice, and the tab must list it once.
   */
  test('a note that reaches two groups is listed ONCE', async () => {
    RESULT = { data: [row(), row()], error: null }
    const notes = await getWorkflowNotes('w1')
    expect(notes).toHaveLength(1)
    expect(notes[0].note_id).toBe('n1')
  })

  test('the first row of a duplicated pair is the one kept, so the order survives', async () => {
    RESULT = {
      data: [
        row({ note_id: 'newest', occurred_at: '2026-08-01T00:00:00Z' }),
        row({ note_id: 'older' }),
        row({ note_id: 'newest', occurred_at: '2026-08-01T00:00:00Z' }),
      ],
      error: null,
    }
    const notes = await getWorkflowNotes('w1')
    expect(notes.map((n) => n.note_id)).toEqual(['newest', 'older'])
  })

  test('distinct notes are all kept', async () => {
    RESULT = { data: [row({ note_id: 'a' }), row({ note_id: 'b' }), row({ note_id: 'c' })], error: null }
    await expect(getWorkflowNotes('w1')).resolves.toHaveLength(3)
  })

  /** A discarded query error turns a broken column into one that says a workflow has no notes. */
  test('THROWS on a query error rather than reporting no notes', async () => {
    RESULT = { data: null, error: { message: 'permission denied for view group_notes_summary' } }
    await expect(getWorkflowNotes('w1')).rejects.toThrow(/could not be read/)
    await expect(getWorkflowNotes('w1')).rejects.toThrow(/permission denied/)
  })

  test('a genuinely empty result is an empty list, not a throw', async () => {
    RESULT = { data: [], error: null }
    await expect(getWorkflowNotes('w1')).resolves.toEqual([])
  })
})
