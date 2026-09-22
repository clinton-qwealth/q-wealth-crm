-- A household may belong to several user groups (22 Sep 2026)
--
-- Two days ago a household belonged to at most ONE territory, which was the
-- answer Clinton gave when asked. It is not the shape the firm turns out to
-- need: a household can be serviced by more than one territory, so the single
-- column becomes a link table.
--
-- THE RULE IS UNCHANGED, and is still the sentence every comment here repeats:
-- **MEMBERSHIP GRANTS; THE TOGGLE RESTRICTS.** Only the cardinality moves. Every
-- arm of staff_can_access_group() keeps its meaning; "the household's user
-- group" simply becomes "any of the household's user groups", and "the
-- household is unassigned" becomes "the household is in no user group at all".
--
-- ---------------------------------------------------------------------------
-- THIS FILE IS ADDITIVE, DELIBERATELY
-- ---------------------------------------------------------------------------
-- `client_groups.user_group_id` SURVIVES, and the deployed web app goes on
-- reading it. That is the 31 August lesson applied again: the deployed group
-- page selects that column by name, so dropping it here would 400 the main
-- workspace page for everybody until Vercel finished a deploy. Instead:
--
--   this migration → deploy the app reading the link table → a later migration
--   drops the column, the bridge function and the two transitional view columns
--
-- Until that last step the column is kept in step by set_client_group_user_groups(),
-- which writes BOTH — exactly the shape the full_name transition used, and for
-- the same reason. The column is not read by anything in this file except that
-- backfill.
--
-- Nothing is rebuilt, either: `group_summary` is REPLACED rather than dropped,
-- because `create or replace view` permits changing a column's expression and
-- appending new columns at the end. Dropping it would have taken
-- workflow_posts_summary, group_account_posts and group_policy_posts with it.
--
-- ---------------------------------------------------------------------------
-- Nothing changes for anybody on day one, and the closing block ABORTS if not
-- ---------------------------------------------------------------------------
-- No household is assigned to a territory (0 rows as at 22 Sep 2026) and nobody
-- is limited, so the rewritten access function reduces to the previous one arm
-- for arm. The assertions at the bottom refuse the migration rather than report
-- if either of those counts is non-zero.

-- ---------------------------------------------------------------------------
-- 1. The link
-- ---------------------------------------------------------------------------

create table public.client_group_user_groups (
  group_id      uuid not null references public.client_groups(id) on delete cascade,
  user_group_id uuid not null references public.user_groups(id)   on delete cascade,
  created_at    timestamptz not null default now(),
  primary key (group_id, user_group_id)
);

comment on table public.client_group_user_groups is
  'Which user groups (territories) a household belongs to — any number, none included. Replaces client_groups.user_group_id, which survives only until the app reading this table is deployed. Insert and delete only: a household is in a territory or it is not, never "edited" into one. Added 22 Sep 2026.';

comment on column public.client_group_user_groups.user_group_id is
  'ON DELETE CASCADE, and that is NOT the reverse of the column it replaces. The old column said `on delete set null` to make the point that removing a territory must not remove the HOUSEHOLDS in it — and it still does not: deleting a user group deletes these link rows and leaves every client_groups row untouched. The fact "this household is in this territory" simply stops being true, which is the same outcome the null was buying. In practice no user group can be deleted at all: the policies grant no delete, archiving is the way out.';

-- A household in no territory is the common case and the one the access rule
-- carves out, so the reverse lookup is the one that needs help: "which
-- households are in this territory", behind the User groups tab's count.
create index client_group_user_groups_user_group_idx
  on public.client_group_user_groups (user_group_id);

-- The backfill. Zero rows today; written anyway, because a migration that is
-- only correct against one particular database is not a migration.
insert into public.client_group_user_groups (group_id, user_group_id)
select g.id, g.user_group_id
  from public.client_groups g
 where g.user_group_id is not null
on conflict do nothing;

alter table public.client_group_user_groups enable row level security;

-- Reading a link is reading a fact about a household, so it is governed by
-- access to that household rather than by "is active staff". A limited person
-- does not learn which territories a household they cannot see belongs to.
-- staff_can_access_group() is SECURITY DEFINER and therefore reads this table
-- past its own RLS — there is no recursion here.
create policy scoped_select_client_group_user_groups on public.client_group_user_groups
  for select using (public.staff_can_access_group(group_id));

