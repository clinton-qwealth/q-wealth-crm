-- A household may belong to one user group (20 Sep 2026)
--
-- Clinton asked for groups OF USERS — territories — so that "we may have
-- different territories for Q Wealth and would like to group users within those
-- territories and limit what they can see." Decided with him the same day:
--
--   * a staff member belongs to ANY NUMBER of user groups;
--   * a household (client_groups) belongs to AT MOST ONE;
--   * whether a person is limited is decided PER PERSON, by a toggle on their
--     record, whatever their access profile — the shape verify_identity took on
--     the same morning;
--   * a household in no user group is visible to everyone exactly as it is
--     today; the toggle only hides households that belong to some OTHER group;
--   * people with no household are unchanged (recorded as a gap, below);
--   * user groups are managed by administrators (manage_staff).
--
-- THE RULE, IN ONE SENTENCE: **membership grants, the toggle restricts.** Being
-- in a user group always adds that group's households to what you can see.
-- Ticking the box takes away the firm-wide sight your profile would otherwise
-- give — and only over households that have been assigned somewhere.
--
-- ## Called "user groups" on purpose
--
-- Clinton's word was "groups". In this schema a group is already a client
-- household — `client_groups`, the /groups route, "Group profile" on screen —
-- so these are "user groups" everywhere, in the schema and on screen, so the
-- two can never be confused in a sentence.
--
-- ## What already existed, and why it is renamed rather than reused
--
-- `teams`, `team_members` and a `team_id` on `client_group_access` were created
-- on 5 July as a named bag of staff a grant could point at. They were never
-- driven: zero rows, zero audit rows, no write function, no screen, no app or
-- MCP code naming them. They are exactly the shape a user group needs, so they
-- are RENAMED here — an empty table costs nothing to rename and a second table
-- meaning the same thing would be the confusion the naming rule exists to avoid.
--
-- ## Day one changes nothing, and this file proves it
--
-- The toggle defaults to false with no backfill; `user_group_id` is null on
-- every household with no backfill. With both null, the new access function
-- reduces to the old one line for line: owner, firm-wide sight, one-off grant.
-- The closing block ABORTS the migration if either count is non-zero.
--
-- ## The gap, written down
--
-- `staff_can_access_party` is untouched. It has its own `view_all_groups`
-- shortcut and lets everyone see a person who is in no household. So a LIMITED
-- person can still reach an assigned household's PEOPLE directly — search, the
-- MCP's get_client_profile, their notes — even though the household itself is
-- hidden. Territories govern households and what hangs off them; people with
-- no household have no owner to govern them yet. Fix when they do.
--
-- Also still stored and never checked: `client_group_access.access_level`.
--
-- DEPLOY ORDER: this migration BEFORE the app that reads the new columns. It is
-- safe against the deployed app: nothing deployed names the renamed tables, and
-- `group_summary` only gains two trailing columns.

-- ---------------------------------------------------------------------------
-- 1. Rename the three July objects and everything hanging off them
-- ---------------------------------------------------------------------------

alter table public.teams rename to user_groups;
alter table public.team_members rename to user_group_members;
alter table public.user_group_members rename column team_id to user_group_id;
alter table public.client_group_access rename column team_id to user_group_id;

alter table public.user_groups rename constraint teams_pkey to user_groups_pkey;
-- Replaced below by a case-insensitive rule: "Sydney" and "sydney" are one group.
alter table public.user_groups drop constraint teams_name_key;
alter table public.user_group_members rename constraint team_members_pkey to user_group_members_pkey;
alter table public.user_group_members rename constraint team_members_team_id_fkey to user_group_members_user_group_id_fkey;
alter table public.user_group_members rename constraint team_members_staff_id_fkey to user_group_members_staff_id_fkey;
alter table public.user_group_members rename constraint team_members_team_id_staff_id_key to user_group_members_user_group_id_staff_id_key;
alter table public.client_group_access rename constraint client_group_access_team_id_fkey to client_group_access_user_group_id_fkey;
alter index public.client_group_access_team_unique rename to client_group_access_user_group_unique;
-- client_group_access_one_grantee is a CHECK over the two grantee columns by
-- position; its text follows the column rename. The name stays.

create unique index user_groups_name_lower_key on public.user_groups (lower(name));
-- The access function asks "which groups is THIS person in" on every row it
-- judges; the July unique index leads with the group, not the person.
create index user_group_members_staff_idx on public.user_group_members (staff_id);

alter trigger trg_teams_updated_at on public.user_groups rename to trg_user_groups_updated_at;
alter trigger trg_teams_audit on public.user_groups rename to trg_user_groups_audit;

-- The membership trail is keyed by the USER GROUP, not by the row's own id:
-- audit_label_table() below maps this table to user_groups, so the trail reads
-- "Added · Sydney" rather than a uuid nobody has a name for — the same move
-- staff_private_details made for the person.
drop trigger trg_team_members_audit on public.user_group_members;
create trigger trg_user_group_members_audit
  after insert or update or delete on public.user_group_members
  for each row execute function public.record_audit('user_group_id', '');

comment on table public.user_groups is
  'Groups OF STAFF — territories. Called "user groups" everywhere so they never read as client groups. A staff member belongs to many; a household (client_groups.user_group_id) to at most one. Membership grants sight of the group''s households; staff_users.limited_to_user_groups restricts a person to them. Archived, never deleted: an archived group leaves the pickers but keeps its members and households until changed. Renamed from teams on 20 Sep 2026 (0 rows).';
