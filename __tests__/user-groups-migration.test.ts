import { describe, expect, test } from 'vitest'
import { migrationSource } from './helpers/migration'

/**
 * A household may belong to one user group — the migration that turned the
 * empty July `teams` into territories, read from its text.
 *
 * Every assertion here pins the CONDITION and its MESSAGE together, because a
 * message-only match survives `if false then raise …`. And each one is paired
 * with the edit it exists to catch, in the comment beside it.
 */
const sql = migrationSource('a_household_may_belong_to_one_user_group')
const body = (fn: string) => {
  const start = sql.indexOf(`create or replace function public.${fn}(`)
  const end = sql.indexOf('$fn$;', start)
  return sql.slice(start, end)
}

describe('the tables', () => {
  test('the July tables are RENAMED, not recreated beside the old ones', () => {
    expect(sql).toMatch(/alter table public\.teams rename to user_groups;/)
    expect(sql).toMatch(/alter table public\.team_members rename to user_group_members;/)
    expect(sql).not.toMatch(/create table public\.user_groups/)
    expect(sql).not.toMatch(/drop table public\.teams/)
  })

  test('the toggle is off by default and never null', () => {
    expect(sql).toMatch(/alter table public\.staff_users\s+add column limited_to_user_groups boolean not null default false;/)
  })

  /* `on delete set null`, never cascade: removing a territory must never remove
     the households in it. */
  test('a household points at its group nullable, set-null on delete, and indexed', () => {
    expect(sql).toMatch(
      /alter table public\.client_groups\s+add column user_group_id uuid null references public\.user_groups \(id\) on delete set null;/,
    )
    expect(sql).not.toMatch(/user_group_id uuid[^;]*on delete cascade/)
    expect(sql).toContain('create index client_groups_user_group_idx on public.client_groups (user_group_id);')
  })

  test('a user group can be read, made and changed by the right people, and never deleted', () => {
    expect(sql).not.toMatch(/create policy \w+ on public\.user_groups\s+for (all|delete)/)
    expect(sql).not.toMatch(/create policy \w+ on public\.user_group_members\s+for (all|update)/)
    expect(sql).toContain('grant select, insert, update on public.user_groups to authenticated;')
    expect(sql).toContain('grant select, insert, delete on public.user_group_members to authenticated;')
    expect(sql).toMatch(/if v_grants is distinct from 'INSERT,SELECT,UPDATE' then\s+raise exception 'authenticated holds % on user_groups/)
    expect(sql).toMatch(/if v_grants is distinct from 'DELETE,INSERT,SELECT' then\s+raise exception 'authenticated holds % on user_group_members/)
  })

  test('the profile flags are not touched — this is per person', () => {
    expect(sql).not.toMatch(/alter table public\.access_profiles/)
  })
})

describe('who may see a household', () => {
  const fn = body('staff_can_access_group')

  test('keeps the contract: elevated first, not-staff second', () => {
    expect(fn.indexOf('if public.is_elevated_context() then')).toBeGreaterThan(0)
    expect(fn.indexOf('if public.is_elevated_context() then')).toBeLessThan(fn.indexOf('if v_staff is null then'))
    expect(fn).toMatch(/if v_staff is null then\s+return false;/)
  })

  test('the owner always sees their own household', () => {
    expect(fn).toMatch(/if v_owner = v_staff then\s+return true;/)
  })

  /* Membership grants — archived or not. A status check in this arm would make
     archiving a silent revocation, which "archived" does not mean here. */
  test('membership of the household’s group grants, whatever the group’s status', () => {
    const arm = fn.slice(fn.indexOf('-- 2. Membership grants'), fn.indexOf('-- 3. Firm-wide sight'))
    expect(arm).toMatch(/m\.user_group_id = v_user_group and m\.staff_id = v_staff/)
    expect(arm).toMatch(/\)\s+then\s+return true;/)
    expect(arm).not.toMatch(/status/)
  })

  /* The two lines that ARE the decision. Unassigned → as today for everyone;
     assigned → the toggle decides. Inverting the coalesce would limit everyone
     who is NOT limited. */
  test('an unassigned household is visible to every view_all_groups holder; an assigned one only to the unlimited', () => {
    const arm = fn.slice(fn.indexOf('-- 3. Firm-wide sight'), fn.indexOf('-- 4. One-off sharing'))
    expect(arm).toMatch(/if public\.current_staff_has\('view_all_groups'\) then\s+if v_user_group is null then\s+return true;/)
    expect(arm).toMatch(/select su\.limited_to_user_groups into v_limited/)
    expect(arm).toMatch(/if not coalesce\(v_limited, false\) then\s+return true;/)
  })

  test('one-off grants still work, to a person or to one of their groups', () => {
    const arm = fn.slice(fn.indexOf('-- 4. One-off sharing'))
    expect(arm).toMatch(/a\.staff_id = v_staff/)
    expect(arm).toMatch(/a\.user_group_id in \(select m\.user_group_id/)
  })

  /* current_staff_has() answers true for EVERY arm in an elevated context, so
     routing the toggle through it would make the dashboard "limited". */
  test('the toggle is read from the row, never through the permission function', () => {
    expect(sql).not.toMatch(/when 'limited_to_user_groups'/)
    expect(fn).toContain('from public.staff_users su')
  })
})

describe('the patch function', () => {
  const fn = body('update_staff_patch')

  test('accepts both keys and insists the toggle is a real boolean', () => {
    expect(fn).toMatch(/v_keys\s+text\[\] := array\[[^\]]*'limited_to_user_groups', 'user_group_ids'\]/)
    expect(fn).toMatch(
      /jsonb_typeof\(p_patch->'limited_to_user_groups'\) <> 'boolean' then\s+raise exception 'limited_to_user_groups must be true or false'/,
    )
    expect(fn).toMatch(/limited_to_user_groups = case when p_patch \? 'limited_to_user_groups' then v_limited else su\.limited_to_user_groups end/)
  })

  test('the user groups are a list, administrators only, of groups that exist', () => {
    expect(fn).toMatch(/if p_patch \? 'user_group_ids' then\s+if not public\.current_staff_has\('manage_staff'\) then\s+raise exception 'Only an administrator can manage user groups'/)
    expect(fn).toMatch(/jsonb_typeof\(p_patch->'user_group_ids'\) <> 'array' then\s+raise exception 'user_group_ids must be a list'/)
    expect(fn).toMatch(/not exists \(select 1 from public\.user_groups ug where ug\.id = v_group\) then\s+raise exception 'No such user group'/)
  })

  /* A diff, not a churn: remove what is no longer listed, add what is new,
     leave the rest — so an unchanged membership writes no audit row and a
     still-listed archived membership survives. */
  test('the set is applied as a diff', () => {
    expect(fn).toMatch(/delete from public\.user_group_members m\s+where m\.staff_id = p_staff_id\s+and not \(m\.user_group_id = any \(v_groups\)\)/)
    expect(fn).toContain('perform public.apply_user_group_membership(array[p_staff_id], v_groups)')
    const apply = body('apply_user_group_membership')
    expect(apply).toMatch(/if not exists \(select 1 from public\.user_group_members m\s+where m\.staff_id = v_staff and m\.user_group_id = v_group\) then/)
    expect(apply).toMatch(/ug\.status = 'active'\) then\s+raise exception 'That user group is archived'/)
  })
})

