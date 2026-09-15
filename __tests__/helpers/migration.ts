import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const DIR = join(__dirname, '..', '..', 'supabase', 'migrations')

/**
 * A migration's text, found by its NAME rather than its timestamp.
 *
 * Several tests read a migration to check that a list in the application still
 * matches the enum in the database. Addressing it by full filename couples the
 * test to the timestamp — and the timestamp is not ours to keep: the standing
 * convention is that a migration file must be renamed to whatever version the
 * apply actually recorded, which is rarely the one the file was drafted with.
 *
 * `dir` is for this module's own test and nothing else: the duplicate-name
 * case cannot be reached against the real migrations directory, and it is the
 * one this function exists to refuse.
 *
 * That bit on 15 September 2026. Four files were found disagreeing with
 * production and renamed, and two test files stopped loading at all, because
 * each had the old timestamp written into a path. The tests were right to
 * break — they were reading a file that no longer existed — but they broke for
 * a reason that has nothing to do with what they assert.
 *
 * So the name is the key, and the timestamp is allowed to move. A name that
 * matches no file, or more than one, throws with the candidates listed rather
 * than returning something a caller would go on to parse as empty.
 *
 * **The whole name, anchored at both ends.** `endsWith('_' + name + '.sql')`
 * was the first attempt and it is not the same rule: it accepts any tail that
 * begins at an underscore, so `assets_and_liabilities` resolves happily to
 * `..._a_group_s_assets_and_liabilities.sql` — a file the caller did not name.
 * The pattern below requires the timestamp, then the name entire, then `.sql`.
 */
export function migrationSource(name: string, dir: string = DIR): string {
  const exact = new RegExp(`^\\d+_${name.replace(/[^a-z0-9_]/gi, '\\$&')}\\.sql$`)
  const matches = readdirSync(dir).filter((f) => exact.test(f))
  if (matches.length !== 1) {
    throw new Error(
      `expected exactly one migration named ${name}, found ${matches.length}` +
        (matches.length ? `: ${matches.join(', ')}` : ''),
    )
  }
  return readFileSync(join(dir, matches[0]), 'utf8')
}
