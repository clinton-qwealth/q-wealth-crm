import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import { migrationSource } from './helpers/migration'

/**
 * `migrationSource` is test infrastructure, and its failure mode is the worst
 * kind: **silently returning the wrong file.** Three tests read a migration to
 * check that a list in the application still matches an enum in the database,
 * and each of them is only as good as this lookup — a helper that resolved to
 * some other migration would make all three pass against the wrong SQL.
 *
 * It exists because addressing a migration by full filename couples a test to
 * a timestamp that is not ours to keep: the convention is that a migration file
 * is renamed to whatever version the apply recorded. On 15 September 2026 four
 * files were found disagreeing with production, and renaming them stopped two
 * test files loading at all.
 */
describe('migrationSource', () => {
  test('finds a migration by name and returns its text', () => {
    const sql = migrationSource('marital_status_becomes_a_closed_set')
    expect(sql).toContain('create type public.marital_status as enum')
  })

  test('a name nothing matches throws, rather than returning empty text', () => {
    expect(() => migrationSource('no_such_migration_was_ever_written')).toThrow(/found 0/)
  })

  /**
   * **The name has to be the WHOLE name, not a fragment.**
   *
   * `assets_and_liabilities` is a proper substring of
   * `a_group_s_assets_and_liabilities`, so a lookup written with `includes`
   * would resolve it happily to that file — and a caller who mistyped, or who
   * meant a different migration entirely, would get SQL they never asked for
   * and assertions that passed against it. Anchoring on the separator is what
   * makes a partial name a failure instead of a lucky guess.
   */
  test('a fragment of a name is refused, not resolved to the file it happens to be inside', () => {
    expect(() => migrationSource('assets_and_liabilities')).toThrow(/found 0/)
    // And the whole name still works, so the rule above is the only difference.
    expect(migrationSource('a_group_s_assets_and_liabilities')).toContain(
      'create type public.asset_liability_type',
    )
  })

  /* The error names what it found, because "it threw" is not enough to debug
     a rename — the candidates are the thing a reader needs. */
  test('the refusal says how many it found', () => {
    expect(() => migrationSource('nope')).toThrow(/expected exactly one migration named nope/)
  })

  /**
   * **Two files under one name is refused, not silently resolved to whichever
   * the directory listed first.**
   *
   * That is the case `!== 1` exists for and the reason the check is not
   * `=== 0`. It is reachable in practice — a rename that copies instead of
   * moving, or a new migration drafted under a name already used — and it
   * cannot be reached against the real directory, which is why the function
   * takes a directory at all.
   */
  test('two migrations under one name is an error, and both are named', () => {
    const dir = mkdtempSync(join(tmpdir(), 'qw-migrations-'))
    writeFileSync(join(dir, '20260101000000_same_name.sql'), 'first')
    writeFileSync(join(dir, '20260102000000_same_name.sql'), 'second')

    expect(() => migrationSource('same_name', dir)).toThrow(/found 2/)
    // The candidates are listed, so the fix is obvious from the message alone.
    expect(() => migrationSource('same_name', dir)).toThrow(/20260101000000_same_name\.sql/)
    expect(() => migrationSource('same_name', dir)).toThrow(/20260102000000_same_name\.sql/)

    // And one file under that name resolves normally, so the rule above is the
    // only difference between the two cases.
    const solo = mkdtempSync(join(tmpdir(), 'qw-migrations-'))
    writeFileSync(join(solo, '20260101000000_same_name.sql'), 'only one')
    expect(migrationSource('same_name', solo)).toBe('only one')
  })
})
