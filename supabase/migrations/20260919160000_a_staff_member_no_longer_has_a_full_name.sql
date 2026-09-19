-- A staff member no longer has a full name (19 Sep 2026)
--
-- M3, the last of three, and THE ONLY ONE-WAY STEP.
--
--   M1 → deploy the MCP function → deploy the app → M2 (views) → M3 (this file)
--
-- APPLY THIS ONLY ONCE BOTH DEPLOYS ARE CONFIRMED LIVE AND THE PREVIOUS BUILD
-- IS NOT ONE YOU WOULD STILL PROMOTE. M1 and M2 are each recoverable by
-- re-running the previous definitions. This file drops a column, and the names
-- in it exist nowhere else — a rollback would restore an empty column, not the
-- names. The transition trigger is what has kept the two representations in
-- step since M1, and it goes here too, so after this there is nothing left to
-- write `full_name` with even by hand.
--
-- ---------------------------------------------------------------------------
-- What is deliberately NOT removed
-- ---------------------------------------------------------------------------
-- `audit_record_label()` goes on reading a `full_name` key out of the payload,
-- FOREVER. `audit_log` is append-only: every staff change recorded before
-- 19 Sep 2026 carries that key and can never be rewritten, so the coalesce is
-- not transitional. It is the one place the string legitimately outlives the
-- column, and the closing sweep below whitelists it by name for that reason.
--
-- The same is true outside this database, in `auth.users.user_metadata`: an
-- account created before today carries `full_name` there, that metadata is not
-- ours to migrate, and `getRegistration()` in the app goes on accepting it.

-- ---------------------------------------------------------------------------
-- 1. The transition ends
-- ---------------------------------------------------------------------------

drop trigger if exists trg_staff_users_name_in_step on public.staff_users;
drop function if exists public.keep_staff_name_in_step();

-- The one-argument request function, dropped by signature. The two-argument
-- overload keeps its grant; arity is what tells them apart, and the deployed
-- request page has been calling the new one since the app shipped.
drop function if exists public.request_staff_access(text);

-- `split_staff_name()` existed to serve the backfill and the trigger, and both
-- are now gone. It is granted to `authenticated`, so leaving it behind would
-- leave an RPC on the API surface that nothing calls and no one maintains.
-- The rule it encoded is history: the split already happened, once, and cannot
-- happen again.
drop function if exists public.split_staff_name(text);

-- ---------------------------------------------------------------------------
-- 2. The feed's mention and reaction payloads carry ONE key
-- ---------------------------------------------------------------------------
-- Same columns, same order, same types — a replace, so the grants and the
-- `security_invoker` setting survive and the two children that select from it
-- are untouched. Only the JSON key inside `mentioned` and `reactions[].by`
-- changes: `full_name` goes, `name` stays.

create or replace view public.workflow_posts_summary
with (security_invoker = true) as
select p.id, p.workflow_id, p.task_id, p.author_staff_id,
       public.staff_display_name(sd.first_name, sd.last_name) as author_name,
       p.body, p.body_text, p.created_at,
       coalesce((select jsonb_agg(jsonb_build_object(
                          'staff_id', m.staff_id,
                          'name', public.staff_display_name(d.first_name, d.last_name))
                        order by d.last_name, d.first_name)
                   from public.workflow_post_mentions m
                   join public.staff_directory d on d.id = m.staff_id
                  where m.post_id = p.id), '[]'::jsonb) as mentioned,
       coalesce((select jsonb_agg(jsonb_build_object('reaction', r.reaction, 'by', r.by) order by r.first_at)
                   from (select x.reaction,
                                min(x.created_at) as first_at,
                                jsonb_agg(jsonb_build_object(
                                  'staff_id', x.staff_id,
                                  'name', public.staff_display_name(d.first_name, d.last_name)) order by x.created_at) as by
                           from public.workflow_post_reactions x
                           join public.staff_directory d on d.id = x.staff_id
                          where x.post_id = p.id
                          group by x.reaction) r), '[]'::jsonb) as reactions,
       coalesce((select jsonb_agg(jsonb_build_object(
                          'id', f.id, 'kind', f.kind, 'name', f.original_name,
                          'mime_type', f.mime_type, 'byte_size', f.byte_size,
                          'width', f.width, 'height', f.height,
                          'redacted_at', f.redacted_at,
                          'redacted_by_name', public.staff_display_name(rb.first_name, rb.last_name)) order by f.created_at)
                   from public.workflow_post_media f
                   left join public.staff_directory rb on rb.id = f.redacted_by
                  where f.post_id = p.id), '[]'::jsonb) as media,
       coalesce((select jsonb_agg(jsonb_build_object(
                          'kind', e.kind,
                          'entity_id', e.entity_id,
                          'label', case e.kind
                                     when 'client'   then (select c.display_name from public.clients c where c.party_id = e.entity_id)
                                     when 'group'    then (select g.name from public.group_summary g where g.group_id = e.entity_id)
                                     when 'workflow' then (select w.name from public.workflows w where w.id = e.entity_id)
                                   end) order by e.kind, e.entity_id)
                   from public.workflow_post_entities e
                  where e.post_id = p.id), '[]'::jsonb) as entities,
       p.parent_post_id,
       p.root_post_id,
       public.staff_display_name(pa.first_name, pa.last_name) as parent_author_name,
       p.account_id,
       p.policy_id
  from public.workflow_posts p
  left join public.staff_directory sd on sd.id = p.author_staff_id
  left join public.workflow_posts pp on pp.id = p.parent_post_id
  left join public.staff_directory pa on pa.id = pp.author_staff_id;