comment on table public.user_group_members is
  'Which staff belong to which user group. Insert and delete only, by administrators; a member must be active to join, and one who later goes inactive needs no cleanup because current_staff_id() is null for them. Audited under the user group. Renamed from team_members on 20 Sep 2026 (0 rows).';
comment on column public.client_group_access.user_group_id is
  'A one-off grant of this household to every member of a user group. Renamed from team_id on 20 Sep 2026.';

-- Policies: dropped and recreated rather than renamed, because the shape changes.
-- The July "for all" policies allowed DELETE; a user group is archived, never
-- deleted, and a membership row is created or removed, never edited. Those are
-- database facts now, not screen conventions.
drop policy staff_read_teams on public.user_groups;
drop policy admin_write_teams on public.user_groups;
drop policy staff_read_team_members on public.user_group_members;
drop policy admin_write_team_members on public.user_group_members;

create policy staff_read_user_groups on public.user_groups
  for select to authenticated using (public.is_active_staff());
create policy admin_insert_user_groups on public.user_groups
  for insert to authenticated with check (public.current_staff_has('manage_staff'));
create policy admin_update_user_groups on public.user_groups
  for update to authenticated
  using (public.current_staff_has('manage_staff'))
  with check (public.current_staff_has('manage_staff'));
-- No delete policy, no delete grant.

create policy staff_read_user_group_members on public.user_group_members
  for select to authenticated using (public.is_active_staff());
create policy admin_insert_user_group_members on public.user_group_members
  for insert to authenticated with check (public.current_staff_has('manage_staff'));
create policy admin_delete_user_group_members on public.user_group_members
  for delete to authenticated using (public.current_staff_has('manage_staff'));
-- No update policy: a membership is a fact that exists or does not.

revoke all on public.user_groups from public, anon, authenticated;
grant select, insert, update on public.user_groups to authenticated;
revoke all on public.user_group_members from public, anon, authenticated;
grant select, insert, delete on public.user_group_members to authenticated;

-- ---------------------------------------------------------------------------
-- 2. The household's user group
-- ---------------------------------------------------------------------------

alter table public.client_groups
  add column user_group_id uuid null references public.user_groups (id) on delete set null;
create index client_groups_user_group_idx on public.client_groups (user_group_id);

comment on column public.client_groups.user_group_id is
  'The one user group (territory) this household belongs to, or null. Null means the household behaves as it always has for everyone — the limited_to_user_groups toggle ignores it. Set through set_client_group_user_group(), governed by scoped_update_client_groups (access + manage_groups). An archived group cannot be newly assigned (trigger); an existing assignment survives archiving. Added 20 Sep 2026.';

-- "The RLS policy says who; the trigger says what." A direct PostgREST update
-- meets the same rule as the function.
create or replace function public.enforce_user_group_is_active()
returns trigger
language plpgsql
security definer
set search_path to ''
as $fn$
begin
  if new.user_group_id is not null
     and (tg_op = 'INSERT' or new.user_group_id is distinct from old.user_group_id)
     and not exists (select 1 from public.user_groups ug
                      where ug.id = new.user_group_id and ug.status = 'active') then
    raise exception 'That user group is archived';
  end if;
  return new;
end $fn$;
revoke all on function public.enforce_user_group_is_active() from public, anon, authenticated;

create trigger trg_client_groups_user_group_is_active
  before insert or update of user_group_id on public.client_groups
  for each row execute function public.enforce_user_group_is_active();

-- ---------------------------------------------------------------------------
-- 3. The person's toggle
-- ---------------------------------------------------------------------------
-- No backfill, so no `set constraints all immediate` is needed here: that line
-- in the verify_identity migration existed because a backfill UPDATE had queued
-- deferred trigger events ahead of the ALTER. Nothing has written to
-- staff_users in this transaction.

alter table public.staff_users
  add column limited_to_user_groups boolean not null default false;

comment on column public.staff_users.limited_to_user_groups is
  'When true, this person''s firm-wide sight (their profile''s view_all_groups) does not reach a household that has been assigned to a user group they are not a member of. Unassigned households, ownership, one-off grants and membership are all unaffected — membership grants, this restricts. Default false: nobody is limited by being approved. Set by an administrator through update_staff_patch(). Read directly by staff_can_access_group(), NOT through current_staff_has(), which answers true for every permission in an elevated context and would make the dashboard "limited". Added 20 Sep 2026.';

-- ---------------------------------------------------------------------------
-- 4. Who may see a household
-- ---------------------------------------------------------------------------
-- The contract of the July function is kept exactly: elevated context first
-- (true), then not-an-active-staff-member (false). Then, in order:
--
--   1. the owner always sees their own household;
--   2. MEMBERSHIP GRANTS — a member of the household's user group sees it,
--      whatever their profile, and whether or not the group has since been
--      archived ("archived" in this schema means "out of the pickers", not
--      "revoked"; revoking is an explicit, audited removal);
--   3. firm-wide sight from the profile — but a LIMITED person's does not reach
--      a household assigned to a group they are not in. An unassigned household
--      behaves exactly as before for everyone;
--   4. one-off sharing: a grant to the person or to a group they belong to.
--
-- With every user_group_id null (day one), step 2 never fires and step 3 is the
-- old `view_all_groups → true`. Nothing changes for anyone.

