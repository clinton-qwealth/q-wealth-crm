-- A user group gains and loses one member at a time (20 Sep 2026)
--
-- Clinton: "im not sure the check box option is the right method for adding
-- users to a group. If i have 100-200 users, what would ideally be the best way
-- to manage the adding and removing of members?"
--
-- He is right, and the worst of it is not the scrolling.
--
-- ## What set-replacement costs once there are 200 people
--
-- `set_user_group_members(group, staff[])` takes the WHOLE membership and makes
-- the table match it. With five colleagues that is fine. With two hundred, and
-- more than one administrator:
--
--   1. **Lost updates.** Two administrators open the same group; the second to
--      press Save silently reverts everything the first added, because their
--      form was built before those rows existed. Nothing warns anybody.
--   2. **The trail loses the intent.** "Added Jo Smith to Northern" is the event
--      worth keeping. A set-replace leaves only whichever rows happened to
--      differ, with no record of what the administrator meant to do.
--   3. **A membership can be dropped by accident.** The archived-group case had
--      to be special-cased in the UI — a ticked box you must not untick — purely
--      because an absent id means "remove" under set semantics.
--
-- So the group side becomes INCREMENTAL: one call adds one person, one call
-- removes one person, and a third adds several at once WITHOUT touching anybody
-- already there. None of them can revert a change they never saw.
--
-- ## The person's side deliberately stays as it is
--
-- `update_staff_patch`'s `user_group_ids` key remains set-replacing, because the
-- cardinality is the other way round: a person belongs to two or three
-- territories out of a dozen, the whole list fits on screen, and it saves
-- atomically with the rest of their Access box in one call. Same data, two
-- shapes, for two different sizes of problem.
--
-- `set_user_group_members` is KEPT, not dropped: the build in production still
-- calls it, and dropping it here would break the Members box between this
-- migration and the deploy. It has no caller once the new app ships and can go
-- in a later file.

-- ---------------------------------------------------------------------------
-- 1. One person in
-- ---------------------------------------------------------------------------

create or replace function public.add_user_group_member(p_user_group_id uuid, p_staff_id uuid)
returns void
language plpgsql
security invoker
set search_path to ''
as $fn$
begin
  if public.current_staff_id() is null then
    raise exception 'Not an active staff member';
  end if;
  if not public.current_staff_has('manage_staff') then
    raise exception 'Only an administrator can manage user groups';
  end if;
  if not exists (select 1 from public.user_groups ug where ug.id = p_user_group_id) then
    raise exception 'No such user group';
  end if;
  -- apply_user_group_membership() is the one place that decides what "join"
  -- means: it refuses an archived group, and it does nothing at all for somebody
  -- already in, so pressing Add twice is not an error and writes no second row.
  perform public.apply_user_group_membership(array[p_staff_id], array[p_user_group_id]);
end $fn$;
revoke all on function public.add_user_group_member(uuid, uuid) from public, anon;
grant execute on function public.add_user_group_member(uuid, uuid) to authenticated;
comment on function public.add_user_group_member(uuid, uuid) is
  'Put one staff member into one user group. Administrators only; the person must be active and the group must not be archived. Idempotent: adding somebody already in the group changes nothing and writes no audit row. Added 20 Sep 2026, replacing the set-replacing Members box.';

-- ---------------------------------------------------------------------------
-- 2. One person out
-- ---------------------------------------------------------------------------
-- Idempotent on purpose, and the permission is checked UP FRONT rather than
-- inferred from the row count. Those two facts are related: a non-administrator
-- deleting here matches zero rows under row-level security, which is
-- indistinguishable from "they were not a member" — the silent-zero-row trap
-- this schema has been bitten by before. Checking first means a zero row count
-- can only mean the second thing, so it is not an error: two administrators
-- removing the same person at the same time both succeed.

create or replace function public.remove_user_group_member(p_user_group_id uuid, p_staff_id uuid)
returns void
language plpgsql
security invoker
set search_path to ''
as $fn$
begin
  if public.current_staff_id() is null then
    raise exception 'Not an active staff member';
  end if;
  if not public.current_staff_has('manage_staff') then
    raise exception 'Only an administrator can manage user groups';
  end if;
  if not exists (select 1 from public.user_groups ug where ug.id = p_user_group_id) then
    raise exception 'No such user group';
  end if;

  delete from public.user_group_members m
   where m.user_group_id = p_user_group_id and m.staff_id = p_staff_id;
end $fn$;
revoke all on function public.remove_user_group_member(uuid, uuid) from public, anon;
grant execute on function public.remove_user_group_member(uuid, uuid) to authenticated;
comment on function public.remove_user_group_member(uuid, uuid) is
  'Take one staff member out of one user group. Administrators only. Idempotent: removing somebody who is not a member is not an error, so two administrators doing it at once both succeed. An ARCHIVED group can still be left — archiving hides a group from the pickers, it does not freeze it. Added 20 Sep 2026.';

