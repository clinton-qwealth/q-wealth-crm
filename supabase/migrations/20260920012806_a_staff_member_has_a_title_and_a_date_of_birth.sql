-- A staff member has a title and a date of birth (20 Sep 2026)
--
-- Two optional facts about a staff member, asked for by Clinton on 20 September.
-- Both are optional: neither is required to work here, and neither is asked for
-- at registration.
--
-- ## Why they land in two different places
--
-- `staff_users` is readable by EVERY active staff member — `staff_read_staff_users`
-- says `is_active_staff()`, and it says so deliberately, so a colleague can be
-- named in a picker or an audit row. That is the right rule for a name and a
-- title. It is the wrong rule for a date of birth: nothing about naming a
-- colleague needs their birthday, and a row every colleague can read through the
-- API is a row every colleague can read, whatever the screens choose to show.
--
-- So `title` goes on the record, and `date_of_birth` goes in a side table that
-- only an administrator or the person themselves may read. Decided with Clinton
-- on 20 September, over the simpler option of two columns on one table.
--
-- ## The vocabulary is the client one
--
-- `persons.title` is free text and `persons.date_of_birth` is a `date`, and
-- staff get the same: a title is a salutation somebody typed, and a date of
-- birth is a calendar date with no timezone. The app renders both with the same
-- helpers it uses for a client.

-- ---------------------------------------------------------------------------
-- 1. The title, on the record
-- ---------------------------------------------------------------------------

alter table public.staff_users
  add column title text;

comment on column public.staff_users.title is
  'Salutation — Mr, Ms, Dr. Optional, free text like persons.title. Trimmed and capped at 30 characters by update_staff_patch(); blank clears it. Added 20 Sep 2026.';

-- ---------------------------------------------------------------------------
-- 2. The date of birth, in a table only an administrator or the person reads
-- ---------------------------------------------------------------------------

