import { describe, expect, test } from 'vitest'
import { migrationSource } from './helpers/migration'

/**
 * A household may belong to several user groups — read from the migration text.
 *
 * Every assertion pins the CONDITION and its MESSAGE together, because a
 * message-only match survives `if false then raise …`. Each is paired with the
 * edit it exists to catch, in the comment beside it.
 */
const sql = migrationSource('a_household_may_belong_to_several_user_groups')
const body = (fn: string) => {
  const start = sql.indexOf(`create or replace function public.${fn}(`)
  const end = sql.indexOf('$fn$;', start)
  return sql.slice(start, end)
}

describe('the link table', () => {
  test('it is a link, keyed by the pair, and nothing is dropped', () => {
    expect(sql).toMatch(/create table public\.client_group_user_groups/)
    expect(sql).toMatch(/primary key \(group_id, user_group_id\)/)
    /* ADDITIVE: the deployed build still selects client_groups.user_group_id by
       name, and dropping it here would 400 the group page until Vercel caught
       up. Mutation: add the drop → this fails, and so does the closing block. */
    expect(sql, 'the column the deployed build reads must survive').not.toMatch(
      /alter table public\.client_groups\s+drop column user_group_id/,
    )
    expect(sql).toMatch(/client_groups\.user_group_id must survive this migration/)
  })

  test('the backfill carries every household the column named', () => {
    expect(sql).toMatch(/insert into public\.client_group_user_groups \(group_id, user_group_id\)[\s\S]*?where g\.user_group_id is not null/)
    expect(sql).toMatch(/The backfill missed a household/)
  })

  /* Reading a link is reading a fact about a household, so the household's own
     access decides. Mutation: `is_active_staff()` → this fails. */
  test('select is scoped to the household, not to being staff', () => {
    expect(sql).toMatch(/for select using \(public\.staff_can_access_group\(group_id\)\)/)
  })

  test('writing one needs access AND manage_groups, and there is no update', () => {
    expect(sql).toMatch(/for insert with check \(\s*public\.staff_can_access_group\(group_id\) and public\.current_staff_has\('manage_groups'\)/)
    expect(sql).toMatch(/for delete using \(\s*public\.staff_can_access_group\(group_id\) and public\.current_staff_has\('manage_groups'\)/)
    expect(sql).not.toMatch(/for update on public\.client_group_user_groups/)
    expect(sql).toMatch(/must carry no update policy/)
  })

  test('the grants are exactly what the policies justify', () => {
    expect(sql).toMatch(/revoke all on public\.client_group_user_groups from public, anon, authenticated;/)
    expect(sql).toMatch(/grant select, insert, delete on public\.client_group_user_groups to authenticated;/)
  })

  /* A NEW link into an archived territory is refused; one already there is not
     touched. Mutation: drop the `status = 'active'` test → this fails. */
  test('an archived territory cannot be newly chosen, and says so', () => {
    const fn = body('enforce_client_group_user_group_is_active')
    expect(fn).toMatch(/where ug\.id = new\.user_group_id and ug\.status = 'active'/)
    expect(fn).toMatch(/raise exception 'That user group is archived'/)
    expect(sql).toMatch(/before insert on public\.client_group_user_groups/)
  })

  /* Keyed by the HOUSEHOLD, so the trail reads under a name somebody knows. */
  test('the trail is keyed by the household and resolves to it', () => {
    expect(sql).toMatch(/execute function public\.record_audit\('group_id', ''\)/)
    expect(sql).toMatch(/when 'client_group_user_groups'\s+then 'client_groups'/)
  })
})

describe('who may see a household', () => {
  const fn = body('staff_can_access_group')

  test('elevated first, then not-active-staff — the contract is unchanged', () => {
    expect(fn.indexOf('is_elevated_context')).toBeLessThan(fn.indexOf('current_staff_id'))
    expect(fn).toMatch(/if public\.is_elevated_context\(\) then\s+return true;/)
    expect(fn).toMatch(/if v_staff is null then\s+return false;/)
  })

  test('the owner still sees their own household', () => {
    expect(fn).toMatch(/if v_owner = v_staff then\s+return true;/)
  })

  /* MEMBERSHIP GRANTS, and ANY shared territory is enough — the whole point of
     the change. Mutation: require all of them, or read a single column → fails. */
  test('sharing ANY of the household’s territories grants', () => {
    expect(fn).toMatch(/from public\.client_group_user_groups l\s+join public\.user_group_members m on m\.user_group_id = l\.user_group_id\s+where l\.group_id = p_group_id and m\.staff_id = v_staff/)
    expect(fn, 'membership is not conditioned on the group still being active').not.toMatch(
      /user_group_members[\s\S]*?status = 'active'/,
    )
  })

  /* A household in NO territory behaves exactly as it always did. Mutation:
     drop this arm → a limited person stops seeing unassigned households. */
  test('a household in no territory is visible to every view_all_groups holder', () => {
    expect(fn).toMatch(/select exists \(select 1 from public\.client_group_user_groups l where l\.group_id = p_group_id\)\s+into v_any_group;/)
    expect(fn).toMatch(/if not v_any_group then\s+return true;/)
  })

  /* THE TOGGLE RESTRICTS. Mutation: drop the `not` → the rule inverts. */
  test('firm-wide sight survives unless the person is limited', () => {
    expect(fn).toMatch(/if not coalesce\(v_limited, false\) then\s+return true;/)
  })

  test('one-off sharing is still the last word', () => {
    expect(fn).toMatch(/from public\.client_group_access a/)
  })

  test('it no longer reads the single column', () => {
    expect(fn).not.toMatch(/g\.user_group_id/)
  })
})

describe('group_summary', () => {
  /* REPLACED, not dropped: a drop would take workflow_posts_summary and the two
     record feeds with it. Mutation: `drop view` → this fails. */
  test('it is replaced rather than dropped, so its dependants survive', () => {
    expect(sql).toMatch(/create or replace view public\.group_summary/)
    expect(sql).not.toMatch(/drop view [^\n]*group_summary/)
    expect(sql).toMatch(/A view that depends on group_summary did not survive/)
  })

  /* The arrays go LAST: `create or replace view` may only append. */
  test('the two arrays are appended after the transitional columns', () => {
    const cols = sql.slice(sql.indexOf('create or replace view public.group_summary'))
    expect(cols.indexOf('as user_group_ids')).toBeGreaterThan(cols.indexOf('as user_group_name'))
    expect(cols.indexOf('as user_group_names')).toBeGreaterThan(cols.indexOf('as user_group_ids'))
    expect(sql).toMatch(/group_summary came back with the wrong columns or the wrong order/)
  })

  /* Correlated subqueries, NOT a join: joining the link table would multiply the
     rows and make member_count wrong. Mutation: join it → member_count doubles. */
  test('the set is read without joining, so member_count stays right', () => {
    const view = sql.slice(sql.indexOf('create or replace view public.group_summary'), sql.indexOf('comment on view public.group_summary'))
    expect(view).not.toMatch(/left join public\.client_group_user_groups/)
    expect(view).toMatch(/coalesce\(\(select array_agg\(l\.user_group_id order by u\.name\)/)
  })
})

describe('setting the set', () => {
  const fn = body('set_client_group_user_groups')

  test('permission is access AND manage_groups, with a sentence', () => {
    expect(fn).toMatch(/if not public\.staff_can_access_group\(p_group_id\) or not public\.current_staff_has\('manage_groups'\) then\s+raise exception 'You do not have permission to change this group'/)
  })

  /* SET-REPLACING: what is not listed is removed. Mutation: drop the delete →
     the function becomes additive and nothing can ever be taken out. */
  test('it replaces the set rather than only adding to it', () => {
    expect(fn).toMatch(/delete from public\.client_group_user_groups l\s+where l\.group_id = p_group_id\s+and not \(l\.user_group_id = any \(v_ids\)\)/)
  })

  test('an unknown territory is refused before anything is written', () => {
    expect(fn).toMatch(/raise exception 'No such user group'/)
  })

  /* The bridge, and the reason it exists. Mutation: delete it → the deployed
     build writes a column nothing reads and its screen goes blank. */
  test('the transitional column is kept in step for the deployed build', () => {
    expect(fn).toMatch(/update public\.client_groups g\s+set user_group_id = v_first/)
    expect(body('set_client_group_user_group')).toMatch(/perform public\.set_client_group_user_groups\(/)
  })
})

describe('nothing changes for anybody on day one', () => {
  test('both counts abort the migration rather than reporting', () => {
    expect(sql).toMatch(/if \(select count\(\*\) from public\.client_group_user_groups\) <> 0 then\s+raise exception 'A household is already in a user group — this migration would change who sees what on day one'/)
    expect(sql).toMatch(/if \(select count\(\*\) from public\.staff_users where limited_to_user_groups\) <> 0 then\s+raise exception 'Somebody is already limited — this migration would change who sees what on day one'/)
  })
})