-- Writing one is editing the household, which is exactly scoped_update_client_groups.
create policy scoped_insert_client_group_user_groups on public.client_group_user_groups
  for insert with check (
    public.staff_can_access_group(group_id) and public.current_staff_has('manage_groups')
  );

create policy scoped_delete_client_group_user_groups on public.client_group_user_groups
  for delete using (
    public.staff_can_access_group(group_id) and public.current_staff_has('manage_groups')
  );

revoke all on public.client_group_user_groups from public, anon, authenticated;
grant select, insert, delete on public.client_group_user_groups to authenticated;

-- An archived territory cannot be newly assigned; one already assigned survives
-- archiving. The policy says WHO, the trigger says WHAT — the 19 Sep idiom.
-- INSERT only: there is no update on this table to guard.
create or replace function public.enforce_client_group_user_group_is_active()
returns trigger
language plpgsql
security definer
set search_path to ''
as $fn$
begin
  if not exists (select 1 from public.user_groups ug
                  where ug.id = new.user_group_id and ug.status = 'active') then
    raise exception 'That user group is archived';
  end if;
  return new;
end $fn$;
revoke all on function public.enforce_client_group_user_group_is_active() from public, anon, authenticated;

create trigger trg_client_group_user_groups_is_active
  before insert on public.client_group_user_groups
  for each row execute function public.enforce_client_group_user_group_is_active();

-- Keyed by group_id, not by the link's own composite key, so the trail reads
-- under the HOUSEHOLD's name — "Added · Smith Household". Same reasoning as the
-- membership trigger being keyed by user_group_id.
create trigger trg_client_group_user_groups_audit
  after insert or delete on public.client_group_user_groups
  for each row execute function public.record_audit('group_id', '');

-- ---------------------------------------------------------------------------
-- 2. The audit trail names the household
-- ---------------------------------------------------------------------------
-- Restated in full with one arm added. Every existing arm is unchanged.

create or replace function public.audit_label_table(p_table text)
returns text
language sql
immutable
set search_path to ''
as $fn$
  select case p_table
    when 'persons'                    then 'parties'
    when 'organisations'              then 'parties'
    when 'financial_account_owners'   then 'financial_accounts'
    when 'insurance_policy_parties'   then 'insurance_policies'
    when 'asset_liability_owners'     then 'assets_liabilities'
    when 'staff_access_assignments'   then 'staff_users'
    when 'staff_private_details'      then 'staff_users'
    when 'user_group_members'         then 'user_groups'
    when 'client_group_user_groups'   then 'client_groups'
    else p_table
  end
$fn$;

comment on function public.audit_label_table(text) is
  'The table whose payload carries a readable label for rows of this one — a join table resolves to its parent, so a change is shown against the thing a person can name. client_group_user_groups resolves to the household (22 Sep 2026), user_group_members to the user group, staff_private_details to the person.';

-- ---------------------------------------------------------------------------
-- 3. Who may see a household
-- ---------------------------------------------------------------------------
-- The contract is kept exactly, arm for arm. Elevated first (true), then
-- not-active-staff (false). Then:
--
--   1. the owner always sees their own household;
--   2. MEMBERSHIP GRANTS — a member of ANY of the household's user groups sees
--      it, whatever their profile, and whether or not that group has since been
--      archived ("archived" means "out of the pickers", not "revoked");
--   3. firm-wide sight from the profile — but a LIMITED person's does not reach
--      a household that is in at least one group, none of which they are in. A
--      household in NO group behaves exactly as before, for everyone;
--   4. one-off sharing: a grant to the person or to a group they belong to.
--
-- The only change from 20 Sep is that arms 2 and 3 ask about a SET. With no
-- links at all (day one) arm 2 never fires and arm 3 is the old
-- `view_all_groups → true`. Nothing changes for anyone.

create or replace function public.staff_can_access_group(p_group_id uuid)
returns boolean
language plpgsql
security definer
stable
set search_path = ''
as $fn$
declare
  v_staff     uuid;
  v_owner     uuid;
  v_any_group boolean;
  v_limited   boolean;
