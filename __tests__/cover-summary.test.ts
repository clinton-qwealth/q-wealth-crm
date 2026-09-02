import { describe, expect, test } from 'vitest'
import { coverSummary } from '@/components/ui'

/**
 * The rule this pins down is the one most likely to be broken by someone
 * "simplifying" it later: a lump sum and a monthly income stream are different
 * quantities and must never be added.
 */
describe('coverSummary', () => {
  test('a lump-sum-only policy shows the lump sum', () => {
    expect(coverSummary('1400000', null)).toBe('$1,400,000')
  })

  test('an income-protection policy is marked per month', () => {
    expect(coverSummary(null, '6500')).toBe('$6,500/mo')
  })

  /* The case that matters: both present, joined and NOT summed. */
  test('a policy holding both shows both, never their total', () => {
    const result = coverSummary('750000', '6500')
    expect(result).toBe('$750,000 + $6,500/mo')
    expect(result).not.toContain('756,500')
  })

  test('nothing to show returns null, not a zero', () => {
    expect(coverSummary(null, null)).toBeNull()
    expect(coverSummary(0, 0)).toBeNull()
    expect(coverSummary(undefined, undefined)).toBeNull()
  })

  test('accepts the strings PostgREST returns for numeric columns', () => {
    expect(coverSummary('1000000.00', null)).toBe('$1,000,000')
  })
})