create or replace function public.staff_can_access_group(p_group_id uuid)
returns boolean
language plpgsql
security definer
stable
set search_path = ''
as $fn$
declare
  v_staff      uuid;
  v_owner      uuid;
  v_user_group uuid;
  v_limited    boolean;
begin
  if public.is_elevated_context() then
    return true;
  end if;
  v_staff := public.current_staff_id();
  if v_staff is null then
    return false;
  end if;

  select g.owner_staff_id, g.user_group_id
    into v_owner, v_user_group
    from public.client_groups g
   where g.id = p_group_id;

  -- 1. The owner always sees their own household.
  if v_owner = v_staff then
    return true;
  end if;

  -- 2. Membership grants, archived or not.
  if v_user_group is not null and exists (
    select 1 from public.user_group_members m
     where m.user_group_id = v_user_group and m.staff_id = v_staff
  ) then
    return true;
  end if;

  -- 3. Firm-wide sight, unless limited AND the household has been assigned.
  if public.current_staff_has('view_all_groups') then
    if v_user_group is null then
      return true;
    end if;
    select su.limited_to_user_groups into v_limited
      from public.staff_users su
     where su.id = v_staff;
    if not coalesce(v_limited, false) then
      return true;
    end if;
  end if;

  -- 4. One-off sharing.
  return exists (
    select 1 from public.client_group_access a
     where a.group_id = p_group_id
       and (a.staff_id = v_staff
            or a.user_group_id in (select m.user_group_id
                                     from public.user_group_members m
                                    where m.staff_id = v_staff))
  );
end $fn$;
revoke all on function public.staff_can_access_group(uuid) from public, anon;
grant execute on function public.staff_can_access_group(uuid) to authenticated, service_role;

comment on function public.staff_can_access_group(uuid) is
  'Whether the caller may see a household — the one decision every group-scoped policy derives from. Owner → yes. Member of the household''s user group → yes (membership grants, archived or not). Profile view_all_groups → yes, unless the person is limited_to_user_groups AND the household is assigned to a group they are not in; an unassigned household is visible to every view_all_groups holder. A grant to the person or to one of their user groups → yes. Elevated context → yes; not active staff → no. Rewritten 20 Sep 2026 for user groups.';

-- ---------------------------------------------------------------------------
-- 5. Managing user groups: administrators, with sentences
-- ---------------------------------------------------------------------------
-- All SECURITY INVOKER: RLS is the gate. The up-front manage_staff check is so
-- a non-administrator reads a sentence rather than a zero-row update that
-- claims success — the lesson of set_group_primary_contact.

create or replace function public.user_group_name(p_raw text)
returns text
language sql
immutable
set search_path to ''
as $fn$
  select btrim(regexp_replace(coalesce(p_raw, ''), '\s+', ' ', 'g'))
$fn$;
revoke all on function public.user_group_name(text) from public, anon, authenticated;
comment on function public.user_group_name(text) is
  'A user group name as stored: whitespace collapsed and trimmed. Shared by create_user_group() and update_user_group_patch() so the two cannot disagree.';

create or replace function public.create_user_group(p_name text)
returns uuid
language plpgsql
security invoker
set search_path to ''
as $fn$
declare
  v_name text;
  v_id   uuid;
begin
  if public.current_staff_id() is null then
    raise exception 'Not an active staff member';
  end if;
  if not public.current_staff_has('manage_staff') then
    raise exception 'Only an administrator can manage user groups';
  end if;
  v_name := public.user_group_name(p_name);
  if v_name = '' then
    raise exception 'Enter a name for the user group';
  end if;
  if length(v_name) > 60 then
    raise exception 'That name is too long';
  end if;
  if exists (select 1 from public.user_groups ug where lower(ug.name) = lower(v_name)) then
    raise exception 'A user group with that name already exists';
  end if;
  insert into public.user_groups (name) values (v_name) returning id into v_id;
  return v_id;
end $fn$;
revoke all on function public.create_user_group(text) from public, anon;
grant execute on function public.create_user_group(text) to authenticated;
comment on function public.create_user_group(text) is
  'Create a user group (territory). Administrators only. The name is trimmed, capped at 60 characters and unique regardless of case. Returns the new id. Added 20 Sep 2026.';

create or replace function public.update_user_group_patch(p_user_group_id uuid, p_patch jsonb)
returns void
language plpgsql
security invoker
set search_path to ''
as $fn$
declare
  v_keys   text[] := array['name', 'status'];
  v_key    text;
  v_name   text;
  v_status text;
  v_rows   int;
