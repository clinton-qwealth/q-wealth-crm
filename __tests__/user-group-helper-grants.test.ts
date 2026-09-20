import { describe, expect, test } from 'vitest'
import { migrationSource } from './helpers/migration'

/**
 * The fix for `permission denied for function user_group_name`, and the rule it
 * teaches: **a SECURITY INVOKER function's caller needs EXECUTE on everything it
 * calls.**
 *
 * The territories migration revoked EXECUTE on both little helpers and never
 * granted it back, so creating a user group, renaming one, setting its members
 * and saving a person's groups all died — while every REFUSAL path kept working,
 * because each raises before it reaches a helper. That is exactly why the branch
 * probe passed and the first button press failed.
 *
 * So this file pins the two grants, and pins them together with the reason they
 * are safe: both helpers must stay SECURITY INVOKER. As DEFINER the same grant
 * would hand every caller the owner's rights over `user_group_members`.
 */
const fix = migrationSource('a_user_group_can_actually_be_created')
const feature = migrationSource('a_household_may_belong_to_one_user_group')

describe('the user-group helpers are callable by the people who call them', () => {
  test('both are granted to authenticated', () => {
    expect(fix).toContain('grant execute on function public.user_group_name(text) to authenticated;')
    expect(fix).toContain('grant execute on function public.apply_user_group_membership(uuid[], uuid[]) to authenticated;')
  })

  test('and the migration aborts if either grant did not take', () => {
    expect(fix).toMatch(
      /if not has_function_privilege\('authenticated', 'public\.user_group_name\(text\)', 'EXECUTE'\) then\s+raise exception 'authenticated still cannot execute user_group_name'/,
    )
    expect(fix).toMatch(
      /if not has_function_privilege\('authenticated', 'public\.apply_user_group_membership\(uuid\[\], uuid\[\]\)', 'EXECUTE'\) then\s+raise exception 'authenticated still cannot execute apply_user_group_membership'/,
    )
  })

  /* The grant is only safe while RLS still evaluates as the caller. */
  test('it refuses to leave either helper as SECURITY DEFINER', () => {
    expect(fix).toMatch(
      /bool_or\(p\.prosecdef\)[\s\S]*?then\s+raise exception 'a user-group helper is SECURITY DEFINER; the grant would bypass row-level security'/,
    )
    expect(feature).toMatch(/create or replace function public\.user_group_name\(p_raw text\)[\s\S]*?security invoker|language sql\s+immutable/)
    expect(feature).toContain('create or replace function public.apply_user_group_membership(')
  })

  /* The four callers that broke. Each is INVOKER on purpose, so each depends on
     the grants above; a test naming them keeps that link visible. */
  test('the callers that depend on the grants are all SECURITY INVOKER', () => {
    for (const fn of ['create_user_group', 'update_user_group_patch', 'set_user_group_members', 'update_staff_patch']) {
      const start = feature.indexOf(`create or replace function public.${fn}(`)
      expect(start, `${fn} is defined`).toBeGreaterThan(-1)
      expect(feature.slice(start, feature.indexOf('$fn$', start))).toContain('security invoker')
    }
  })
})