describe('managing user groups', () => {
  test('creating one is for administrators, with a trimmed, capped, case-insensitively unique name', () => {
    const fn = body('create_user_group')
    expect(fn).toMatch(/if not public\.current_staff_has\('manage_staff'\) then\s+raise exception 'Only an administrator can manage user groups'/)
    expect(fn).toMatch(/if v_name = '' then\s+raise exception 'Enter a name for the user group'/)
    expect(fn).toMatch(/if length\(v_name\) > 60 then\s+raise exception 'That name is too long'/)
    expect(fn).toMatch(/lower\(ug\.name\) = lower\(v_name\)\) then\s+raise exception 'A user group with that name already exists'/)
    expect(sql).toContain('create unique index user_groups_name_lower_key on public.user_groups (lower(name));')
  })

  test('changing one takes name and status only, and the zero-row update is a refusal', () => {
    const fn = body('update_user_group_patch')
    expect(fn).toMatch(/v_keys\s+text\[\] := array\['name', 'status'\]/)
    expect(fn).toContain("enum_range(null::public.record_status)")
    expect(fn).toMatch(/if v_rows = 0 then\s+raise exception 'Only an administrator can manage user groups'/)
  })

  /* Both on the table (a trigger) AND in the function (a sentence): a direct
     PostgREST insert meets the rule too. */
  test('only an active staff member can join, said by the table and by the function', () => {
    const trg = body('enforce_user_group_member_is_active')
    expect(trg).toMatch(/su\.status = 'active'\) then\s+raise exception 'Only an active staff member can join a user group'/)
    expect(sql).toMatch(/create trigger trg_user_group_members_member_is_active\s+before insert on public\.user_group_members/)
    const fn = body('set_user_group_members')
    expect(fn).toMatch(/su\.status = 'active'\) then\s+raise exception 'Only an active staff member can join a user group'/)
    expect(fn).toMatch(/delete from public\.user_group_members m\s+where m\.user_group_id = p_user_group_id\s+and not \(m\.staff_id = any \(v_ids\)\)/)
  })

  test('a household cannot be newly put in an archived group, and a filtered update is a refusal', () => {
    const fn = body('set_client_group_user_group')
    expect(fn).toMatch(/ug\.status = 'active'\) then\s+raise exception 'No such user group, or it has been archived'/)
    expect(fn).toMatch(/if v_rows = 0 then\s+raise exception 'You do not have permission to change this group'/)
    const trg = body('enforce_user_group_is_active')
    expect(trg).toMatch(/ug\.status = 'active'\) then\s+raise exception 'That user group is archived'/)
    expect(sql).toMatch(/before insert or update of user_group_id on public\.client_groups/)
  })
})

