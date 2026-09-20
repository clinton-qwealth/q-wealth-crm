-- Verifying a client's identity is granted to a PERSON, not to a profile (20 Sep 2026)
--
-- `verify_identity` has been a column on `access_profiles` since 3 September:
-- whoever sat on Adviser or Services could send a client a one-time code and
-- record the outcome; whoever sat on Management or Admin could not. That put the
-- decision "may this person telephone a client and spend money doing it" one
-- step away from the person — it was a property of the role they happened to
-- hold, and moving somebody's role to change it would have changed everything
-- else about their access too.
--
-- Clinton asked on 20 September for it to be a toggle on the individual instead,
-- so an administrator can opt any one staff member in or out from the Staff tab
-- without touching their profile. The immediate cause was the anomaly the
-- Security Structure page had flagged since the 3rd: Admin holds every
-- permission except this one, nobody held Admin then, and now two people do.
--
-- ## What this file does, and what it deliberately does not
--
-- THIS FILE IS ADDITIVE. It is the first of two, and the deployed app keeps
-- working throughout:
--
--   M1 (this file): add the column to staff_users, backfill it, switch the
--                   permission check to read it, teach the patch function the
--                   new key. `access_profiles.verify_identity` STAYS — the
--                   deployed app selects it on every page load.
--   deploy the app: reads the person's flag, offers the toggle, stops
--                   selecting the profile column.
--   M2:             drop `access_profiles.verify_identity`.
--
-- Same shape as the 31 August outage's remedy, and for the same reason: the
-- production edge logs show the deployed build asking PostgREST for
-- `access_profiles(... verify_identity)` on every request. Drop that column
-- first and every page fails with a 400 until the deploy lands.
--
-- ## The backfill preserves exactly who can verify today
--
-- Every active person on a profile that grants it is opted in; nobody else is.
-- So on the day this lands the answer to "may this person verify?" is identical
-- for every staff member, and the change is purely WHERE that answer is stored.
-- Anything else — granting it to Admin, say — is a decision to take on the Staff
-- tab afterwards, recorded in the audit trail with the administrator's name on
-- it, not a side effect of a migration.
--
-- ## Why the same column name
--
-- `current_staff_has('verify_identity')` is the single choke point: the five
-- verification write paths all ask it by that string, and none reads a column
-- directly (checked in the catalogue before this was written). Keeping the name
-- means the string stays true and those five functions do not change at all.

-- ---------------------------------------------------------------------------
-- 1. The column, and the backfill
-- ---------------------------------------------------------------------------

alter table public.staff_users
  add column verify_identity boolean not null default false;

comment on column public.staff_users.verify_identity is
  'May send an identity-verification code to a client and record the outcome. Granted per person by an administrator on the Staff tab since 20 Sep 2026; was a property of the access profile before that. Separate from manage_groups because it spends money, contacts clients directly, and the recorded outcome becomes evidence. Access scope still applies on top: holding this does not widen which clients are reachable. Defaults to false — nobody acquires it by being approved.';

-- Everyone who can verify today keeps being able to. Only active people are
-- backfilled: an inactive record has no access to preserve, and re-activating
-- one is an administrator's decision that can include this flag.
update public.staff_users su
   set verify_identity = true
  from public.staff_access_assignments saa
  join public.access_profiles ap on ap.id = saa.profile_id
 where saa.staff_id = su.id
   and su.status = 'active'
   and ap.verify_identity;

-- The backfill queues deferred constraint-trigger events on staff_users
-- (`enforce_an_administrator_remains`), and the DDL below would refuse them.
-- Same lesson as the name split on the 19th.
set constraints all immediate;

-- ---------------------------------------------------------------------------
-- 2. The permission check reads the person
-- ---------------------------------------------------------------------------
-- One arm of the CASE changes: `ap.verify_identity` becomes `su.verify_identity`.
-- The join to the profile stays for the other five, and the row is still
-- required to be active — an inactive person holds nothing, whatever the flag.

create or replace function public.current_staff_has(p_permission text)
returns boolean
language plpgsql
stable
security definer
set search_path to ''
as $fn$
declare
  v_ok boolean;
