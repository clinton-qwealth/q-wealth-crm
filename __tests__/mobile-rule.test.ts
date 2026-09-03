import { describe, expect, test } from 'vitest'

/**
 * The mobile rule exists in two places — a check in `patchMember` and
 * `public.to_e164_au` in the database — and they must agree.
 *
 * A validator STRICTER than the database refuses saves the database would have
 * accepted, which is a bug that presents as "the form is broken". Looser is
 * worse: it lets a number through that fails later, mid-telephone-call, which is
 * the whole thing the check exists to prevent.
 *
 * These are the same cases run against the database function on 3 Sep 2026,
 * with its actual results, so a change to either side breaks this.
 */
function accepted(raw: string) {
  const digits = raw.replace(/[^0-9]/g, '')
  return raw.trim().startsWith('+')
    ? /^[1-9][0-9]{7,14}$/.test(digits)
    : /^04[0-9]{8}$/.test(digits) || /^614[0-9]{8}$/.test(digits)
}

describe('the mobile rule matches the database', () => {
  test.each([
    // Verified against to_e164_au, which returned a number for each of these.
    ['0412 555 901', true],
    ['0412555901', true],
    ['04 1255 5901', true],
    ['(04) 1255-5901', true],
    ['61412555901', true],
    ['+61412555901', true],
    ['+61 412 555 901', true],
    ['+64 21 555 901', true],
    ['+1 415 555 0132', true],
    // ...and refused each of these.
    ['0212345678', false],   // a landline
    ['12345', false],
    ['', false],
    ['0412 555 90', false],  // one digit short
    ['+61 41', false],
  ])('%s -> %s', (input, expected) => {
    expect(accepted(input)).toBe(expected)
  })

  /* The field may be emptied — clearing deletes the contact point. The guard in
     patchMember only runs on a non-empty value, which is why '' reads as
     "not a valid number" here and is still a permitted save. */
  test('an empty value is not a valid number, and is handled before this rule', () => {
    expect(accepted('')).toBe(false)
  })
})