begin
  if public.current_staff_id() is null then
    raise exception 'Not an active staff member';
  end if;
  if not public.current_staff_has('manage_staff') then
    raise exception 'Only an administrator can manage user groups';
  end if;
  if p_patch is null or jsonb_typeof(p_patch) <> 'object' or p_patch = '{}'::jsonb then
    raise exception 'Nothing to change';
  end if;
  for v_key in select jsonb_object_keys(p_patch) loop
    if not (v_key = any (v_keys)) then
      raise exception 'Unknown field in patch: %', v_key;
    end if;
  end loop;
  if not exists (select 1 from public.user_groups ug where ug.id = p_user_group_id) then
    raise exception 'No such user group';
  end if;

  if p_patch ? 'name' then
    v_name := public.user_group_name(p_patch->>'name');
    if v_name = '' then
      raise exception 'Enter a name for the user group';
    end if;
    if length(v_name) > 60 then
      raise exception 'That name is too long';
    end if;
    if exists (select 1 from public.user_groups ug
                where lower(ug.name) = lower(v_name) and ug.id <> p_user_group_id) then
      raise exception 'A user group with that name already exists';
    end if;
  end if;

  if p_patch ? 'status' then
    v_status := p_patch->>'status';
    if v_status is null or not (v_status = any (enum_range(null::public.record_status)::text[])) then
      raise exception 'Unknown status: %', coalesce(v_status, 'null');
    end if;
  end if;

  -- Archiving with members or households still attached is allowed: they keep
  -- it (see staff_can_access_group step 2) until somebody changes them, and
  -- reactivating puts the group straight back in the pickers.
  update public.user_groups ug
     set name   = coalesce(v_name, ug.name),
         status = case when p_patch ? 'status' then v_status::public.record_status else ug.status end
   where ug.id = p_user_group_id;
  get diagnostics v_rows = row_count;
  if v_rows = 0 then
    raise exception 'Only an administrator can manage user groups';
  end if;
end $fn$;
revoke all on function public.update_user_group_patch(uuid, jsonb) from public, anon;
grant execute on function public.update_user_group_patch(uuid, jsonb) to authenticated;
comment on function public.update_user_group_patch(uuid, jsonb) is
  'Rename or archive/reactivate a user group, by key presence: name, status. Administrators only. There is no delete — archiving removes the group from the pickers and keeps its members and households. Added 20 Sep 2026.';

-- A member must be active to join. On the table, so a direct insert meets the
-- same rule the two functions state up front.
create or replace function public.enforce_user_group_member_is_active()
returns trigger
language plpgsql
security definer
set search_path to ''
as $fn$
begin
  if not exists (select 1 from public.staff_users su
                  where su.id = new.staff_id and su.status = 'active') then
    raise exception 'Only an active staff member can join a user group';
  end if;
  return new;
end $fn$;
revoke all on function public.enforce_user_group_member_is_active() from public, anon, authenticated;

create trigger trg_user_group_members_member_is_active
  before insert on public.user_group_members
  for each row execute function public.enforce_user_group_member_is_active();

-- The diff shared by both directions of membership editing. A member who stays
-- is not an event: no delete-and-reinsert, so the trail carries only what
-- changed, and an existing membership of an ARCHIVED group survives a save
-- that still lists it. NEW rows into an archived group are refused.
create or replace function public.apply_user_group_membership(
  p_staff_ids uuid[],
  p_user_group_ids uuid[]
)
returns void
language plpgsql
security invoker
set search_path to ''
as $fn$
declare
  v_staff uuid;
  v_group uuid;
begin
  foreach v_staff in array p_staff_ids loop
    foreach v_group in array p_user_group_ids loop
      if not exists (select 1 from public.user_group_members m
                      where m.staff_id = v_staff and m.user_group_id = v_group) then
        if not exists (select 1 from public.user_groups ug
                        where ug.id = v_group and ug.status = 'active') then
          raise exception 'That user group is archived';
        end if;
        insert into public.user_group_members (user_group_id, staff_id) values (v_group, v_staff);
      end if;
    end loop;
  end loop;
end $fn$;
revoke all on function public.apply_user_group_membership(uuid[], uuid[]) from public, anon, authenticated;

create or replace function public.set_user_group_members(p_user_group_id uuid, p_staff_ids uuid[])
returns void
language plpgsql
security invoker
set search_path to ''
as $fn$
declare
  v_ids   uuid[];
  v_staff uuid;
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
  select coalesce(array_agg(distinct s), '{}') into v_ids from unnest(coalesce(p_staff_ids, '{}')) s;

  -- Said before anything is written, so the sentence names the rule rather than
  -- a row-level-security refusal.
  foreach v_staff in array v_ids loop
    if not exists (select 1 from public.staff_users su where su.id = v_staff and su.status = 'active') then
      raise exception 'Only an active staff member can join a user group';
    end if;
  end loop;

  delete from public.user_group_members m
   where m.user_group_id = p_user_group_id
     and not (m.staff_id = any (v_ids));

  foreach v_staff in array v_ids loop
    perform public.apply_user_group_membership(array[v_staff], array[p_user_group_id]);
  end loop;
end $fn$;
revoke all on function public.set_user_group_members(uuid, uuid[]) from public, anon;
grant execute on function public.set_user_group_members(uuid, uuid[]) to authenticated;
comment on function public.set_user_group_members(uuid, uuid[]) is
  'Replace a user group''s members with exactly this set — an empty array removes everyone. Administrators only. A diff, not a churn: unchanged members write no audit row. New members must be active staff; new rows into an archived group are refused. Added 20 Sep 2026.';

-- ---------------------------------------------------------------------------
-- 6. Assigning a household
-- ---------------------------------------------------------------------------
-- The permission is exactly scoped_update_client_groups — whoever may edit the
-- household today (access + manage_groups). This function adds no reach; it
-- exists so the refusals are sentences and the zero-row case is caught.
--
-- A subtlety, accepted: WITH CHECK is evaluated against the row as the caller
-- could see it BEFORE the change, so a LIMITED member of territory A may move
-- a household to territory B and lose sight of it. That is the feature
-- working; the screen says so beside the field.

