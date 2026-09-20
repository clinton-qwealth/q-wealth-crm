import { describe, expect, test } from 'vitest'
import { migrationSource } from './helpers/migration'

/**
 * `staff_last_seen()` — the shape of the function that tells an administrator
 * when each colleague was last in the CRM.
 *
 * Three decisions here are invisible from the app and each would be a quiet
 * regression if reversed.
 */
const sql = migrationSource('an_administrator_can_see_when_staff_were_last_seen')

/* The function's BODY, not the whole file. The header comment explains at
   length why `refreshed_at` is avoided, so a file-wide scan for that word
   finds the warning rather than the fault — which is how an assertion ends up
   testing its own documentation. */
const body = sql.slice(sql.indexOf('as $fn$'), sql.indexOf('$fn$;'))

describe('staff_last_seen', () => {
  /**
   * **`updated_at`, never `refreshed_at`.** `auth.sessions` carries both and
   * they move together — but `refreshed_at` is `timestamp WITHOUT time zone`
   * holding UTC, so any comparison against `now()` reads it as local time and
   * lands ten hours out in Sydney. Checked against the live table before this
   * was written; the wrong one is right there beside the right one.
   */
  test('reads the timezone-aware session column, not the naive one', () => {
    expect(body).toContain('max(x.updated_at) as newest_session')
    expect(body, 'refreshed_at is a naive timestamp — see the header').not.toContain('refreshed_at')
  })

  /**
   * Last seen is the LATER of the sign-in and the session, because somebody
   * working all afternoon stops signing in but keeps refreshing. Sign-in alone
   * was the wrong answer, and is what this exists instead of.
   */
  test('is the later of the sign-in and the newest session', () => {
    expect(body).toContain('greatest(u.last_sign_in_at, s.newest_session)')
  })

  /**
   * The permission check is INSIDE the function, because it runs as its owner
   * and can therefore read `auth.users`. Without that line every signed-in
   * person could read every colleague's sign-in time. A non-administrator gets
   * zero rows rather than a refusal, matching every other staff read.
   */
  test('returns nothing at all to a caller without manage_staff', () => {
    expect(body).toMatch(/where public\.current_staff_has\('manage_staff'\)/)
    expect(sql).toContain('security definer')
    expect(sql).toContain("set search_path to ''")
  })

  test('is not executable by anonymous callers, and says so twice', () => {
    expect(sql).toContain('revoke all on function public.staff_last_seen() from public, anon;')
    expect(sql).toContain('grant execute on function public.staff_last_seen() to authenticated;')
    expect(sql).toContain('anon or PUBLIC may execute staff_last_seen')
  })

  /* A definer VIEW would be flagged at ERROR by the linter permanently — the
     state migration 20260831114103 exists to escape. A function is the shape. */
  test('is a function rather than a security-definer view', () => {
    expect(sql).not.toMatch(/create\s+(or replace\s+)?view/i)
  })
})
