-- Staff can be managed (19 Sep 2026)
--
-- The Administration page gets a Staff tab: an administrator may change a
-- colleague's name, email, status, access profile and photo. Until today none
-- of that could be done through the app; the profile page said so.
--
-- WHAT IS ALREADY TRUE, AND WHAT THAT FORCES. RLS has permitted administrators
-- to UPDATE staff_users and to write staff_access_assignments since July, so a
-- PostgREST call or a psql session can already do everything this tab does.
-- The two rules that are NEW — you may not switch yourself off, and an active
-- administrator must always remain — therefore cannot live only in a function
-- the app calls. They live in TRIGGERS on the tables, where every path meets,
-- and the function repeats them up front so the screen gets a sentence rather
-- than a half-written change. The RLS policy says who; the trigger says what.
--
-- THE LAST-ADMINISTRATOR CHECK IS SECURITY DEFINER, and the reason is a trap
-- worth writing down. An administrator changing their OWN profile to a lesser
-- one loses `manage_staff` mid-transaction; from then on the assignment table's
-- policy shows them only their own row, and an invoker check for "does any
-- administrator remain" would see nobody and refuse even when a colleague is
-- an administrator. The trigger reads past RLS; the function predicts BEFORE
-- it writes. Both bypass an elevated context, so the dashboard remains the way
-- out of a lockout.
--
-- EMAIL IS EDITABLE KNOWINGLY. It is the CRM's contact and notification
-- address, and Clinton wants it for notifications later. It is NOT the Supabase
-- Auth sign-in email — that lives in auth.users and nothing syncs the two —
-- and the screen says so beside the field.
--
-- THE PHOTO is one nullable column holding a storage object path, in a private
-- bucket that follows post-media's shape: the bucket carries the size and type
-- limits so Storage refuses a bad body before any policy runs, the path is
-- pinned to the staff member's own id by a check constraint so a row can never
-- point outside its prefix, and the bytes are served only through a route that
-- re-checks access and redirects to a short-lived signed URL. SVG is absent on
-- purpose: it can carry script.
--
-- DEPLOY ORDER: this migration BEFORE the app that selects avatar_path. The
-- other way round, getCurrentStaff()'s select errors, returns null, and every
-- staff member is redirected to the login page. Everything here is additive,
-- so migration-first is safe against the app already deployed.

-- ---------------------------------------------------------------------------
-- 1. The photo column
-- ---------------------------------------------------------------------------

alter table public.staff_users add column avatar_path text;

alter table public.staff_users add constraint staff_users_avatar_path_is_own_prefix check (
  avatar_path is null
  or avatar_path ~ ('^' || id::text || '/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(png|jpg|webp)$')
);

comment on column public.staff_users.avatar_path is
  'Object path in the private staff-avatars bucket, <staff id>/<uuid>.<png|jpg|webp>, pinned to this row''s own id by check constraint. Served only through /api/staff-avatar/[staffId], which re-checks access and signs a short-lived URL. Null when no photo. Added 19 Sep 2026.';
comment on column public.staff_users.email is
  'The CRM''s contact and notification address for this person. NOT the Supabase Auth sign-in email: that lives in auth.users and nothing syncs the two. Editable by administrators through update_staff_patch() since 19 Sep 2026.';

-- ---------------------------------------------------------------------------
-- 2. The closed lists, written once (post-media''s shape)
-- ---------------------------------------------------------------------------

create or replace function public.staff_avatar_size_limit() returns bigint
language sql immutable set search_path = '' as $$ select 2097152::bigint $$;
comment on function public.staff_avatar_size_limit() is
  'The largest photo a staff member may carry, in bytes (2 MB). Used by the staff-avatars bucket so the bucket and the client cannot disagree.';

create or replace function public.staff_avatar_mime_types() returns text[]
language sql immutable set search_path = '' as $$
  select array['image/png', 'image/jpeg', 'image/webp']::text[]