comment on view public.workflow_posts_summary is
  'Posts with the author named, mentions resolved to current names, reactions grouped by kind with who gave each, the media each post carries, the entities it names, and its place in a thread — parent_post_id, root_post_id and the name of the person being answered. Carries account_id since 17 Sep 2026 and policy_id since 19 Sep 2026; exactly one of workflow_id, account_id and policy_id is set. A mentioned or reacting person is given as staff_id and name. security_invoker: RLS on workflow_posts decides, deferring to the workflow, to staff_can_access_account() or to staff_can_access_policy().';

-- ---------------------------------------------------------------------------
-- 3. The write paths stop accepting it
-- ---------------------------------------------------------------------------
-- Restated only to take `full_name` out of the whitelist and off the UPDATE.
-- An old caller now gets 'Unknown field in patch: full_name' — a sentence — in
-- place of a 500 from a column that is not there.

create or replace function public.update_staff_patch(p_staff_id uuid, p_patch jsonb)
returns text
language plpgsql
security invoker
set search_path to ''
as $fn$
declare
  v_keys         text[] := array['first_name', 'last_name', 'email', 'status', 'profile_id', 'avatar_path'];
  v_key          text;
  cur            record;
  v_first        text;
  v_last         text;
  v_email        text;
  v_status       text;
  v_profile      uuid;
  v_avatar       text;
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

  if p_patch ?| array['first_name', 'last_name', 'email', 'status', 'avatar_path'] then
    update public.staff_users su
       set first_name  = coalesce(v_first, su.first_name),
           last_name   = coalesce(v_last, su.last_name),
           email       = coalesce(v_email, su.email),
           status      = case when p_patch ? 'status' then v_status::public.staff_status else su.status end,
           avatar_path = case when p_patch ? 'avatar_path' then v_avatar else su.avatar_path end
     where su.id = p_staff_id;
    get diagnostics v_rows = row_count;
    if v_rows = 0 then
      raise exception 'You do not have permission to change this staff member';
    end if;
  end if;

  if p_patch ? 'profile_id' then
    insert into public.staff_access_assignments (staff_id, profile_id)
    values (p_staff_id, v_profile)
    on conflict (staff_id) do update
      set profile_id = excluded.profile_id
      where staff_access_assignments.profile_id is distinct from excluded.profile_id;
  end if;

  return case when p_patch ? 'avatar_path' and cur.avatar_path is distinct from v_avatar then cur.avatar_path end;
end $fn$;

comment on function public.update_staff_patch(uuid, jsonb) is
  'Change a staff member: first_name, last_name, email, status, profile_id and avatar_path, by key presence; unknown keys refused. Email is the CRM address, not the sign-in email. Refuses deactivating yourself and removing the last active administrator (both also enforced by triggers). Returns the photo path it replaced or removed, or null.';

-- The request function is restated for one reason: its body carried a comment
-- naming the transition trigger, which no longer exists. Nothing else changes.
-- The sweep at the bottom cannot tell a stale comment from a live reference,
-- and a sweep with exceptions in it stops being worth running.

create or replace function public.request_staff_access(p_first_name text, p_last_name text)
returns uuid
language plpgsql
security definer
set search_path to ''
as $fn$
declare
  v_uid       uuid;
  v_email     text;
  v_confirmed timestamptz;
  v_domain    text;
  v_first     text;
  v_last      text;
  v_id        uuid;
  v_status    text;
