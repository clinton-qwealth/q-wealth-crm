import { describe, expect, test } from 'vitest'

/**
 * Duplicated from member-panel.tsx rather than exported: the component is a
 * client component and this is a pure string transform, so the test pins the
 * behaviour without dragging the whole panel into scope.
 *
 * The rule it protects is the timezone trap. `new Date('1985-04-12')` parses as
 * UTC midnight, so `toLocaleDateString` in Sydney renders 12 April but in
 * anywhere west of Greenwich renders 11 April — a date of birth silently off by
 * one. Splitting the string cannot do that.
 */
function formatDate(iso?: string | null) {
  if (!iso) return null
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso)
  return m ? `${m[3]}-${m[2]}-${m[1]}` : iso
}

describe('formatDate', () => {
  test('renders DD-MM-YYYY', () => {
    expect(formatDate('1985-04-12')).toBe('12-04-1985')
  })

  test('keeps leading zeros', () => {
    expect(formatDate('2001-01-05')).toBe('05-01-2001')
  })

  test('is unaffected by timezone, unlike a Date round trip', () => {
    // Proof the trap is real: the same input through Date, forced to a timezone
    // behind UTC, yields the previous day.
    const viaDate = new Date('1985-04-12').toLocaleDateString('en-AU', { timeZone: 'America/New_York' })
    expect(viaDate).toContain('11')
    expect(formatDate('1985-04-12')).toBe('12-04-1985')
  })

  test('tolerates a full timestamp', () => {
    expect(formatDate('1985-04-12T00:00:00Z')).toBe('12-04-1985')
  })

  test('returns null for nothing', () => {
    expect(formatDate(null)).toBeNull()
    expect(formatDate(undefined)).toBeNull()
  })

  test('passes anything unrecognised straight through', () => {
    expect(formatDate('circa 1985')).toBe('circa 1985')
  })
})
