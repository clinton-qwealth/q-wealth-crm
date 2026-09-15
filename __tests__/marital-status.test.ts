import { migrationSource } from './helpers/migration'
import { describe, expect, test } from 'vitest'
import { MARITAL_STATUS, maritalLabel } from '@/lib/countries'

/**
 * The picklist and the database enum are one vocabulary kept in two places,
 * which is the thing that goes wrong silently: a value the app offers and the
 * enum lacks is refused at the save, and a value the enum has and the app does
 * not offer can never be chosen. So the migration is read and compared.
 *
 * The same test `lib/balance-sheet.ts` gets for its 22 types, for the same
 * reason — and it matters more here, because this list replaced free text on
 * a column that had already grown two spellings of one word.
 */
const MIGRATION = migrationSource('marital_status_becomes_a_closed_set')

describe('the marital status list matches the database', () => {
  const enumValues = () => {
    const block = /create type public\.marital_status as enum \(([\s\S]*?)\);/.exec(MIGRATION)
    expect(block, 'the enum is not in the migration under the name this test expects').toBeTruthy()
    return [...block![1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1])
  }

  test('offers every enum value, and nothing the enum lacks', () => {
    expect(MARITAL_STATUS.map((m) => m.value)).toEqual(enumValues())
  })

  /* The ORDER too, not just the membership: the select renders in list order,
     and a reader scanning a picklist reads it as a sequence. Declaring them in
     the same order in both places means the two can be compared by eye. */
  test('in the same order the enum declares them', () => {
    expect(MARITAL_STATUS.map((m) => m.value)).toEqual([
      'single', 'married', 'de_facto', 'separated', 'divorced', 'widowed',
    ])
  })

  /**
   * **No `not_disclosed`, deliberately**, where employment status on this same
   * tab has one. The column is nullable and blank already means "not
   * recorded"; a seventh value would split that meaning without adding a fact.
   * Pinned so the decision has to be re-made rather than drifted into.
   */
  test('carries no value for "declined" — blank is that', () => {
    const values = MARITAL_STATUS.map((m) => m.value)
    expect(values).not.toContain('not_disclosed')
    expect(values).not.toContain('prefer_not_to_say')
    expect(values).toHaveLength(6)
  })

  test('every value has a label, and no two share one', () => {
    for (const { value, label } of MARITAL_STATUS) {
      expect(label.trim()).not.toBe('')
      expect(maritalLabel(value)).toBe(label)
    }
    expect(new Set(MARITAL_STATUS.map((m) => m.label)).size).toBe(MARITAL_STATUS.length)
  })

  /* A label that is merely the key tidied up would make the map pointless and
     the panel test vacuous. At least one has to differ from its own key. */
  test('at least one label is not just its key', () => {
    const differing = MARITAL_STATUS.filter((m) => m.label.toLowerCase() !== m.value)
    expect(differing.map((m) => m.value)).toContain('de_facto')
  })

  describe('maritalLabel', () => {
    test('turns a stored key into words', () => {
      expect(maritalLabel('de_facto')).toBe('De facto')
      expect(maritalLabel('widowed')).toBe('Widowed')
    })

    test('nothing recorded is nothing shown, not the word "null"', () => {
      expect(maritalLabel(null)).toBeNull()
      expect(maritalLabel(undefined)).toBeNull()
      expect(maritalLabel('')).toBeNull()
    })

    /**
     * A value this list has not been taught about falls back to itself rather
     * than to nothing. The enum makes that unreachable through the database
     * today — but the fallback is what keeps a future seventh value visible on
     * screen during the window between the migration that adds it and the
     * deploy that teaches this list about it.
     */
    test('an unknown value is shown as it is, not swallowed', () => {
      expect(maritalLabel('registered_relationship')).toBe('registered_relationship')
    })
  })
})
