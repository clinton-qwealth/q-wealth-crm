import { describe, expect, test } from 'vitest'
import { dueState, isOverdue, todayISO } from '@/lib/note-date'

/**
 * The date trap, in reverse.
 *
 * The other date helpers take a stored value and decide how to render it. This
 * one compares a stored CALENDAR DATE against *now*, so it needs a "today" —
 * and "today" is a different day depending on where the reader is standing.
 */
const withTz = (tz: string, run: () => void) => {
  const original = process.env.TZ
  process.env.TZ = tz
  try {
    run()
  } finally {
    process.env.TZ = original
  }
}

describe('todayISO', () => {
  test('is built from the reader’s local calendar, not from UTC', () => {
    // 22:30 UTC on 7 September is already the 8th in Sydney, still the 7th in New York.
    const instant = new Date('2026-09-07T22:30:00Z')
    withTz('Australia/Sydney', () => expect(todayISO(instant)).toBe('2026-09-08'))
    withTz('America/New_York', () => expect(todayISO(instant)).toBe('2026-09-07'))
    // What toISOString would have given, and why it is not used.
    expect(instant.toISOString().slice(0, 10)).toBe('2026-09-07')
  })

  test('pads the month and the day, so the string compares correctly', () => {
    withTz('UTC', () => expect(todayISO(new Date('2026-01-05T12:00:00Z'))).toBe('2026-01-05'))
  })
})

describe('isOverdue', () => {
  const today = '2026-09-08'

  test('yesterday is overdue; tomorrow is not', () => {
    expect(isOverdue('2026-09-07', today)).toBe(true)
    expect(isOverdue('2026-09-09', today)).toBe(false)
  })

  test('due TODAY is not overdue — a task has all of its due date to be done in', () => {
    expect(isOverdue('2026-09-08', today)).toBe(false)
  })

  test('no due date is never overdue', () => {
    expect(isOverdue(null, today)).toBe(false)
    expect(isOverdue(undefined, today)).toBe(false)
  })

  test('a value that is not a date is not overdue rather than throwing', () => {
    expect(isOverdue('not a date', today)).toBe(false)
    expect(isOverdue('', today)).toBe(false)
  })

  test('it compares across a year boundary, which string order gets right', () => {
    expect(isOverdue('2025-12-31', '2026-01-01')).toBe(true)
    expect(isOverdue('2026-01-01', '2025-12-31')).toBe(false)
  })

  test('agrees with dueState, of which it is the past case', () => {
    for (const d of ['2026-09-07', '2026-09-08', '2026-09-09', null, 'junk']) {
      expect(isOverdue(d, today)).toBe(dueState(d, today) === 'overdue')
    }
  })

  /**
   * The substantive claim: at one instant, two readers can honestly disagree
   * about whether a task is overdue, and each is right about their own day.
   */
  test('the same instant gives different answers in two timezones — as it must', () => {
    const instant = new Date('2026-09-07T22:30:00Z')
    // A task due on the 7th: already yesterday in Sydney, still today in New York.
    withTz('Australia/Sydney', () => expect(isOverdue('2026-09-07', todayISO(instant))).toBe(true))
    withTz('America/New_York', () => expect(isOverdue('2026-09-07', todayISO(instant))).toBe(false))
  })
})

describe('dueState', () => {
  const today = '2026-09-08'

  test('names the three places a due date can stand against today', () => {
    expect(dueState('2026-09-07', today)).toBe('overdue')
    expect(dueState('2026-09-08', today)).toBe('today')
    expect(dueState('2026-09-09', today)).toBe('upcoming')
  })

  test('no date, or something that is not a date, has no state rather than throwing', () => {
    expect(dueState(null, today)).toBeNull()
    expect(dueState(undefined, today)).toBeNull()
    expect(dueState('', today)).toBeNull()
    expect(dueState('soon', today)).toBeNull()
  })

  test('"today" is the reader’s own day, so the same instant is "today" in Sydney and "upcoming" in New York', () => {
    const instant = new Date('2026-09-07T22:30:00Z')
    withTz('Australia/Sydney', () => expect(dueState('2026-09-08', todayISO(instant))).toBe('today'))
    withTz('America/New_York', () => expect(dueState('2026-09-08', todayISO(instant))).toBe('upcoming'))
  })
})