begin
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'Not signed in';
  end if;

  select lower(btrim(u.email)), u.email_confirmed_at
    into v_email, v_confirmed
    from auth.users u
   where u.id = v_uid;
  if v_email is null then
    raise exception 'Not signed in';
  end if;
  if v_confirmed is null then
    raise exception 'Confirm your email address first';
  end if;

  v_domain := split_part(v_email, '@', 2);
  if not exists (select 1 from public.staff_email_domains d where d.domain = v_domain) then
    raise exception 'Access requests are limited to Q Wealth staff email addresses';
  end if;

  -- 60 characters each, a rule per field rather than one over a whole name.
  v_first := btrim(regexp_replace(coalesce(p_first_name, ''), '\s+', ' ', 'g'));
  v_last  := btrim(regexp_replace(coalesce(p_last_name,  ''), '\s+', ' ', 'g'));
  if v_first = '' or v_last = '' then
    raise exception 'Enter a first name and a last name';
  end if;
  if length(v_first) > 60 or length(v_last) > 60 then
    raise exception 'That name is too long';
  end if;

  select su.id, su.status::text into v_id, v_status
    from public.staff_users su
   where su.auth_user_id = v_uid;
  if found then
    if v_status = 'pending' then
      return v_id;
    end if;
    raise exception 'This account already belongs to a staff record — contact an administrator';
  end if;
  if exists (select 1 from public.staff_users su where lower(su.email) = v_email) then
    raise exception 'A staff record with this email already exists — contact an administrator';
  end if;

  insert into public.staff_users (auth_user_id, email, first_name, last_name, status)
  values (v_uid, v_email, v_first, v_last, 'pending')
  returning id into v_id;
  return v_id;
end $fn$;

comment on function public.request_staff_access(text, text) is
  'A signed-in, email-confirmed person on an allowed domain asks to join the staff, giving their name in two parts. The sole signature since 19 Sep 2026.';

revoke all on function public.request_staff_access(text, text) from public, anon;
grant execute on function public.request_staff_access(text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. The column goes
-- ---------------------------------------------------------------------------

alter table public.staff_users drop column full_name;

-- ---------------------------------------------------------------------------
-- 5. Sweep, or abort
-- ---------------------------------------------------------------------------
-- The column being gone is the easy half. The half worth asserting is that
-- nothing still NAMES it — a JSON key left behind in a view, or a view rebuilt
-- from a stale copy of an older definition, neither of which the drop above
-- would have complained about, because neither is a real dependency.
--
-- `audit_record_label` is whitelisted by name, and it is the only whitelist.

do $$
declare
  v_names text[] := array['staff_directory','audit_entries','group_notes_summary',
                          'identity_verification_summary','workflow_board','workflow_posts_summary',
                          'workflow_task_actions_summary','workflow_tasks_summary',
                          'group_account_posts','group_policy_posts'];
  v_name text;
  v_bad  text := '';
begin
  if exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'staff_users' and column_name = 'full_name') then
    raise exception 'staff_users.full_name is still there';
  end if;

  foreach v_name in array v_names loop
    if to_regclass('public.' || v_name) is null then
      raise exception 'View public.% is missing', v_name;
    end if;
    if pg_get_viewdef(('public.' || v_name)::regclass, true) like '%full_name%' then
      v_bad := v_bad || 'view ' || v_name || '; ';
    end if;
  end loop;

  select v_bad || coalesce(string_agg('function ' || p.oid::regprocedure::text || '; ', ''), '')
    into v_bad
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.prokind = 'f'
     and p.prosrc like '%full_name%'
     and p.proname <> 'audit_record_label';

  if v_bad <> '' then
    raise exception 'These still name full_name: %', v_bad;
  end if;

  -- And the one that must: the audit trail reads payloads it can never rewrite.
  if (select p.prosrc from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = 'audit_record_label') not like '%full_name%' then
    raise exception 'audit_record_label must go on reading the pre-split payload shape';
  end if;

  if to_regprocedure('public.request_staff_access(text)') is not null then
    raise exception 'The one-argument request_staff_access is still there';
  end if;
  if exists (select 1 from pg_trigger where tgname = 'trg_staff_users_name_in_step') then
    raise exception 'The transition trigger is still there';
  end if;
end $$;
