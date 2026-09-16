import { describe, expect, test } from 'vitest'
import { migrationSource } from './helpers/migration'
import { ASSET_CLASSES, ASSET_CLASS_LABEL } from '@/lib/allocation'

/**
 * The eight asset classes exist in two places, and they must agree.
 *
 * The **database** holds them as a check constraint on
 * `financial_account_allocations.asset_class`, which is what makes an unknown
 * class impossible to store. The **app** holds them as an ordered list with
 * display text, because a check constraint has neither an order nor a name a
 * person can read. Neither can be derived from the other.
 *
 * ## Why this one is worth a test rather than a convention
 *
 * The set is explicitly designed to grow — the 15 September migration chose
 * `text` with a check over an enum precisely so "a new asset class is a
 * check-constraint value, not an ALTER TABLE" — and it then grew **the same
 * day**, when the first real HUB24 run reported `PropertyDirect` and
 * `direct_property` had to be added.
 *
 * Both directions fail badly and quietly:
 *
 * - a class in the database and not here is **dropped by `allocation()`**, so a
 *   real holding vanishes from a client's chart while the percentages beside it
 *   still look plausible;
 * - a class here and not in the database is a legend entry nobody can ever see,
 *   which reads as a feature that does not work.
 *
 * The migration is read as source because it is SQL. `migrationSource` resolves
 * it by name, not by timestamp, because the timestamp is not ours to keep.
 */
const migration = migrationSource('hub24_sends_ten_asset_classes')

/** The values inside `financial_account_allocations_class_known`. */
const inDatabase = (() => {
  const clause = migration.match(
    /constraint financial_account_allocations_class_known check \(asset_class in \(([^)]*)\)/,
  )
  if (!clause) throw new Error('the class check constraint is not where this test expects it')
  return new Set([...clause[1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1]))
})()

describe('the asset classes', () => {
  /* If the scrape silently found nothing, every set comparison below would
     pass against an empty set on both sides. */
  test('were actually found in the migration', () => {
    expect(inDatabase.size).toBe(8)
  })

  test('the app knows every class the database will accept', () => {
    const missing = [...inDatabase].filter((c) => !ASSET_CLASSES.includes(c as never))
    expect(
      missing,
      `the database accepts ${missing.join(', ')}, which allocation() would silently drop`,
    ).toEqual([])
  })

  test('and claims none the database would refuse', () => {
    const extra = ASSET_CLASSES.filter((c) => !inDatabase.has(c))
    expect(
      extra,
      `the app lists ${extra.join(', ')}, which can never appear in a row`,
    ).toEqual([])
  })

  test('and every one of them is written out in words', () => {
    for (const key of ASSET_CLASSES) {
      const label = ASSET_CLASS_LABEL[key]
      expect(label, `${key} has no label`).toBeTruthy()
      // The label must be prose, not the key with its underscores showing —
      // the failure this catches is a map filled in by copying the key across.
      expect(label, `${key} is labelled with its own key`).not.toBe(key)
      expect(label, `${key}'s label still has an underscore in it`).not.toContain('_')
    }
  })
})
