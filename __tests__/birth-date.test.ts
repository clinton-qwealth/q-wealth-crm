import { describe, expect, test } from 'vitest'
import { formatBirthDate } from '@/lib/note-date'

/**
 * A date of birth renders as digits, and never through `new Date()`.
 *
 * `new Date('1980-06-01')` is midnight UTC, which anywhere west of Greenwich is
 * the previous evening — so a naive formatter shows 31-05-1980 to a reader in
 * Perth's afternoon and 01-06-1980 to one in Sydney's. A calendar date has no
 * timezone, so the string is split and nothing is constructed. Shared by the
 * member panel and the staff drawer since 20 Sep 2026, so a client's and a
 * colleague's cannot render differently.
 */
describe('formatBirthDate', () => {
  test('DD-MM-YYYY, from the string alone', () => {
    expect(formatBirthDate('1980-06-01')).toBe('01-06-1980')
    expect(formatBirthDate('2000-12-31')).toBe('31-12-2000')
  })

  test('is not moved by the runtime timezone', () => {
    const before = process.env.TZ
    try {
      process.env.TZ = 'America/Los_Angeles'
      expect(formatBirthDate('1980-06-01')).toBe('01-06-1980')
    } finally {
      process.env.TZ = before
    }
  })

  test('null and empty pass through as null; an unrecognised shape is handed back untouched', () => {
    expect(formatBirthDate(null)).toBeNull()
    expect(formatBirthDate(undefined)).toBeNull()
    expect(formatBirthDate('')).toBeNull()
    expect(formatBirthDate('June 1980')).toBe('June 1980')
  })
})
