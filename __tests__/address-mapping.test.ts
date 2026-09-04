import { describe, expect, test } from 'vitest'
import { mapComponents } from '@/lib/address'

/**
 * Google's component list to the five fields the CRM stores.
 *
 * This is the part most likely to be quietly wrong in a way nobody notices for
 * months: a unit number swallowed into the street line, or a state stored as
 * "New South Wales" in some records and "NSW" in the rest. Neither breaks
 * anything visibly — they just make the data inconsistent.
 */
const nsw = [
  { types: ['street_number'], longText: '12', shortText: '12' },
  { types: ['route'], longText: 'Bay Street', shortText: 'Bay St' },
  { types: ['locality', 'political'], longText: 'Mosman', shortText: 'Mosman' },
  {
    types: ['administrative_area_level_1', 'political'],
    longText: 'New South Wales',
    shortText: 'NSW',
  },
  { types: ['country', 'political'], longText: 'Australia', shortText: 'AU' },
  { types: ['postal_code'], longText: '2088', shortText: '2088' },
]

describe('mapComponents', () => {
  test('a plain street address fills all five fields', () => {
    expect(mapComponents(nsw)).toEqual({
      line1: '12 Bay Street',
      line2: '',
      suburb: 'Mosman',
      state: 'NSW',
      postcode: '2088',
    })
  })

  /**
   * The abbreviation, not the full name. Every record already holds "NSW", and
   * the state box is one column wide in the form. A mix of both would be worse
   * than consistently either.
   */
  test('the state is the abbreviation', () => {
    expect(mapComponents(nsw).state).toBe('NSW')
    expect(mapComponents(nsw).state).not.toBe('New South Wales')
  })

  /** The street line is number then street, not street then number. */
  test('the street line reads as an envelope would', () => {
    expect(mapComponents(nsw).line1).toBe('12 Bay Street')
  })

  /* A unit belongs on its own line. Jammed into the street line it would read
     "4 12 Bay Street", which is nobody's address. */
  test('a unit number goes to line 2, not into the street', () => {
    const withUnit = [{ types: ['subpremise'], longText: '4', shortText: '4' }, ...nsw]
    const got = mapComponents(withUnit)
    expect(got.line2).toBe('Unit 4')
    expect(got.line1).toBe('12 Bay Street')
  })

  /* Rural and PO-box style results arrive without a street number. Half an
     address is still worth filling — the adviser corrects the rest. */
  test('a missing street number does not produce a leading space', () => {
    const noNumber = nsw.filter((c) => !c.types?.includes('street_number'))
    expect(mapComponents(noNumber).line1).toBe('Bay Street')
  })

  test('an empty component list yields empty strings, never undefined', () => {
    expect(mapComponents([])).toEqual({
      line1: '', line2: '', suburb: '', state: '', postcode: '',
    })
  })

  /* Google occasionally omits shortText. Falling through to undefined would put
     the string "undefined" in a client's address. */
  test('a component with no shortText does not leak undefined', () => {
    const odd = [{ types: ['administrative_area_level_1'], longText: 'Queensland' }]
    expect(mapComponents(odd).state).toBe('')
  })
})
