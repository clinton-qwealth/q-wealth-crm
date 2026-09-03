-- A second factor is required to verify a client's identity (3 Sep 2026)
--
-- FOUND BY TESTING THE DEPLOYED EDGE FUNCTION, not by reading the design.
--
-- A plain password grant against Supabase Auth yields an `aal1` token. That
-- token was accepted by the identity-verify function, which means someone
-- holding only a stolen password could have sent one-time codes to clients'
-- mobiles and recorded identity-check outcomes against their records.
--
-- The web app's MFA gate lives in the shell layout, which covers UI ROUTES.
-- The edge function is a separate entry point and was never behind it. This is
-- the general shape of the risk documented on the Security Structure page —
-- app-layer enforcement having a hole where a second door exists — and here it
-- was a real one.
--
-- Fixed at the database, not in the function, so a second caller, a future
-- endpoint or a bug in the function cannot route around it. Same helper and
-- same bar as reveal_sensitive_field: sending a client a code and writing
-- "this client's identity was confirmed" deserve no less than reading a TFN.
--
-- WHY THIS BREAKS NOTHING:
--   * Web app  — the shell layout forces step-up before any authenticated
--                route, so the session token a server action holds is aal2.
--   * MCP      — OAuth sessions are aal1 for life, so the connector is refused.
--                It is already forbidden from starting a verification by design;
--                this makes that structural rather than a matter of which tools
--                were registered.
--   * Password-only caller — refused, which is the entire point.
--
-- Applied to all four write paths. "Requires a second factor" is easier to
-- reason about, and to state to a compliance reader, than a list of exceptions.

create or replace function public.begin_identity_verification(
  p_party_id uuid,
  p_group_id uuid default null
) returns table (verification_id uuid, destination_e164 text, destination_masked text)
language plpgsql
security definer
set search_path to ''
as $fn$
declare
  v_staff  uuid;
  v_raw    text;
  v_e164   text;
  v_breach text;
  v_id     uuid;
begin
  v_staff := public.current_staff_id();
  if v_staff is null then
    raise exception 'Not an active staff member';
  end if;

  -- Signed in is not the same as allowed. This flag defaults to false.
  if not public.current_staff_has('verify_identity') then
    raise exception 'Permission denied: verify_identity required';
  end if;

  -- And a password alone is not enough to telephone a client.
  if not public.has_mfa() then
    raise exception 'A verified second factor is required to verify a client''s identity';
  end if;

  -- Scope still applies on top of the permission: holding verify_identity does
  -- not widen which clients are reachable.
  if not public.staff_can_access_party(p_party_id) then
    raise exception 'No such individual, or not within your access';
  end if;
  if not exists (select 1 from public.persons p where p.party_id = p_party_id) then
    raise exception 'Only an individual can be verified this way';
  end if;
  if p_group_id is not null and not public.staff_can_access_group(p_group_id) then
    raise exception 'No such group, or not within your access';
  end if;

  -- The number comes from the record, never from the caller.
  select cp.value into v_raw
  from public.contact_points cp
  where cp.party_id = p_party_id
    and cp.kind = 'phone_mobile'
    and cp.value is not null
    and length(trim(cp.value)) > 0
  order by cp.is_preferred desc, cp.updated_at desc
  limit 1;

  if v_raw is null then
    raise exception 'No mobile number on file for this individual';
  end if;

  v_e164 := public.to_e164_au(v_raw);

  v_breach := public.verification_rate_limit_breach(v_e164, v_staff);
  if v_breach is not null then
    raise exception '%', v_breach;
  end if;

  insert into public.identity_verification
    (party_id, group_id, destination, requested_by_staff_id)
  values (p_party_id, p_group_id, v_e164, v_staff)
  returning id into v_id;

  return query select v_id, v_e164, public.mask_phone(v_e164);
end $fn$;

create or replace function public.note_verification_check_attempt(p_id uuid)
returns integer
language plpgsql
security definer
set search_path to ''
as $fn$
declare
  c_max constant integer := 5;
  v_staff uuid;
  v_count integer;
begin
  v_staff := public.current_staff_id();
  if v_staff is null then
    raise exception 'Not an active staff member';
  end if;
  if not public.current_staff_has('verify_identity') then
    raise exception 'Permission denied: verify_identity required';
  end if;
  if not public.has_mfa() then
    raise exception 'A verified second factor is required to verify a client''s identity';
  end if;

  update public.identity_verification v
     set attempts = v.attempts + 1
   where v.id = p_id
     and v.status = 'pending'
     and (v.requested_by_staff_id = v_staff or public.staff_can_access_party(v.party_id))
  returning v.attempts into v_count;

  if v_count is null then
    raise exception 'No open verification to check';
  end if;
  if v_count > c_max then
    raise exception 'Too many attempts on this code. Send a new one.';
  end if;
  return v_count;
end $fn$;

create or replace function public.record_verification_outcome(
  p_id     uuid,
  p_passed boolean,
  p_source public.verification_outcome_source
) returns void
language plpgsql
security definer
set search_path to ''
as $fn$
declare
  v_staff uuid;
begin
  v_staff := public.current_staff_id();
  if v_staff is null then
    raise exception 'Not an active staff member';
  end if;
  if not public.current_staff_has('verify_identity') then
    raise exception 'Permission denied: verify_identity required';
  end if;
  if not public.has_mfa() then
    raise exception 'A verified second factor is required to verify a client''s identity';
  end if;
  if p_passed is null or p_source is null then
    raise exception 'An outcome needs both a result and how it was decided';
  end if;

  update public.identity_verification v
     set status              = case when p_passed then 'passed' else 'failed' end,
         outcome_source      = p_source,
         outcome_by_staff_id = v_staff,
         outcome_at          = now()
   where v.id = p_id
     and v.status = 'pending'
     and (v.requested_by_staff_id = v_staff or public.staff_can_access_party(v.party_id));

  if not found then
    raise exception 'No open verification to record an outcome against';
  end if;
end $fn$;

create or replace function public.abandon_identity_verification(
  p_id     uuid,
  p_status public.verification_status,
  p_reason text default null
) returns void
language plpgsql
security definer
set search_path to ''
as $fn$
declare
  v_staff uuid;
begin
  v_staff := public.current_staff_id();
  if v_staff is null then
    raise exception 'Not an active staff member';
  end if;
  if not public.current_staff_has('verify_identity') then
    raise exception 'Permission denied: verify_identity required';
  end if;
  if not public.has_mfa() then
    raise exception 'A verified second factor is required to verify a client''s identity';
  end if;
  if p_status not in ('expired', 'cancelled') then
    raise exception 'A verification can only be abandoned as expired or cancelled';
  end if;

  update public.identity_verification v
     set status = p_status,
         failure_reason = nullif(trim(coalesce(p_reason, '')), '')
   where v.id = p_id
     and v.status = 'pending'
     and (v.requested_by_staff_id = v_staff or public.staff_can_access_party(v.party_id));

  if not found then
    raise exception 'No open verification to abandon';
  end if;
end $fn$;

comment on function public.begin_identity_verification(uuid, uuid) is
  'Opens a verification. Requires active staff, the verify_identity permission, a verified second factor on the session, and access to the party; resolves the mobile from contact_points server-side and applies the rate limit before writing a pending row. Returns the E.164 number for the provider call and a masked form for display. The E.164 value must never be sent to a browser.';