$$;
comment on function public.staff_avatar_mime_types() is
  'What a staff photo may be. SVG is absent ON PURPOSE: it can carry script. GIF is absent because a photo does not move.';

revoke all on function public.staff_avatar_size_limit() from public, anon;
revoke all on function public.staff_avatar_mime_types() from public, anon;
grant execute on function public.staff_avatar_size_limit() to authenticated;
grant execute on function public.staff_avatar_mime_types() to authenticated;

-- ---------------------------------------------------------------------------
-- 3. The bucket and its policies
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('staff-avatars', 'staff-avatars', false,
        public.staff_avatar_size_limit(), public.staff_avatar_mime_types())
on conflict (id) do update
  set public             = false,
      file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Any active staff member may see a colleague's photo: it is shown beside
-- their name across the CRM.
create policy staff_avatars_read on storage.objects
  for select to authenticated
  using (bucket_id = 'staff-avatars' and public.is_active_staff());

-- Only an administrator writes, and only under a REAL staff id's prefix. The
-- folder is compared as TEXT: a malformed folder must be a refusal, not a
-- cast error. (A person uploading their OWN photo is a later change: one more
-- disjunct here and a branch in the function.)
create policy staff_avatars_write on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'staff-avatars'
    and public.current_staff_has('manage_staff')
    and exists (select 1 from public.staff_users su where su.id::text = (storage.foldername(name))[1])
  );

create policy staff_avatars_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'staff-avatars' and public.current_staff_has('manage_staff'));

-- No update policy: an object is written once. A new photo is a new path.

-- ---------------------------------------------------------------------------
-- 4. The two rules, on the tables
-- ---------------------------------------------------------------------------

create or replace function public.enforce_staff_self_preservation()
returns trigger
language plpgsql
set search_path = ''
as $fn$
begin
  if public.is_elevated_context() then
    return new;
  end if;
  if old.status = 'active' and new.status <> 'active' and old.id = public.current_staff_id() then
    raise exception 'You cannot deactivate your own account';
  end if;
  return new;
end $fn$;

create trigger trg_staff_users_self_preservation
  before update on public.staff_users
  for each row execute function public.enforce_staff_self_preservation();

comment on function public.enforce_staff_self_preservation() is
  'BEFORE UPDATE on staff_users: the signed-in staff member may not move their own row off active. On the table so a direct update is refused too. Elevated context bypasses it. Added 19 Sep 2026.';

-- Deferred, and on all three tables that decide who is an administrator: a
-- person's status, their assignment, and the profile's own flag. At COMMIT an
-- active holder of manage_staff must exist. SECURITY DEFINER for the reason in
-- the header: the check must see every row, whatever the caller just did to
-- their own access.
create or replace function public.enforce_an_administrator_remains()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  if public.is_elevated_context() then
    return null;
  end if;
  if not exists (
    select 1
      from public.staff_users su
      join public.staff_access_assignments saa on saa.staff_id = su.id
      join public.access_profiles ap on ap.id = saa.profile_id
     where su.status = 'active' and ap.manage_staff
  ) then
    raise exception 'At least one active administrator must remain';
  end if;
  return null;
end $fn$;

create constraint trigger trg_staff_users_administrator_remains
  after update or delete on public.staff_users
  deferrable initially deferred
  for each row execute function public.enforce_an_administrator_remains();

create constraint trigger trg_staff_access_assignments_administrator_remains
  after insert or update or delete on public.staff_access_assignments
  deferrable initially deferred
  for each row execute function public.enforce_an_administrator_remains();

create constraint trigger trg_access_profiles_administrator_remains
  after update or delete on public.access_profiles
  deferrable initially deferred
  for each row execute function public.enforce_an_administrator_remains();

comment on function public.enforce_an_administrator_remains() is
  'Deferred constraint trigger on staff_users, staff_access_assignments and access_profiles: at COMMIT an active staff member holding manage_staff must exist, or the transaction is refused. Reads past RLS on purpose. Elevated context bypasses it, so the dashboard is the recovery from a lockout. Added 19 Sep 2026.';