create table public.staff_private_details (
  staff_id      uuid primary key references public.staff_users(id) on delete cascade,
  date_of_birth date,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

comment on table public.staff_private_details is
  'Facts about a staff member that colleagues have no reason to see. One row per person, keyed by staff_id, created on first write. Readable by the person and by administrators only — staff_users itself is readable by every active staff member, which is why these are not columns on it. Added 20 Sep 2026.';
comment on column public.staff_private_details.date_of_birth is
  'A calendar date, no timezone — the same type as persons.date_of_birth, rendered by the same helper. update_staff_patch() refuses a future date and one more than 120 years back; blank clears it.';

create trigger trg_staff_private_details_updated_at
  before update on public.staff_private_details
  for each row execute function public.set_updated_at();

-- Audited under the PERSON: the key column is staff_id, which is the staff_users
-- id, and audit_label_table() maps this table to staff_users below, so the trail
-- shows the person's name rather than a row nobody has a name for.
create trigger trg_staff_private_details_audit
  after insert or update or delete on public.staff_private_details
  for each row execute function public.record_audit('staff_id', '');

alter table public.staff_private_details enable row level security;

create policy staff_private_details_read on public.staff_private_details
  for select to authenticated
  using (staff_id = public.current_staff_id() or public.current_staff_has('manage_staff'));

create policy admin_insert_staff_private_details on public.staff_private_details
  for insert to authenticated
  with check (public.current_staff_has('manage_staff'));

create policy admin_update_staff_private_details on public.staff_private_details
  for update to authenticated
  using (public.current_staff_has('manage_staff'))
  with check (public.current_staff_has('manage_staff'));

-- No delete policy and no delete grant: nothing in the app deletes a row here.
-- A person's row goes when their staff record goes, by the cascade, which runs
-- with the table owner's privileges rather than the caller's.

-- A new table arrives holding the full default set for authenticated. Take it
-- back to exactly what the three policies above justify.
revoke all on public.staff_private_details from public, anon, authenticated;
grant select, insert, update on public.staff_private_details to authenticated;

-- ---------------------------------------------------------------------------
-- 3. The audit trail names the person for a private-details row
-- ---------------------------------------------------------------------------

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
    else p_table
  end
$fn$;

-- ---------------------------------------------------------------------------
-- 4. The patch function writes both
-- ---------------------------------------------------------------------------
-- Same contract as every other key: presence is the instruction, and a present
-- blank CLEARS the value rather than being refused — a title or a birthday is
-- something a person may not wish to record, and "remove it" has to be sayable.
-- The date is checked as a date, not as a string: a future birthday and one more
-- than 120 years back are both typing errors, and the second is the common one
-- (a two-digit year read as 0026).

create or replace function public.update_staff_patch(p_staff_id uuid, p_patch jsonb)
returns text
language plpgsql
security invoker
set search_path to ''
as $fn$
declare
  v_keys         text[] := array['first_name', 'last_name', 'email', 'status', 'profile_id', 'avatar_path',
                                 'verify_identity', 'title', 'date_of_birth'];
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
      -- wrong day is worse than one that is refused. Found by probe on the
      -- branch before this reached production.
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

  if p_patch ?| array['first_name', 'last_name', 'email', 'status', 'avatar_path', 'verify_identity', 'title'] then
    update public.staff_users su
       set first_name      = coalesce(v_first, su.first_name),
           last_name       = coalesce(v_last, su.last_name),
           email           = coalesce(v_email, su.email),
           status          = case when p_patch ? 'status' then v_status::public.staff_status else su.status end,
           avatar_path     = case when p_patch ? 'avatar_path' then v_avatar else su.avatar_path end,
           verify_identity = case when p_patch ? 'verify_identity' then v_verify else su.verify_identity end,
           title           = case when p_patch ? 'title' then v_title else su.title end
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

  return case when p_patch ? 'avatar_path' and cur.avatar_path is distinct from v_avatar then cur.avatar_path end;
end $fn$;

comment on function public.update_staff_patch(uuid, jsonb) is
  'Change a staff member: first_name, last_name, title, email, status, profile_id, avatar_path, verify_identity and date_of_birth, by key presence; unknown keys refused. A present-and-blank title or date_of_birth clears it. verify_identity must be a JSON boolean. date_of_birth is written to staff_private_details, which only the person and administrators may read. Email is the CRM address, not the sign-in email. Refuses deactivating yourself and removing the last active administrator (both also enforced by triggers). Returns the photo path it replaced or removed, or null.';

-- ---------------------------------------------------------------------------
-- 5. Prove it, or abort
-- ---------------------------------------------------------------------------

do $$
declare
  v_grants text;
begin
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'staff_users' and column_name = 'title') then
    raise exception 'staff_users.title was not added';
  end if;

  if not exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
                  where n.nspname = 'public' and c.relname = 'staff_private_details' and c.relrowsecurity) then
    raise exception 'staff_private_details is missing or does not have row-level security on';
  end if;

  if (select count(*) from pg_policies where schemaname = 'public' and tablename = 'staff_private_details') <> 3 then
    raise exception 'staff_private_details should carry exactly three policies';
  end if;

  -- authenticated holds exactly what the policies justify; anon and public hold nothing.
  select string_agg(privilege_type, ',' order by privilege_type) into v_grants
    from information_schema.role_table_grants
   where table_schema = 'public' and table_name = 'staff_private_details' and grantee = 'authenticated';
  if v_grants is distinct from 'INSERT,SELECT,UPDATE' then
    raise exception 'authenticated holds % on staff_private_details, expected INSERT,SELECT,UPDATE', coalesce(v_grants, 'nothing');
  end if;
  if exists (select 1 from information_schema.role_table_grants
              where table_schema = 'public' and table_name = 'staff_private_details' and grantee in ('anon', 'PUBLIC')) then
    raise exception 'anon or PUBLIC holds a privilege on staff_private_details';
  end if;

  if not exists (select 1 from pg_trigger where tgname = 'trg_staff_private_details_audit') then
    raise exception 'staff_private_details is not audited';
  end if;

  if public.audit_label_table('staff_private_details') <> 'staff_users' then
    raise exception 'audit_label_table does not map the private details to the person';
  end if;

  if (select prosrc from pg_proc where proname = 'update_staff_patch' and pronamespace = 'public'::regnamespace)
     not like '%''date_of_birth''%' then
    raise exception 'update_staff_patch does not accept date_of_birth';
  end if;
end $$;
