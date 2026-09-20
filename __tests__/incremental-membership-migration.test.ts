import { describe, expect, test } from 'vitest'
import { migrationSource } from './helpers/migration'

/**
 * Membership became incremental on 20 Sep 2026, because a checkbox set that
 * Saves the whole membership does not survive 100-200 users: two administrators
 * revert each other without warning, and the trail keeps the diff rather than
 * the intent.
 *
 * What the text has to keep true, and what would quietly undo it.
 */
const sql = migrationSource('a_user_group_gains_and_loses_one_member_at_a_time')
const fn = (name: string) => {
  const start = sql.indexOf(`create or replace function public.${name}(`)
  expect(start, `${name} exists`).toBeGreaterThan(-1)
  return sql.slice(start, sql.indexOf('$fn$;', start))
}

describe('the three calls', () => {
  test.each(['add_user_group_member', 'remove_user_group_member', 'add_user_group_members'])(
    '%s is administrators-only and SECURITY INVOKER, so row-level security still decides',
    (name) => {
      const body = fn(name)
      expect(body).toContain('security invoker')
      expect(body).toMatch(
        /if not public\.current_staff_has\('manage_staff'\) then\s+raise exception 'Only an administrator can manage user groups'/,
      )
      expect(body).toMatch(/raise exception 'No such user group'/)
    },
  )

  test.each(['add_user_group_member', 'remove_user_group_member', 'add_user_group_members'])(
    '%s is granted to authenticated, the bug that broke the first release',
    (name) => {
      expect(sql).toMatch(new RegExp(`grant execute on function public\\.${name}\\([^)]*\\) to authenticated;`))
    },
  )

  /* The archived-group rule and "already a member is not an event" both live in
     apply_user_group_membership. A direct insert here would lose both silently. */
  test.each(['add_user_group_member', 'add_user_group_members'])('%s adds only through the shared helper', (name) => {
    const body = fn(name)
    expect(body).toContain('apply_user_group_membership')
    expect(body).not.toContain('insert into public.user_group_members')
  })

  /**
   * Removal is idempotent BECAUSE the permission is checked up front. A
   * non-administrator's delete matches zero rows under RLS, which is
   * indistinguishable from "was not a member" — the silent-zero-row trap. With
   * the check first, zero rows can only mean the second, so two administrators
   * removing the same person at once both succeed.
   */
  test('removal checks permission before deleting, and does not treat zero rows as an error', () => {
    const body = fn('remove_user_group_member')
    expect(body.indexOf('manage_staff')).toBeLessThan(body.indexOf('delete from'))
    expect(body).not.toContain('get diagnostics')
    expect(body).not.toMatch(/not a member/i)
  })
})

describe('the bulk call is additive', () => {
  /* The property that makes it safe to press from a list somebody else is
     editing: it cannot revert work it never saw. */
  test('it never removes anybody', () => {
    expect(fn('add_user_group_members')).not.toContain('delete from')
  })

  test('it refuses an empty list rather than doing nothing quietly', () => {
    expect(fn('add_user_group_members')).toMatch(
      /if cardinality\(v_ids\) = 0 then\s+raise exception 'Choose at least one person'/,
    )
  })

  /* Every id checked before the first write, so a list with one inactive person
     is refused whole rather than half-applied. */
  test('it names an inactive person before anything is written', () => {
    const body = fn('add_user_group_members')
    expect(body).toMatch(
      /su\.status = 'active'\) then\s+raise exception 'Only an active staff member can join a user group'/,
    )
    expect(body.indexOf('Only an active staff member')).toBeLessThan(body.indexOf('apply_user_group_membership'))
  })

  /* So the screen can say "Added 12" when 15 were ticked and three were already
     in. Counting the input instead would be a small lie on every bulk add. */
  test('it returns how many rows it really wrote', () => {
    const body = fn('add_user_group_members')
    expect(body).toContain('returns integer')
    expect(body).toMatch(/return v_after - v_before;/)
  })
})

describe('what the migration refuses to let through', () => {
  test('a definer function, a direct insert, a subtractive bulk call, or a dropped set function', () => {
    expect(sql).toContain("raise exception '% is SECURITY DEFINER and would bypass row-level security', v_fn")
    expect(sql).toContain("raise exception '% inserts directly and would skip the archived-group rule', v_fn")
    expect(sql).toContain("raise exception 'add_user_group_members removes people; it must only add'")
    expect(sql).toContain("raise exception 'set_user_group_members was dropped; the deployed build still calls it'")
  })

  /* The person's side stays set-replacing on purpose — a handful of groups,
     saved atomically with the rest of their Access box. */
  test('it does not touch update_staff_patch', () => {
    expect(sql).not.toContain('create or replace function public.update_staff_patch')
  })
})