create or replace function public.set_client_group_user_group(p_group_id uuid, p_user_group_id uuid)
returns void
language plpgsql
security invoker
set search_path to ''
as $fn$
declare
  v_rows int;
begin
  if public.current_staff_id() is null then
    raise exception 'Not an active staff member';
  end if;
  if p_user_group_id is not null and not exists (
       select 1 from public.user_groups ug where ug.id = p_user_group_id and ug.status = 'active') then
    raise exception 'No such user group, or it has been archived';
  end if;

  update public.client_groups g
     set user_group_id = p_user_group_id,
         updated_at    = now()
   where g.id = p_group_id;

  get diagnostics v_rows = row_count;
  if v_rows = 0 then
    raise exception 'You do not have permission to change this group';
  end if;
end $fn$;
revoke all on function public.set_client_group_user_group(uuid, uuid) from public, anon;
grant execute on function public.set_client_group_user_group(uuid, uuid) to authenticated;
comment on function public.set_client_group_user_group(uuid, uuid) is
  'Put a household in a user group (territory), or take it out with null. Governed by scoped_update_client_groups — whoever may edit the household. Refuses an archived group. Added 20 Sep 2026.';

-- ---------------------------------------------------------------------------
-- 7. The patch function: the toggle, and the person's own groups
-- ---------------------------------------------------------------------------
-- Restated in full from the 20 Sep title/date-of-birth text, with two keys:
--
--   limited_to_user_groups   a JSON boolean, like verify_identity;
--   user_group_ids           a JSON array of uuid, SET-REPLACING like an
--                            account's owner_party_ids — the person ends up in
--                            exactly these groups. A diff, not a churn.
--
-- Both sit in the same Access box on the User drawer, so one Save is one call.

create or replace function public.update_staff_patch(p_staff_id uuid, p_patch jsonb)
returns text
language plpgsql
security invoker
set search_path to ''
as $fn$
declare
  v_keys         text[] := array['first_name', 'last_name', 'email', 'status', 'profile_id', 'avatar_path',
                                 'verify_identity', 'title', 'date_of_birth',
                                 'limited_to_user_groups', 'user_group_ids'];
  v_key          text;
  cur            record;
  v_first        text;
  v_last         text;
  v_email        text;
  v_status       text;
  v_profile      uuid;
  v_avatar       text;
  v_verify       boolean;
  v_title        text;
  v_dob          date;
  v_limited      boolean;
  v_groups       uuid[];
  v_group        uuid;
  v_before_admin boolean;
  v_after_admin  boolean;
  v_after_active boolean;
  v_rows         int;
