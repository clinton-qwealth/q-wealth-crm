-- A person can ask to join the staff (19 Sep 2026)
--
-- Until today a staff member was created by hand: an account invited from the
-- Supabase dashboard, then two rows inserted by SQL. Clinton asked for people to
-- register themselves and for an administrator to approve them with a profile.
--
-- WHY SELF-REGISTRATION IS SAFE HERE. Everything granted to a signed-in user is
-- already fail-closed on an ACTIVE staff row with an assignment. A stranger who
-- creates an account and confirms an email can do exactly one thing: create one
-- pending row, which an administrator sees and declines. Three bounds keep even
-- that small: the email must be CONFIRMED (this function reads
-- auth.users.email_confirmed_at itself, so the rule holds even if the dashboard
-- toggle is later flipped); the domain must be on an allow-list this file
-- creates; and one account gets one request — a repeat returns the same row,
-- and an account that already belongs to any other staff record is refused
-- outright, so a declined person cannot re-request into the queue.
--
-- THE SERVICE-ROLE KEY IS NOT INVOLVED. `request_staff_access()` is SECURITY
-- DEFINER because staff_users' insert policy is administrator-only and must stay
-- that way; the function inserts as owner, checks everything above first, and
-- writes only the one row shape. The audit trigger records the row with
-- actor_staff_id null and actor_auth_user_id set — the truthful record that a
-- not-yet-staff account created it.
--
-- A PENDING PERSON CAN READ THEIR OWN ROW. `staff_read_own_row` lets the
-- request page and the consent screen show "awaiting approval" through the same
-- readers everything else uses. Policies OR, so active staff keep the existing
-- rule; the pending person sees one row: theirs.
--
-- APPROVAL is one function, one transaction: status to active and the
-- assignment inserted together, through the administrator's own RLS, so the
-- audit trail names who approved. Decline is `update_staff_patch(...'inactive')`
-- from the morning's migration, whose status rules already refuse returning a
-- row to pending and activating one without Approve.
--
-- THE BEFORE-USER-CREATED HOOK is optional hardening: the same domain rule,
-- applied before an auth account exists at all. Selected in the dashboard under
-- Authentication → Hooks; the database enforces the rule regardless. Note that
-- it also governs dashboard invites, so a contractor on another domain needs
-- that domain added to the table first.

-- ---------------------------------------------------------------------------
-- 1. The allow-list
-- ---------------------------------------------------------------------------
-- A table, not a constant: adding a domain is a row and an audit entry, not a
-- migration. The PRIMARY KEY IS UUID because record_audit() casts the key to
-- uuid; a text key would break every write.

create table public.staff_email_domains (
  id         uuid primary key default gen_random_uuid(),
  domain     text not null unique,
  created_at timestamptz not null default now(),
  constraint staff_email_domains_shape check (
    domain = lower(domain) and position('@' in domain) = 0 and length(domain) > 2
  )
);

comment on table public.staff_email_domains is
  'Email domains a person may register from. Checked by request_staff_access() and by before_user_created_hook(). qwealth.com.au seeded 19 Sep 2026; existing staff on other domains are unaffected — the list governs new requests only.';

insert into public.staff_email_domains (domain) values ('qwealth.com.au');

alter table public.staff_email_domains enable row level security;

create policy staff_email_domains_select on public.staff_email_domains
  for select to authenticated using (public.is_active_staff());
create policy staff_email_domains_manage on public.staff_email_domains
  for all to authenticated
  using (public.current_staff_has('manage_staff'))
  with check (public.current_staff_has('manage_staff'));

revoke all on public.staff_email_domains from public, anon;
grant select, insert, update, delete on public.staff_email_domains to authenticated;

create trigger trg_staff_email_domains_audit
  after insert or update or delete on public.staff_email_domains
  for each row execute function public.record_audit('id', '');

-- ---------------------------------------------------------------------------
-- 2. A pending person reads their own row
-- ---------------------------------------------------------------------------

create policy staff_read_own_row on public.staff_users
  for select to authenticated
  using (auth_user_id = (select auth.uid()));

comment on policy staff_read_own_row on public.staff_users is
  'The one row a not-yet-active person may read: their own. Lets the request page and the consent screen say "awaiting approval" through the ordinary readers. Added 19 Sep 2026.';

-- ---------------------------------------------------------------------------
-- 3. The request
-- ---------------------------------------------------------------------------

