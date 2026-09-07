import { describe, expect, test } from 'vitest'
import { workflowProgress } from '@/lib/workflow-board'
import { formatCalendarDate, formatNoteDate } from '@/lib/note-date'

/**
 * Progress is derived from status, so this is the whole rule in one place.
 * The component test asserts it reaches the bar; this asserts the arithmetic.
 */
describe('workflowProgress', () => {
  test('evenly spaced across the four board stages', () => {
    expect(workflowProgress('not_started').percent).toBe(0)
    expect(workflowProgress('in_progress').percent).toBe(33)
    expect(workflowProgress('under_review').percent).toBe(67)
    expect(workflowProgress('complete').percent).toBe(100)
  })

  test('blocked holds the place of the lane it sits in, not zero', () => {
    expect(workflowProgress('blocked').percent).toBe(33)
    expect(workflowProgress('blocked').label).toBe('Blocked')
  })

  test('cancelled has no percentage at all — 0 would be a claim', () => {
    expect(workflowProgress('cancelled').percent).toBeNull()
    expect(workflowProgress('cancelled').label).toBe('Cancelled')
  })

  test('the label is the status in words, so the bar is never unlabelled', () => {
    expect(workflowProgress('in_progress').label).toBe('In progress')
    expect(workflowProgress('complete').label).toBe('Complete')
  })
})

/**
 * The pair of opposite date rules, asserted together — the point of them
 * living in one module.
 */
describe('formatCalendarDate', () => {
  const withTz = (tz: string, run: () => void) => {
    const original = process.env.TZ
    process.env.TZ = tz
    try {
      run()
    } finally {
      process.env.TZ = original
    }
  }

  test('a date reads as written, wherever it is read', () => {
    for (const tz of ['Australia/Sydney', 'America/New_York', 'UTC']) {
      withTz(tz, () => expect(formatCalendarDate('2026-09-30')).toBe('30 Sep 2026'))
    }
  })

  test('going through Date would have lost a day — proof', () => {
    withTz('America/New_York', () => {
      // What the instant formatter produces for the same string: the day before.
      expect(formatNoteDate('2026-09-30')).toBe('29 Sep 2026')
      expect(formatCalendarDate('2026-09-30')).toBe('30 Sep 2026')
    })
  })

  test('the day is not zero-padded, matching the instant formatter', () => {
    expect(formatCalendarDate('2026-09-06')).toBe('6 Sep 2026')
  })

  test('an unparseable value is handed back rather than rendered as nonsense', () => {
    expect(formatCalendarDate('not a date')).toBe('not a date')
    expect(formatCalendarDate('2026-13-01')).toBe('2026-13-01')
  })
})