begin
  if public.is_elevated_context() then
    return true;
  end if;
  v_staff := public.current_staff_id();
  if v_staff is null then
    return false;
  end if;

  select g.owner_staff_id into v_owner
    from public.client_groups g
   where g.id = p_group_id;

  -- 1. The owner always sees their own household.
  if v_owner = v_staff then
    return true;
  end if;

  -- 2. Membership grants, archived or not — ANY shared territory is enough.
  if exists (
    select 1
      from public.client_group_user_groups l
      join public.user_group_members m on m.user_group_id = l.user_group_id
     where l.group_id = p_group_id and m.staff_id = v_staff
  ) then
    return true;
  end if;

  -- 3. Firm-wide sight, unless limited AND the household is in some group.
  if public.current_staff_has('view_all_groups') then
    select exists (select 1 from public.client_group_user_groups l where l.group_id = p_group_id)
      into v_any_group;
    if not v_any_group then
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
  'Whether the caller may see a household — the one decision every group-scoped policy derives from. Owner → yes. Member of ANY of the household''s user groups → yes (membership grants, archived or not). Profile view_all_groups → yes, unless the person is limited_to_user_groups AND the household is in at least one group they are not in; a household in no user group is visible to every view_all_groups holder. A grant to the person or to one of their user groups → yes. Elevated context → yes; not active staff → no. Reads client_group_user_groups since 22 Sep 2026, when a household stopped being limited to one territory.';

-- ---------------------------------------------------------------------------
-- 4. group_summary carries the set
-- ---------------------------------------------------------------------------
-- REPLACED, not dropped: `create or replace view` permits a column's expression
-- to change and permits new columns AT THE END, which is all this needs. A drop
-- would have taken workflow_posts_summary — and through it group_account_posts
-- and group_policy_posts — with it.
--
-- `user_group_id` and `user_group_name` KEEP THEIR NAMES AND TYPES and now mean
-- "the first of this household's territories, by name". They are transitional:
-- the deployed build and the deployed MCP both read them, and a null there for
-- a household that IS in a territory would be a lie for as long as the window
-- lasts. They are dropped with the column, in the later migration.
--
-- The set is read with correlated subqueries rather than a join, because this
-- view is grouped: joining the link table would multiply the rows and make
-- member_count wrong.

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
  (select l.user_group_id
     from public.client_group_user_groups l
     join public.user_groups u on u.id = l.user_group_id
    where l.group_id = g.id
    order by u.name
    limit 1) as user_group_id,
  (select u.name
     from public.client_group_user_groups l
     join public.user_groups u on u.id = l.user_group_id
    where l.group_id = g.id
    order by u.name
    limit 1) as user_group_name,
  coalesce((select array_agg(l.user_group_id order by u.name)
              from public.client_group_user_groups l
              join public.user_groups u on u.id = l.user_group_id
             where l.group_id = g.id), '{}'::uuid[]) as user_group_ids,
  coalesce((select array_agg(u.name order by u.name)
              from public.client_group_user_groups l
              join public.user_groups u on u.id = l.user_group_id
             where l.group_id = g.id), '{}'::text[]) as user_group_names
from public.client_groups g
left join public.client_group_members m on m.group_id = g.id
left join public.parties p on p.id = m.party_id
left join public.parties pc on pc.id = g.primary_contact_party_id
group by g.id, g.group_type, g.name, g.status, pc.display_name;

comment on view public.group_summary is
  'One row per client group with its members rolled up, and the user groups (territories) it belongs to. security_invoker, so staff_can_access_group() decides which rows come back. user_group_ids and user_group_names are the set, ordered by name, and empty for a household in no territory. user_group_id and user_group_name are the FIRST of that set and exist only until the clients reading them are redeployed — prefer the arrays.';

-- ---------------------------------------------------------------------------
-- 5. Setting a household's territories
-- ---------------------------------------------------------------------------

create or replace function public.set_client_group_user_groups(p_group_id uuid, p_user_group_ids uuid[])
returns void
language plpgsql
security invoker
set search_path to ''
as $fn$
declare
  v_ids   uuid[] := coalesce(p_user_group_ids, '{}'::uuid[]);
  v_id    uuid;
  v_first uuid;