create or replace function public.request_staff_access(p_full_name text)
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
  v_name      text;
  v_id        uuid;
  v_status    text;
begin
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'Not signed in';
  end if;

  -- Read-only on auth.users; the 31 August repair is about WRITING it.
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

  v_name := btrim(p_full_name);
  if coalesce(length(v_name), 0) < 2 or length(v_name) > 120 then
    raise exception 'Enter your full name';
  end if;

  -- One account, one request. A pending row is returned as it is; any other
  -- existing row — active, inactive, declined — is refused, and never
  -- reactivated from here.
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

  insert into public.staff_users (auth_user_id, email, full_name, status)
  values (v_uid, v_email, v_name, 'pending')
  returning id into v_id;
  return v_id;
end $fn$;

comment on function public.request_staff_access(text) is
  'A signed-in, email-confirmed person on an allowed domain asks to join the staff: creates their pending staff row, or returns it if it already exists. Refuses any account that already belongs to another staff record. SECURITY DEFINER because staff_users insert is administrator-only; checks everything before writing one row. Added 19 Sep 2026.';

revoke all on function public.request_staff_access(text) from public, anon;
grant execute on function public.request_staff_access(text) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. The approval
-- ---------------------------------------------------------------------------

create or replace function public.approve_staff_registration(p_staff_id uuid, p_profile_id uuid)
returns void
language plpgsql
security invoker
set search_path to ''
as $fn$
declare
  v_status text;
  v_rows   int;
begin
  if public.current_staff_id() is null then
    raise exception 'Not an active staff member';
  end if;
  -- A sentence, not a silent zero-row update.
  if not public.current_staff_has('manage_staff') then
    raise exception 'Only staff administrators can approve access requests';
  end if;

  select su.status::text into v_status
    from public.staff_users su
   where su.id = p_staff_id
   for update;
  if not found then
    raise exception 'No such request';
  end if;
  if v_status <> 'pending' then
    raise exception 'This request has already been decided';
  end if;
  if p_profile_id is null or not exists (select 1 from public.access_profiles ap where ap.id = p_profile_id) then
    raise exception 'Choose an access profile';
  end if;

  update public.staff_users set status = 'active' where id = p_staff_id;
  get diagnostics v_rows = row_count;
  if v_rows = 0 then
    raise exception 'You do not have permission to approve access requests';
  end if;

  -- A plain insert: a pending row never has an assignment, so a conflict here
  -- is an anomaly worth surfacing rather than smoothing over.
  insert into public.staff_access_assignments (staff_id, profile_id)
  values (p_staff_id, p_profile_id);
end $fn$;

comment on function public.approve_staff_registration(uuid, uuid) is
  'An administrator approves a pending access request: status to active and the chosen profile assigned, in one transaction through the approver''s own RLS so the audit trail names them. Refuses a request already decided. Decline is update_staff_patch(id, {"status":"inactive"}). Added 19 Sep 2026.';

revoke all on function public.approve_staff_registration(uuid, uuid) from public, anon;
grant execute on function public.approve_staff_registration(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. The auth hook, for the dashboard to select
-- ---------------------------------------------------------------------------
-- Contract: Supabase Auth calls it with the event as jsonb; an empty object
-- allows, an `error` object refuses. Runs as supabase_auth_admin, so it is
-- SECURITY DEFINER to read the allow-list past RLS, and granted to that role
-- alone.

create or replace function public.before_user_created_hook(event jsonb)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $fn$
declare
  v_email  text;
  v_domain text;
begin
  v_email := lower(btrim(event->'user'->>'email'));
  v_domain := split_part(coalesce(v_email, ''), '@', 2);
  if v_domain = '' or not exists (select 1 from public.staff_email_domains d where d.domain = v_domain) then
    return jsonb_build_object(
      'error', jsonb_build_object(
        'http_code', 403,
        'message', 'Sign-up is limited to Q Wealth staff email addresses.'));
  end if;
  return '{}'::jsonb;
end $fn$;

comment on function public.before_user_created_hook(jsonb) is
  'Supabase Auth "Before User Created" hook: refuses an account whose email domain is not in staff_email_domains, before the account exists. Optional hardening — request_staff_access() enforces the same rule regardless. Select it under Authentication → Hooks. Added 19 Sep 2026.';

grant usage on schema public to supabase_auth_admin;
grant execute on function public.before_user_created_hook(jsonb) to supabase_auth_admin;
revoke execute on function public.before_user_created_hook(jsonb) from public, anon, authenticated;