describe('the trail and the view', () => {
  test('a membership is audited under its user group, which the trail can name', () => {
    expect(sql).toMatch(/create trigger trg_user_group_members_audit\s+after insert or update or delete on public\.user_group_members\s+for each row execute function public\.record_audit\('user_group_id', ''\)/)
    expect(sql).toContain("when 'user_group_members'       then 'user_groups'")
    expect(sql).toContain("when 'user_groups'                  then p_data->>'name'")
    expect(sql, 'the pre-split staff payloads must still resolve').toContain("coalesce(p_data->>'full_name',")
  })

  /* `create or replace view` may only append, and every `select *` reader
     depends on the two new columns coming LAST. */
  test('group_summary gains its two columns at the end, without a drop', () => {
    expect(sql).not.toMatch(/drop view/)
    const view = sql.slice(sql.indexOf('create or replace view public.group_summary'), sql.indexOf('comment on view public.group_summary'))
    expect(view).toMatch(/\) filter \(where m\.end_date is null\) as members,\s+g\.user_group_id,\s+ug\.name as user_group_name\s+from public\.client_groups g/)
    expect(view).toContain('left join public.user_groups ug on ug.id = g.user_group_id')
  })
})

describe('the closing block', () => {
  /* The day-one guarantee, asserted rather than assumed. */
  test('aborts if anyone is limited or anything is assigned on arrival', () => {
    expect(sql).toMatch(/select count\(\*\) into v_n from public\.staff_users where limited_to_user_groups;\s+if v_n <> 0 then\s+raise exception '% staff member\(s\) are limited on arrival — that would change who sees what on day one'/)
    expect(sql).toMatch(/select count\(\*\) into v_n from public\.client_groups where user_group_id is not null;\s+if v_n <> 0 then\s+raise exception '% household\(s\) are assigned on arrival — that would change who sees what on day one'/)
  })

  test('aborts if any function still speaks the July vocabulary', () => {
    expect(sql).toMatch(/p\.prosrc ~ '\\mteam_members\\M\|\\mteams\\M\|\\mteam_id\\M'\) then\s+raise exception 'a function still names teams, team_members or team_id'/)
  })
})