-- ---------------------------------------------------------------------------
-- 3. Several people in at once, without disturbing anybody already there
-- ---------------------------------------------------------------------------
-- For the errand that actually takes the time: carving a hundred people into
-- territories from the Users list. ADDITIVE, never subtractive — it is the
-- difference between this and `set_user_group_members`, and it is the whole
-- reason it is safe to press from a list somebody else may be editing.
--
-- Returns how many rows it actually wrote, so the screen can say "Added 12
-- users" rather than "Added 15" when three of them were already members.

create or replace function public.add_user_group_members(p_user_group_id uuid, p_staff_ids uuid[])
returns integer
language plpgsql
security invoker
set search_path to ''
as $fn$
declare
  v_ids    uuid[];
  v_staff  uuid;
  v_before int;
  v_after  int;
begin
  if public.current_staff_id() is null then
    raise exception 'Not an active staff member';
  end if;
  if not public.current_staff_has('manage_staff') then
    raise exception 'Only an administrator can manage user groups';
  end if;
  if not exists (select 1 from public.user_groups ug where ug.id = p_user_group_id) then
    raise exception 'No such user group';
  end if;

  select coalesce(array_agg(distinct s), '{}') into v_ids
    from unnest(coalesce(p_staff_ids, '{}')) s;
  if cardinality(v_ids) = 0 then
    raise exception 'Choose at least one person';
  end if;

  -- Named before anything is written, so a list containing one inactive person
  -- is refused as a whole with a sentence, rather than half-applied.
  foreach v_staff in array v_ids loop
    if not exists (select 1 from public.staff_users su where su.id = v_staff and su.status = 'active') then
      raise exception 'Only an active staff member can join a user group';
    end if;
  end loop;

  select count(*) into v_before from public.user_group_members m where m.user_group_id = p_user_group_id;
  perform public.apply_user_group_membership(v_ids, array[p_user_group_id]);
  select count(*) into v_after from public.user_group_members m where m.user_group_id = p_user_group_id;
  return v_after - v_before;
end $fn$;
revoke all on function public.add_user_group_members(uuid, uuid[]) from public, anon;
grant execute on function public.add_user_group_members(uuid, uuid[]) to authenticated;
comment on function public.add_user_group_members(uuid, uuid[]) is
  'Put several staff members into one user group in one call, for the Users list''s bulk action. ADDITIVE: it never removes anybody, so it cannot revert another administrator''s work the way a set-replace can. Administrators only; every person must be active and the group must not be archived, checked before anything is written. Returns how many rows were actually added, so somebody already in the group is not counted twice. Added 20 Sep 2026.';

-- ---------------------------------------------------------------------------
-- 4. Prove it, or abort
-- ---------------------------------------------------------------------------

do $$
declare
  v_fn  text;
  v_src text;
begin
  foreach v_fn in array array['add_user_group_member', 'remove_user_group_member', 'add_user_group_members']
  loop
    if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                    where n.nspname = 'public' and p.proname = v_fn) then
      raise exception '% was not created', v_fn;
    end if;
    -- INVOKER, every one of them: row-level security has to evaluate as the
    -- caller, or "administrators only" becomes a comment rather than a rule.
    if (select p.prosecdef from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public' and p.proname = v_fn) then
      raise exception '% is SECURITY DEFINER and would bypass row-level security', v_fn;
    end if;
    -- And each needs the helper grant that the 20 Sep permission bug was about.
    select prosrc into v_src from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = v_fn;
    if v_src not like '%manage_staff%' then
      raise exception '% does not check manage_staff', v_fn;
    end if;
  end loop;

  -- The two that add MUST go through apply_user_group_membership, which is where
  -- "archived groups refuse new members" and "already a member is not an event"
  -- are decided. A direct insert here would quietly lose both.
  foreach v_fn in array array['add_user_group_member', 'add_user_group_members']
  loop
    select prosrc into v_src from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = v_fn;
    if v_src not like '%apply_user_group_membership%' then
      raise exception '% does not go through apply_user_group_membership', v_fn;
    end if;
    if v_src like '%insert into public.user_group_members%' then
      raise exception '% inserts directly and would skip the archived-group rule', v_fn;
    end if;
  end loop;

  -- The bulk one never removes: that is what makes it safe to press from a list.
  select prosrc into v_src from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'add_user_group_members';
  if v_src like '%delete from%' then
    raise exception 'add_user_group_members removes people; it must only add';
  end if;

  -- Callers still exist for the set-replacing one until the app is deployed.
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                  where n.nspname = 'public' and p.proname = 'set_user_group_members') then
    raise exception 'set_user_group_members was dropped; the deployed build still calls it';
  end if;
end $$;