-- Trigger functions run on the table owner''s behalf; no role needs EXECUTE.
revoke all on function public.enforce_staff_self_preservation() from public, anon, authenticated;
revoke all on function public.enforce_an_administrator_remains() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. The one write path the app uses
-- ---------------------------------------------------------------------------
-- Patch-shaped, like update_financial_account_patch: key presence decides,
-- unknown keys are refused, every refusal is a sentence. Returns the photo
-- path this call REPLACED or REMOVED, or null, so the caller can delete the
-- bytes afterwards — the row first, the bytes second, as redact_post_media
-- does.

create or replace function public.update_staff_patch(p_staff_id uuid, p_patch jsonb)
returns text
language plpgsql
security invoker
set search_path to ''
as $fn$
declare
  v_keys         text[] := array['full_name', 'email', 'status', 'profile_id', 'avatar_path'];
  v_key          text;
  cur            record;
  v_name         text;
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

  -- Through RLS, so a row outside the caller''s access is a sentence.
  select su.id, su.status::text as status, su.avatar_path, saa.profile_id
    into cur
    from public.staff_users su
    left join public.staff_access_assignments saa on saa.staff_id = su.id
   where su.id = p_staff_id;
  if not found then
    raise exception 'No such staff member, or not one you have access to';
  end if;

  if p_patch ? 'full_name' then
    v_name := btrim(p_patch->>'full_name');
    if coalesce(v_name, '') = '' then
      raise exception 'A staff member needs a name';
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
    -- Text comparisons, so this reads correctly before AND after the day the
    -- enum gains 'pending'.
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
      -- Bytes first, then the row — the inverse of post-media, and sound here
      -- because the write policy already scopes the path to administrators
      -- and to real staff ids.
      if not exists (select 1 from storage.objects o where o.bucket_id = 'staff-avatars' and o.name = v_avatar) then
        raise exception 'That photo has not been uploaded';
      end if;
    end if;
  end if;

  -- The last administrator, PREDICTED before any write. See the header for
  -- why an after-the-fact check inside this invoker function would lie.
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

  if p_patch ?| array['full_name', 'email', 'status', 'avatar_path'] then
    update public.staff_users su
       set full_name   = coalesce(v_name, su.full_name),
           email       = coalesce(v_email, su.email),
           status      = case when p_patch ? 'status' then v_status::public.staff_status else su.status end,
           avatar_path = case when p_patch ? 'avatar_path' then v_avatar else su.avatar_path end
     where su.id = p_staff_id;
    get diagnostics v_rows = row_count;
    if v_rows = 0 then
      raise exception 'You do not have permission to change this staff member';
    end if;
  end if;

  -- LAST, after the staff row: if the caller is changing their own profile,
  -- this is the write that takes their manage_staff away.
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
  'Change a staff member: full_name, email, status, profile_id and avatar_path, by key presence; unknown keys refused. Email is the CRM address, not the sign-in email. Refuses deactivating yourself and removing the last active administrator (both also enforced by triggers). Returns the photo path it replaced or removed, or null, so the caller can delete the bytes. Added 19 Sep 2026.';

revoke all on function public.update_staff_patch(uuid, jsonb) from public, anon;
grant execute on function public.update_staff_patch(uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. The directory carries the photo — appended LAST
-- ---------------------------------------------------------------------------

create or replace view public.staff_directory
with (security_invoker = true) as
  select su.id, su.full_name, su.email, su.status, su.avatar_path
  from public.staff_users su;

comment on view public.staff_directory is
  'A least-exposure convenience over staff_users, not an access boundary; security_invoker so the caller''s own RLS applies. Carries avatar_path since 19 Sep 2026 so a name anywhere can grow a photo later without a migration.';

revoke all on public.staff_directory from public, anon;
grant select on public.staff_directory to authenticated;
