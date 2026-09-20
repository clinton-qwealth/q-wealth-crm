import { describe, expect, test } from 'vitest'
import { migrationSource } from './helpers/migration'

/**
 * A staff member's title and date of birth — the shape of the migration that
 * added them, read from its text.
 *
 * The one decision this file guards: **the date of birth is NOT a column on
 * `staff_users`.** That table is readable by every active staff member, on
 * purpose, and a birthday on it would be a birthday every colleague could pull
 * through the API whatever the screens show. It lives in a side table only the
 * person and administrators may read. Moving it back onto the main table would
 * be a one-line "simplification" that quietly widens who can see it — so the
 * split, the policies and the grants are asserted here.
 */
const sql = migrationSource('a_staff_member_has_a_title_and_a_date_of_birth')

describe('the title', () => {
  test('is a nullable column on the record, like a client’s', () => {
    expect(sql).toMatch(/alter table public\.staff_users\s+add column title text;/)
    expect(sql).not.toMatch(/add column title text not null/)
  })
})

describe('the date of birth', () => {
  test('is in its own table, keyed by the person, and gone when they are', () => {
    expect(sql).toMatch(/create table public\.staff_private_details \(\s*staff_id\s+uuid primary key references public\.staff_users\(id\) on delete cascade/)
    expect(sql).toMatch(/date_of_birth\s+date,/)
    expect(sql, 'the birthday is not a column on the readable-by-everyone table').not.toMatch(
      /alter table public\.staff_users\s+add column date_of_birth/,
    )
  })

  test('is readable by the person and administrators, and written by administrators alone', () => {
    expect(sql).toContain('alter table public.staff_private_details enable row level security;')
    expect(sql).toMatch(/for select to authenticated\s+using \(staff_id = public\.current_staff_id\(\) or public\.current_staff_has\('manage_staff'\)\)/)
    expect(sql).toMatch(/for insert to authenticated\s+with check \(public\.current_staff_has\('manage_staff'\)\)/)
    expect(sql).toMatch(/for update to authenticated\s+using \(public\.current_staff_has\('manage_staff'\)\)/)
    expect(sql, 'nothing deletes a row; the cascade does').not.toMatch(/for delete/)
  })

  /* A new table on Supabase arrives with the full default set for
     authenticated. The migration takes it back to what the policies justify,
     and asserts the result rather than assuming it. */
  test('authenticated holds exactly select, insert and update; anon and public nothing', () => {
    expect(sql).toContain('revoke all on public.staff_private_details from public, anon, authenticated;')
    expect(sql).toContain('grant select, insert, update on public.staff_private_details to authenticated;')
    expect(sql).toContain("if v_grants is distinct from 'INSERT,SELECT,UPDATE'")
  })

  test('is audited under the person, and the trail names them', () => {
    expect(sql).toMatch(/on public\.staff_private_details\s+for each row execute function public\.record_audit\('staff_id', ''\)/)
    expect(sql).toContain("when 'staff_private_details'    then 'staff_users'")
  })

  test('the patch function refuses a future or an impossible date, and a blank clears', () => {
    /* The CONDITION and the sentence together. A message left in place behind
       `if false` reads as a guard and is not one — that mutation survived a
       message-only assertion. */
    expect(sql).toMatch(/if v_dob > current_date then\s+raise exception 'A date of birth cannot be in the future'/)
    expect(sql).toMatch(/if v_dob < current_date - interval '120 years' then\s+raise exception 'That date of birth is more than 120 years ago'/)
    expect(sql).toMatch(/or btrim\(p_patch->>'date_of_birth'\) = '' then\s+v_dob := null;/)
    /* The shape is checked BEFORE the cast. `::date` alone accepts '01/06/1980'
       and lands it on whichever of 6 January or 1 June the server's DateStyle
       prefers — a probe on the branch caught exactly that. */
    expect(sql).toMatch(/!~ '\^\\d\{4\}-\\d\{2\}-\\d\{2\}\$' then\s+raise exception 'Enter the date of birth as a date'/)
    expect(sql).toMatch(/v_keys\s+text\[\] := array\[[^\]]*'title', 'date_of_birth'\]/)
  })
})