begin
  if public.current_staff_id() is null then
    raise exception 'Not an active staff member';
  end if;
  -- Up front, so the answer is a sentence rather than a silent no-op. The
  -- policies below enforce the same thing; this is the friendlier of two
  -- identical answers.
  if not public.staff_can_access_group(p_group_id) or not public.current_staff_has('manage_groups') then
    raise exception 'You do not have permission to change this group';
  end if;

  foreach v_id in array v_ids loop
    if not exists (select 1 from public.user_groups ug where ug.id = v_id) then
      raise exception 'No such user group';
    end if;
  end loop;

  -- A diff, not a churn: a link to a group that has since been ARCHIVED survives
  -- an unrelated save as long as it is still listed, and only a NEW link into an
  -- archived group is refused — by the trigger, which no caller can route past.
  delete from public.client_group_user_groups l
   where l.group_id = p_group_id
     and not (l.user_group_id = any (v_ids));

  insert into public.client_group_user_groups (group_id, user_group_id)
  select p_group_id, x
    from unnest(v_ids) as x
  on conflict do nothing;

  -- TRANSITIONAL, and it goes when the column does. The deployed build still
  -- reads client_groups.user_group_id directly, so it is kept pointing at the
  -- first territory by name rather than left to rot — the same bridge the
  -- full_name transition used.
  select l.user_group_id into v_first
    from public.client_group_user_groups l
    join public.user_groups u on u.id = l.user_group_id
   where l.group_id = p_group_id
   order by u.name
   limit 1;

  update public.client_groups g
     set user_group_id = v_first,
         updated_at    = now()
   where g.id = p_group_id;
end $fn$;
revoke all on function public.set_client_group_user_groups(uuid, uuid[]) from public, anon;
grant execute on function public.set_client_group_user_groups(uuid, uuid[]) to authenticated;
comment on function public.set_client_group_user_groups(uuid, uuid[]) is
  'Set which user groups (territories) a household belongs to — the array replaces the set, and an empty array takes it out of all of them. Permission is exactly scoped_update_client_groups: whoever may edit the household, with manage_groups. A new link into an archived group is refused; an existing one survives. Also keeps the transitional client_groups.user_group_id pointing at the first of the set. Added 22 Sep 2026.';

-- The singular function stays, as a BRIDGE for the build that is still
-- deployed, and now writes the link table so that what the old screen does is
-- real rather than written to a column nothing reads any more. It is dropped
-- with the column.
create or replace function public.set_client_group_user_group(p_group_id uuid, p_user_group_id uuid)
returns void
language plpgsql
security invoker
set search_path to ''
as $fn$
begin
  if p_user_group_id is not null and not exists (
       select 1 from public.user_groups ug where ug.id = p_user_group_id and ug.status = 'active') then
    raise exception 'No such user group, or it has been archived';
  end if;
  perform public.set_client_group_user_groups(
    p_group_id,
    case when p_user_group_id is null then '{}'::uuid[] else array[p_user_group_id] end);
end $fn$;
revoke all on function public.set_client_group_user_group(uuid, uuid) from public, anon;
grant execute on function public.set_client_group_user_group(uuid, uuid) to authenticated;
comment on function public.set_client_group_user_group(uuid, uuid) is
  'DEPRECATED 22 Sep 2026, kept only for the build deployed before a household could belong to several territories. Delegates to set_client_group_user_groups(), so it REPLACES the household''s whole set with the one group given, or empties it with null. Dropped once the new app is deployed.';

-- ---------------------------------------------------------------------------
-- 6. Prove it, or abort
-- ---------------------------------------------------------------------------

do $$
declare
  v_policies int;
  v_bad      text := '';