begin
  if public.current_staff_id() is null then
    raise exception 'Not an active staff member';
  end if;
  if p_patch is null or jsonb_typeof(p_patch) <> 'object' or p_patch = '{}'::jsonb then
    raise exception 'Nothing to change';
  end if;
  for v_key in select jsonb_object_keys(p_patch) loop
    if not (v_key = any (v_keys)) then
      raise exception 'Unknown field in patch: %', v_key;
    end if;
  end loop;

  select su.id, su.status::text as status, su.avatar_path, saa.profile_id
    into cur
    from public.staff_users su
    left join public.staff_access_assignments saa on saa.staff_id = su.id
   where su.id = p_staff_id;
  if not found then
    raise exception 'No such staff member, or not one you have access to';
  end if;

  if p_patch ? 'first_name' then
    v_first := btrim(regexp_replace(coalesce(p_patch->>'first_name', ''), '\s+', ' ', 'g'));
    if v_first = '' then
      raise exception 'Enter a first name';
    end if;
    if length(v_first) > 60 then
      raise exception 'That first name is too long';
    end if;
  end if;

  if p_patch ? 'last_name' then
    v_last := btrim(regexp_replace(coalesce(p_patch->>'last_name', ''), '\s+', ' ', 'g'));
    if v_last = '' then
      raise exception 'Enter a last name';
    end if;
    if length(v_last) > 60 then
      raise exception 'That last name is too long';
    end if;
  end if;

  if p_patch ? 'title' then
    -- Blank clears. nullif AFTER the trim, so a run of spaces is blank too.
    v_title := nullif(btrim(regexp_replace(coalesce(p_patch->>'title', ''), '\s+', ' ', 'g')), '');
    if length(v_title) > 30 then
      raise exception 'That title is too long';
    end if;
  end if;

  if p_patch ? 'date_of_birth' then
    if jsonb_typeof(p_patch->'date_of_birth') = 'null' or btrim(p_patch->>'date_of_birth') = '' then
      v_dob := null;
    else
      -- ISO shape FIRST, then the cast. `::date` alone happily parses
      -- '01/06/1980' under whatever DateStyle the server has — 6 January on one
      -- setting, 1 June on another — and a birthday that lands silently on the
      -- wrong day is worse than one that is refused.
      if btrim(p_patch->>'date_of_birth') !~ '^\d{4}-\d{2}-\d{2}$' then
        raise exception 'Enter the date of birth as a date';
      end if;
      begin
        v_dob := (p_patch->>'date_of_birth')::date;
      exception when others then
        raise exception 'Enter the date of birth as a date';
      end;
      if v_dob > current_date then
        raise exception 'A date of birth cannot be in the future';
      end if;
      if v_dob < current_date - interval '120 years' then
        raise exception 'That date of birth is more than 120 years ago';
      end if;
    end if;
  end if;

  if p_patch ? 'email' then
    v_email := lower(btrim(p_patch->>'email'));
    if coalesce(v_email, '') = '' or v_email not like '%_@_%.%' then
      raise exception 'Enter a valid email address';
    end if;
    if exists (select 1 from public.staff_users su where lower(su.email) = v_email and su.id <> p_staff_id) then
      raise exception 'Another staff member already uses that email address';
    end if;
  end if;

  if p_patch ? 'status' then
    v_status := p_patch->>'status';
    if v_status is null or not (v_status = any (enum_range(null::public.staff_status)::text[])) then
      raise exception 'Unknown status: %', coalesce(v_status, 'null');
    end if;
    if v_status = 'pending' then
      raise exception 'A staff member cannot be returned to pending';
    end if;
    if cur.status = 'pending' and v_status = 'active' then
      raise exception 'Use Approve to activate a pending request';
    end if;
    if p_staff_id = public.current_staff_id() and v_status <> 'active' then
      raise exception 'You cannot deactivate your own account';
    end if;
  end if;

  if p_patch ? 'profile_id' then
    begin
      v_profile := (p_patch->>'profile_id')::uuid;
    exception when others then
      raise exception 'No such access profile';
    end;
    if not exists (select 1 from public.access_profiles ap where ap.id = v_profile) then
      raise exception 'No such access profile';
    end if;
  end if;

  if p_patch ? 'avatar_path' then
    v_avatar := nullif(p_patch->>'avatar_path', '');
    if v_avatar is not null then
      if v_avatar !~ ('^' || p_staff_id::text || '/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(png|jpg|webp)$') then
        raise exception 'That photo does not belong to this staff member';
      end if;
      if not exists (select 1 from storage.objects o where o.bucket_id = 'staff-avatars' and o.name = v_avatar) then
        raise exception 'That photo has not been uploaded';
      end if;
    end if;
  end if;

  if p_patch ? 'verify_identity' then
    if jsonb_typeof(p_patch->'verify_identity') <> 'boolean' then
      raise exception 'verify_identity must be true or false';
    end if;
    v_verify := (p_patch->>'verify_identity')::boolean;
  end if;

  if p_patch ? 'limited_to_user_groups' then
    if jsonb_typeof(p_patch->'limited_to_user_groups') <> 'boolean' then
      raise exception 'limited_to_user_groups must be true or false';
    end if;
    v_limited := (p_patch->>'limited_to_user_groups')::boolean;
  end if;

  if p_patch ? 'user_group_ids' then
    if not public.current_staff_has('manage_staff') then
      raise exception 'Only an administrator can manage user groups';
    end if;
    if jsonb_typeof(p_patch->'user_group_ids') <> 'array' then
      raise exception 'user_group_ids must be a list';
    end if;
    begin
      select coalesce(array_agg(distinct e::uuid), '{}') into v_groups
        from jsonb_array_elements_text(p_patch->'user_group_ids') e;
    exception when others then
      raise exception 'No such user group';
    end;
    foreach v_group in array v_groups loop
      if not exists (select 1 from public.user_groups ug where ug.id = v_group) then
        raise exception 'No such user group';
      end if;
    end loop;
    if cardinality(v_groups) > 0 and cur.status <> 'active' then
      raise exception 'Only an active staff member can join a user group';
    end if;
  end if;

  if (p_patch ? 'status' or p_patch ? 'profile_id') and cur.status = 'active' then
    select ap.manage_staff into v_before_admin from public.access_profiles ap where ap.id = cur.profile_id;
    if coalesce(v_before_admin, false) then
      v_after_active := coalesce(v_status, cur.status) = 'active';
      select ap.manage_staff into v_after_admin from public.access_profiles ap where ap.id = coalesce(v_profile, cur.profile_id);
      if not (v_after_active and coalesce(v_after_admin, false))
         and not exists (
           select 1
             from public.staff_users su
             join public.staff_access_assignments saa on saa.staff_id = su.id
             join public.access_profiles ap on ap.id = saa.profile_id
            where su.id <> p_staff_id and su.status = 'active' and ap.manage_staff
         ) then
        raise exception 'At least one active administrator must remain';
      end if;
    end if;
  end if;

  if p_patch ?| array['first_name', 'last_name', 'email', 'status', 'avatar_path', 'verify_identity', 'title',
                      'limited_to_user_groups'] then
    update public.staff_users su
       set first_name             = coalesce(v_first, su.first_name),
           last_name              = coalesce(v_last, su.last_name),
           email                  = coalesce(v_email, su.email),
           status                 = case when p_patch ? 'status' then v_status::public.staff_status else su.status end,
           avatar_path            = case when p_patch ? 'avatar_path' then v_avatar else su.avatar_path end,
           verify_identity        = case when p_patch ? 'verify_identity' then v_verify else su.verify_identity end,
           title                  = case when p_patch ? 'title' then v_title else su.title end,
           limited_to_user_groups = case when p_patch ? 'limited_to_user_groups' then v_limited else su.limited_to_user_groups end
     where su.id = p_staff_id;
    get diagnostics v_rows = row_count;
    if v_rows = 0 then
      raise exception 'You do not have permission to change this staff member';
    end if;
  end if;

  if p_patch ? 'date_of_birth' then
    -- The row is created on first write and kept thereafter, even holding null:
    -- "recorded, then cleared" and "never recorded" are both legible in the trail.
    insert into public.staff_private_details (staff_id, date_of_birth)
    values (p_staff_id, v_dob)
    on conflict (staff_id) do update
      set date_of_birth = excluded.date_of_birth
      where staff_private_details.date_of_birth is distinct from excluded.date_of_birth;
  end if;

  if p_patch ? 'profile_id' then
    insert into public.staff_access_assignments (staff_id, profile_id)
    values (p_staff_id, v_profile)
    on conflict (staff_id) do update
      set profile_id = excluded.profile_id
      where staff_access_assignments.profile_id is distinct from excluded.profile_id;
  end if;

  if p_patch ? 'user_group_ids' then
    -- A diff, not a churn: leave, remove, add. A membership of an archived group
    -- that is still listed is left alone; only a NEW row into one is refused.
    delete from public.user_group_members m
     where m.staff_id = p_staff_id
       and not (m.user_group_id = any (v_groups));
    if cardinality(v_groups) > 0 then
      perform public.apply_user_group_membership(array[p_staff_id], v_groups);
    end if;
  end if;

  return case when p_patch ? 'avatar_path' and cur.avatar_path is distinct from v_avatar then cur.avatar_path end;