begin
  if public.is_elevated_context() then
    return true;
  end if;
  select case p_permission
           when 'view_sensitive' then ap.view_sensitive
           when 'view_all_groups' then ap.view_all_groups
           when 'manage_groups' then ap.manage_groups
           when 'manage_staff' then ap.manage_staff
           when 'admin' then ap.manage_staff
           when 'file_unmatched_notes' then ap.file_unmatched_notes
           -- The person's own flag since 20 Sep 2026, not the profile's.
           when 'verify_identity' then su.verify_identity
           else false
         end
    into v_ok
  from public.staff_users su
  join public.staff_access_assignments saa on saa.staff_id = su.id
  join public.access_profiles ap on ap.id = saa.profile_id
  where su.auth_user_id = (select auth.uid())
    and su.status = 'active';
  return coalesce(v_ok, false);
end;
$fn$;

revoke all on function public.current_staff_has(text) from public, anon;
grant execute on function public.current_staff_has(text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. The patch function accepts the flag
-- ---------------------------------------------------------------------------
-- Restated with one more whitelisted key. The value must be a JSON boolean:
-- a string 'false' is truthy in half the languages that will ever call this,
-- and a permission that can be switched on by accident is not a permission.
-- Row-level security already lets an administrator update staff_users
-- directly, so this is the friendlier of two identical answers, not the only one.

create or replace function public.update_staff_patch(p_staff_id uuid, p_patch jsonb)
returns text
language plpgsql
security invoker
set search_path to ''
as $fn$
declare
  v_keys         text[] := array['first_name', 'last_name', 'email', 'status', 'profile_id', 'avatar_path', 'verify_identity'];
  v_key          text;
  cur            record;
  v_first        text;
  v_last         text;
  v_email        text;
  v_status       text;
  v_profile      uuid;
  v_avatar       text;
  v_verify       boolean;
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

  if p_patch ? 'verify_identity' then
    if jsonb_typeof(p_patch->'verify_identity') <> 'boolean' then
      raise exception 'verify_identity must be true or false';
    end if;
    v_verify := (p_patch->>'verify_identity')::boolean;
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

  if p_patch ?| array['first_name', 'last_name', 'email', 'status', 'avatar_path', 'verify_identity'] then
    update public.staff_users su
       set first_name      = coalesce(v_first, su.first_name),
           last_name       = coalesce(v_last, su.last_name),
           email           = coalesce(v_email, su.email),
           status          = case when p_patch ? 'status' then v_status::public.staff_status else su.status end,
           avatar_path     = case when p_patch ? 'avatar_path' then v_avatar else su.avatar_path end,
           verify_identity = case when p_patch ? 'verify_identity' then v_verify else su.verify_identity end
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
  'Change a staff member: first_name, last_name, email, status, profile_id, avatar_path and verify_identity, by key presence; unknown keys refused. verify_identity must be a JSON boolean. Email is the CRM address, not the sign-in email. Refuses deactivating yourself and removing the last active administrator (both also enforced by triggers). Returns the photo path it replaced or removed, or null.';

-- ---------------------------------------------------------------------------
-- 4. Prove it, or abort
-- ---------------------------------------------------------------------------

do $$
declare
  v_lost int;
  v_gained int;
begin
  -- Nobody who could verify yesterday has lost it, and nobody has gained it.
  select count(*) into v_lost
    from public.staff_users su
    join public.staff_access_assignments saa on saa.staff_id = su.id
    join public.access_profiles ap on ap.id = saa.profile_id
   where su.status = 'active' and ap.verify_identity and not su.verify_identity;
  if v_lost > 0 then
    raise exception '% active staff who could verify through their profile were not backfilled', v_lost;
  end if;

  select count(*) into v_gained
    from public.staff_users su
    left join public.staff_access_assignments saa on saa.staff_id = su.id
    left join public.access_profiles ap on ap.id = saa.profile_id
   where su.verify_identity and not coalesce(ap.verify_identity, false);
  if v_gained > 0 then
    raise exception '% staff gained verify_identity that their profile did not grant', v_gained;
  end if;

  -- The permission check now reads the person and not the profile.
  if (select prosrc from pg_proc where proname = 'current_staff_has' and pronamespace = 'public'::regnamespace)
     not like '%then su.verify_identity%' then
    raise exception 'current_staff_has still reads verify_identity from the profile';
  end if;

  -- The patch function knows the key.
  if (select prosrc from pg_proc where proname = 'update_staff_patch' and pronamespace = 'public'::regnamespace)
     not like '%''verify_identity''%' then
    raise exception 'update_staff_patch does not accept verify_identity';
  end if;

  -- And the profile column is STILL THERE — the deployed app reads it. M2 drops it.
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'access_profiles' and column_name = 'verify_identity') then
    raise exception 'access_profiles.verify_identity must survive M1 — the deployed app selects it';
  end if;
end $$;
