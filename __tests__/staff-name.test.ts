import { describe, expect, test } from 'vitest'
import { fullName, initialsOf, initialsOfString, sortName } from '@/lib/staff-name'
import { migrationSource } from './helpers/migration'

/**
 * A staff member's name, in two parts — and the one rule that put it there.
 *
 * `staff_users.full_name` became `first_name` + `last_name` on 19 September
 * 2026. Two things are worth pinning and nothing else here is.
 *
 * **The composition happens twice, in two languages.** `lib/staff-name.ts`
 * joins the parts in the browser and `public.staff_display_name()` joins them
 * in a view, and both strings land on the same screen — the staff drawer's
 * heading beside a workflow post's author. If they ever disagree the same
 * person appears under two names. So the TypeScript side is pinned here and the
 * SQL side is pinned against the migration text below.
 *
 * **The split is one-way and destructive.** The backfill ran once, over rows
 * that can no longer be reconstructed, so the rule it used is history now: the
 * assertions on `split_staff_name` describe what the database already did to
 * live data, not a behaviour a future edit is free to revise.
 */
describe('composing a name for display', () => {
  test('the two parts, one space', () => {
    expect(fullName({ first_name: 'Clinton', last_name: 'Hatcher' })).toBe('Clinton Hatcher')
  })

  /* The columns forbid a blank half, but this also renders rows the browser
     built optimistically, before the database ever saw them. */
  test('a half that is blank or padded leaves no stray space', () => {
    expect(fullName({ first_name: ' Clinton ', last_name: ' Hatcher ' })).toBe('Clinton Hatcher')
    expect(fullName({ first_name: 'Clinton', last_name: '' })).toBe('Clinton')
    expect(fullName({ first_name: '', last_name: 'Hatcher' })).toBe('Hatcher')
    expect(fullName({ first_name: '', last_name: '' })).toBe('')
  })

  test('a multi-word first name stays whole', () => {
    expect(fullName({ first_name: 'Mary-Jane van der', last_name: 'Berg' })).toBe('Mary-Jane van der Berg')
  })
})

describe('sortName', () => {
  test('surname first, comma, then the given name', () => {
    expect(sortName({ first_name: 'Clinton', last_name: 'Hatcher' })).toBe('Hatcher, Clinton')
  })

  /* Sorting the strings this produces is the same order as the database's
     `.order('last_name').order('first_name')` — which is where the real sort
     happens, over the whole set rather than one page of it. */
  test('sorted, it puts a directory in surname order', () => {
    const people = [
      { first_name: 'Zoe', last_name: 'Adams' },
      { first_name: 'Alan', last_name: 'Young' },
      { first_name: 'Bella', last_name: 'Adams' },
    ]
    expect([...people].sort((a, b) => sortName(a).localeCompare(sortName(b))).map(fullName)).toEqual([
      'Bella Adams',
      'Zoe Adams',
      'Alan Young',
    ])
  })

  test('no comma dangles when a half is missing', () => {
    expect(sortName({ first_name: 'Clinton', last_name: '' })).toBe('Clinton')
    expect(sortName({ first_name: '', last_name: 'Hatcher' })).toBe('Hatcher')
  })
})

describe('initials', () => {
  /**
   * **The correction the split bought.** The three implementations this
   * replaced all took the first letter of the first TWO words, so
   * "Mary-Jane van der Berg" gave MV — the initials of a first name and a
   * particle. With the parts in hand there is nothing left to infer.
   */
  test('the first name and the LAST name, never the first two words', () => {
    expect(initialsOf({ first_name: 'Mary-Jane van der', last_name: 'Berg' })).toBe('MB')
    expect(initialsOf({ first_name: 'clinton', last_name: 'hatcher' })).toBe('CH')
  })

  test('a middle dot rather than an empty tile', () => {
    expect(initialsOf({ first_name: '', last_name: '' })).toBe('·')
    expect(initialsOf({ first_name: 'Clinton', last_name: '' })).toBe('C')
  })

  /* For names that only ever exist as one string — a client's display_name, or
     a `*_name` column a view composed. Same first-and-last rule. */
  test('the string form takes the first and last token too', () => {
    expect(initialsOfString('Mary-Jane van der Berg')).toBe('MB')
    expect(initialsOfString('Testsmith Family Trust')).toBe('TT')
    expect(initialsOfString('  padded   name  ')).toBe('PN')
    expect(initialsOfString('Prince')).toBe('P')
    expect(initialsOfString('')).toBe('·')
  })
})

/**
 * The SQL side of the same vocabulary, read from the migration that created it.
 */
const sql = migrationSource('a_staff_member_has_a_first_and_last_name')

describe('the split the backfill ran', () => {
  test('the last whitespace token is the surname, the rest the first name', () => {
    expect(sql).toContain("btrim(regexp_replace(v_clean, '\\s+\\S+$', ''))")
    expect(sql).toContain("btrim(regexp_replace(v_clean, '^.*\\s', ''))")
  })

  /**
   * **The guard tests for the separator, not for a blank result.**
   *
   * `regexp_replace` returns its input unchanged when nothing matches, so a
   * single-token name splits to ITSELF on both sides — 'Prince' landing as
   * first name Prince and last name Prince — and a guard checking only that
   * each half is non-blank passes that silently. Proved by probing the
   * expression against the live rows before the migration was written.
   */
  test('a name with no internal whitespace raises rather than duplicating itself', () => {
    expect(sql).toMatch(/if v_clean !~ '\\s' then\s+raise exception 'Enter a first name and a last name'/)
    expect(sql, 'the guard is on the separator, not on a blank half').not.toMatch(/v_clean = ''\s+then/)
  })

  test('whitespace is collapsed before it is trimmed, so a newline cannot survive', () => {
    expect(sql).toContain("btrim(regexp_replace(coalesce(p_name, ''), '\\s+', ' ', 'g'))")
  })

  /* An unsplittable name ABORTS the whole migration. The alternative — writing
     a blank surname — would be locked in by the NOT NULL immediately below it. */
  test('the backfill refuses the whole set rather than coercing one row', () => {
    expect(sql).toContain('raise exception \'These staff names cannot be split into a first and last name: %\', v_bad')
    expect(sql).toMatch(/alter column first_name set not null/)
    expect(sql).toMatch(/alter column last_name\s+set not null/)
  })

  /**
   * A DEFERRABLE INITIALLY DEFERRED constraint trigger on this table queues one
   * event per updated row to fire at COMMIT, and Postgres then answers the next
   * `alter table` with `55006: cannot ALTER TABLE ... pending trigger events`.
   * The first apply failed on exactly this.
   */
  test('the queued constraint events are forced before the columns are altered', () => {
    /* Anchored to the start of a line, so commenting the statement out is a
       failure rather than a match inside the comment that replaced it. */
    const backfill = sql.search(/^update public\.staff_users$/m)
    const immediate = sql.search(/^set constraints all immediate;$/m)
    const notNull = sql.search(/^\s+alter column first_name set not null,$/m)
    expect(immediate, 'set constraints all immediate; stands as its own statement').toBeGreaterThan(-1)
    expect(immediate).toBeGreaterThan(backfill)
    expect(notNull).toBeGreaterThan(immediate)
  })

  test('staff_display_name is the inverse, and executable by the caller the views run as', () => {
    expect(sql).toContain('grant execute on function public.staff_display_name(text, text) to authenticated;')
    expect(sql).toContain('revoke all on function public.staff_display_name(text, text) from public, anon;')
  })
})