end $fn$;

comment on function public.update_staff_patch(uuid, jsonb) is
  'Change a staff member: first_name, last_name, title, email, status, profile_id, avatar_path, verify_identity, date_of_birth, limited_to_user_groups and user_group_ids, by key presence; unknown keys refused. A present-and-blank title or date_of_birth clears it. verify_identity and limited_to_user_groups must be JSON booleans. user_group_ids is a JSON array and SET-REPLACES the person''s user groups (administrators only; a diff, not a churn). date_of_birth is written to staff_private_details. Email is the CRM address, not the sign-in email. Refuses deactivating yourself and removing the last active administrator (both also enforced by triggers). Returns the photo path it replaced or removed, or null.';

-- ---------------------------------------------------------------------------
-- 8. The audit trail names a user group
-- ---------------------------------------------------------------------------
-- Both functions restated in full. audit_record_label keeps every arm it had,
-- including the staff_users full_name coalesce that reads pre-19-Sep payloads
-- forever; the only change is the renamed arm (0 historic rows named teams).

create or replace function public.audit_record_label(p_table text, p_data jsonb)
returns text
language sql
immutable
set search_path to ''
as $fn$
  select nullif(btrim(case p_table
    when 'parties'                      then p_data->>'display_name'
    when 'persons'                      then concat_ws(' ', p_data->>'first_name', p_data->>'last_name')
    when 'organisations'                then p_data->>'legal_name'
    when 'client_groups'                then p_data->>'name'
    when 'user_groups'                  then p_data->>'name'
    when 'access_profiles'              then p_data->>'name'
    -- Payloads written before 19 Sep 2026 carry full_name; those written after
    -- carry the two parts. Both must resolve, forever.
    when 'staff_users'                  then coalesce(p_data->>'full_name',
                                                      concat_ws(' ', p_data->>'first_name', p_data->>'last_name'))
    when 'contact_points'               then p_data->>'value'
    when 'party_roles'                  then p_data->>'role'
    when 'party_relationships'          then p_data->>'relationship_type'
    when 'client_group_members'         then p_data->>'member_role'
    when 'client_group_access'          then p_data->>'access_level'
    when 'notes'                        then p_data->>'title'
    when 'financial_accounts'           then p_data->>'label'
    when 'assets_liabilities'           then p_data->>'label'
    when 'insurance_policies'           then p_data->>'label'
    when 'financial_account_valuations' then p_data->>'as_at'
    when 'note_attachments'             then p_data->>'kind'
    when 'workflow_post_media'          then p_data->>'original_name'
    else coalesce(p_data->>'label', p_data->>'name', p_data->>'display_name', p_data->>'title')
  end), '')
$fn$;

comment on function public.audit_record_label(text, jsonb) is
  'The label to show for an audited row, read from the payload as it stood at the time rather than from the record''s current name. The staff_users branch reads full_name OR the two name parts, because audit_log is append-only and payloads from before 19 Sep 2026 carry the old shape permanently. user_groups (renamed from teams 20 Sep 2026) labels by name.';

create or replace function public.audit_label_table(p_table text)
returns text
language sql
immutable
set search_path to ''
as $fn$
  select case p_table
    when 'persons'                  then 'parties'
    when 'organisations'            then 'parties'
    when 'financial_account_owners' then 'financial_accounts'
    when 'insurance_policy_parties' then 'insurance_policies'
    when 'asset_liability_owners'   then 'assets_liabilities'
    when 'staff_access_assignments' then 'staff_users'
    when 'staff_private_details'    then 'staff_users'
    when 'user_group_members'       then 'user_groups'
    else p_table
  end
$fn$;

-- ---------------------------------------------------------------------------
-- 9. group_summary carries the household's user group
-- ---------------------------------------------------------------------------
-- `create or replace` may only APPEND, so the two columns come LAST, after
-- `members`. The groups index, the group page and the MCP's three group tools
-- all read this view, so they learn the territory from the same row they
-- already fetch. Grants are preserved by create-or-replace.
--
-- `households` and `business_entities` are frozen `select *` views over
-- client_groups and will NOT show user_group_id. Nothing reads them.

