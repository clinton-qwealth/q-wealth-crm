import { describe, expect, test } from 'vitest'
import { totp } from '../e2e/totp'

/**
 * RFC 6238 publishes reference vectors. Testing against them proves the
 * implementation rather than proving it agrees with itself.
 *
 * The published SHA-1 vectors use the ASCII secret "12345678901234567890",
 * which is "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ" in base32.
 */
const SECRET = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ'

describe('totp', () => {
  test.each([
    [59, '287082'],
    [1111111109, '081804'],
    [1111111111, '050471'],
    [1234567890, '005924'],
    [2000000000, '279037'],
  ])('matches the RFC 6238 vector at t=%i', (seconds, expected) => {
    expect(totp(SECRET, seconds * 1000)).toBe(expected)
  })

  test('produces six digits', () => {
    expect(totp(SECRET)).toMatch(/^\d{6}$/)
  })
})