begin
  -- The two counts that make "nothing changes for anybody today" a fact rather
  -- than a hope. Either being non-zero means this migration would change who
  -- sees what on day one, and it must not.
  if (select count(*) from public.client_group_user_groups) <> 0 then
    raise exception 'A household is already in a user group — this migration would change who sees what on day one';
  end if;
  if (select count(*) from public.staff_users where limited_to_user_groups) <> 0 then
    raise exception 'Somebody is already limited — this migration would change who sees what on day one';
  end if;

  -- The backfill agrees with the column it came from, whatever the data.
  if exists (
    select 1 from public.client_groups g
     where g.user_group_id is not null
       and not exists (select 1 from public.client_group_user_groups l
                        where l.group_id = g.id and l.user_group_id = g.user_group_id)
  ) then
    raise exception 'The backfill missed a household';
  end if;

  -- Three policies, and NO update: a link exists or it does not.
  select count(*) into v_policies from pg_policies
   where schemaname = 'public' and tablename = 'client_group_user_groups';
  if v_policies <> 3 then
    raise exception 'client_group_user_groups should carry exactly three policies, found %', v_policies;
  end if;
  if exists (select 1 from pg_policies
              where schemaname = 'public' and tablename = 'client_group_user_groups'
                and cmd in ('UPDATE', 'ALL')) then
    raise exception 'client_group_user_groups must carry no update policy';
  end if;

  -- Exactly the grants the policies justify, and nothing for anon or public.
  -- `privilege_type` is information_schema.character_data, not text, and the
  -- array comparison finds no operator without the cast.
  if (select array_agg(privilege_type::text order by privilege_type::text)
        from information_schema.role_table_grants
       where table_schema = 'public' and table_name = 'client_group_user_groups'
         and grantee = 'authenticated') is distinct from array['DELETE', 'INSERT', 'SELECT'] then
    v_bad := v_bad || 'authenticated grants wrong; ';
  end if;
  if exists (select 1 from information_schema.role_table_grants
              where table_schema = 'public' and table_name = 'client_group_user_groups'
                and grantee in ('anon', 'PUBLIC')) then
    v_bad := v_bad || 'anon or PUBLIC hold something; ';
  end if;
  if v_bad <> '' then
    raise exception 'Privileges came back wrong: %', v_bad;
  end if;

  -- The access rule reads the SET, and no longer reads the single column.
  if (select p.prosrc from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = 'staff_can_access_group')
     not like '%client_group_user_groups%' then
    raise exception 'staff_can_access_group must read the link table';
  end if;
  if (select p.prosrc from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = 'staff_can_access_group')
     like '%g.user_group_id%' then
    raise exception 'staff_can_access_group must not still read client_groups.user_group_id';
  end if;

  -- The column SURVIVES. Dropping it here is what would break the deployed app.
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'client_groups'
                    and column_name = 'user_group_id') then
    raise exception 'client_groups.user_group_id must survive this migration — the deployed build reads it';
  end if;

  -- The view gained the arrays and kept the two transitional columns, in order.
  if (select array_agg(a.attname::text order by a.attnum)
        from pg_attribute a
       where a.attrelid = 'public.group_summary'::regclass and a.attnum > 0 and not a.attisdropped)
     is distinct from array['group_id','group_type','name','status','primary_contact','member_count',
                            'members','user_group_id','user_group_name','user_group_ids','user_group_names'] then
    raise exception 'group_summary came back with the wrong columns or the wrong order';
  end if;
  if not exists (select 1 from pg_class c
                  where c.oid = 'public.group_summary'::regclass
                    and c.reloptions @> array['security_invoker=true']) then
    raise exception 'group_summary lost security_invoker';
  end if;

  -- The three views that would have been lost to a drop are still here.
  if to_regclass('public.workflow_posts_summary') is null
     or to_regclass('public.group_account_posts') is null
     or to_regclass('public.group_policy_posts') is null then
    raise exception 'A view that depends on group_summary did not survive';
  end if;

  if public.audit_label_table('client_group_user_groups') <> 'client_groups' then
    raise exception 'The audit trail must name the household, not the link';
  end if;
  if not exists (select 1 from pg_trigger
                  where tgname = 'trg_client_group_user_groups_audit' and not tgisinternal) then
    raise exception 'The link table is not audited';
  end if;
  if not exists (select 1 from pg_trigger
                  where tgname = 'trg_client_group_user_groups_is_active' and not tgisinternal) then
    raise exception 'An archived user group is not refused';
  end if;
end $$;