create or replace view public.group_summary
with (security_invoker = true) as
select
  g.id as group_id,
  g.group_type,
  g.name,
  g.status,
  pc.display_name as primary_contact,
  count(m.id) filter (where m.end_date is null) as member_count,
  string_agg(
    p.display_name || ' (' || m.member_role || ')', ', '
    order by m.member_role, p.display_name
  ) filter (where m.end_date is null) as members,
  g.user_group_id,
  ug.name as user_group_name
from public.client_groups g
left join public.client_group_members m on m.group_id = g.id
left join public.parties p on p.id = m.party_id
left join public.parties pc on pc.id = g.primary_contact_party_id
left join public.user_groups ug on ug.id = g.user_group_id
group by g.id, g.group_type, g.name, g.status, pc.display_name, g.user_group_id, ug.name;
comment on view public.group_summary is
  'One row per client group with member names and roles rolled up, and since 20 Sep 2026 the user group (territory) it belongs to.';

-- ---------------------------------------------------------------------------
-- 10. Prove it, or abort
-- ---------------------------------------------------------------------------

do $$
declare
  v_grants text;
  v_n      int;
begin
  if to_regclass('public.teams') is not null or to_regclass('public.team_members') is not null then
    raise exception 'the July tables were not renamed';
  end if;
  if to_regclass('public.user_groups') is null or to_regclass('public.user_group_members') is null then
    raise exception 'user_groups or user_group_members is missing';
  end if;

  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'client_groups'
                    and column_name = 'user_group_id' and is_nullable = 'YES') then
    raise exception 'client_groups.user_group_id was not added, or is not nullable';
  end if;
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'staff_users'
                    and column_name = 'limited_to_user_groups'
                    and is_nullable = 'NO' and column_default = 'false') then
    raise exception 'staff_users.limited_to_user_groups was not added, or is not "not null default false"';
  end if;

  -- THE DAY-ONE GUARANTEE. Nobody limited, nothing assigned: the new access
  -- function then reduces to the old one and nobody's view changes.
  select count(*) into v_n from public.staff_users where limited_to_user_groups;
  if v_n <> 0 then
    raise exception '% staff member(s) are limited on arrival — that would change who sees what on day one', v_n;
  end if;
  select count(*) into v_n from public.client_groups where user_group_id is not null;
  if v_n <> 0 then
    raise exception '% household(s) are assigned on arrival — that would change who sees what on day one', v_n;
  end if;

  if (select count(*) from pg_policies where schemaname = 'public' and tablename = 'user_groups') <> 3 then
    raise exception 'user_groups should carry exactly three policies';
  end if;
  if (select count(*) from pg_policies where schemaname = 'public' and tablename = 'user_group_members') <> 3 then
    raise exception 'user_group_members should carry exactly three policies';
  end if;

  select string_agg(privilege_type, ',' order by privilege_type) into v_grants
    from information_schema.role_table_grants
   where table_schema = 'public' and table_name = 'user_groups' and grantee = 'authenticated';
  if v_grants is distinct from 'INSERT,SELECT,UPDATE' then
    raise exception 'authenticated holds % on user_groups, expected INSERT,SELECT,UPDATE', coalesce(v_grants, 'nothing');
  end if;
  select string_agg(privilege_type, ',' order by privilege_type) into v_grants
    from information_schema.role_table_grants
   where table_schema = 'public' and table_name = 'user_group_members' and grantee = 'authenticated';
  if v_grants is distinct from 'DELETE,INSERT,SELECT' then
    raise exception 'authenticated holds % on user_group_members, expected DELETE,INSERT,SELECT', coalesce(v_grants, 'nothing');
  end if;
  if exists (select 1 from information_schema.role_table_grants
              where table_schema = 'public' and table_name in ('user_groups', 'user_group_members')
                and grantee in ('anon', 'PUBLIC')) then
    raise exception 'anon or PUBLIC holds a privilege on a user-group table';
  end if;

  if (select prosrc from pg_proc where proname = 'staff_can_access_group' and pronamespace = 'public'::regnamespace)
     not like '%limited_to_user_groups%' then
    raise exception 'staff_can_access_group does not read the toggle';
  end if;
  -- Nothing left in any function still speaks the July vocabulary.
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
              where n.nspname = 'public' and p.prosrc ~ '\mteam_members\M|\mteams\M|\mteam_id\M') then
    raise exception 'a function still names teams, team_members or team_id';
  end if;

  if not exists (select 1 from pg_trigger where tgname = 'trg_user_groups_audit') then
    raise exception 'user_groups is not audited';
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'trg_user_group_members_audit') then
    raise exception 'user_group_members is not audited';
  end if;
  if public.audit_label_table('user_group_members') <> 'user_groups' then
    raise exception 'audit_label_table does not map a membership to its user group';
  end if;
  if public.audit_record_label('user_groups', '{"name": "Sydney"}'::jsonb) <> 'Sydney' then
    raise exception 'audit_record_label does not name a user group';
  end if;

  if not exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'client_groups_user_group_idx') then
    raise exception 'client_groups_user_group_idx is missing';
  end if;
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'group_summary' and column_name = 'user_group_name') then
    raise exception 'group_summary does not carry user_group_name';
  end if;
end $$;
