-- Two gaps found by reading the security advisor properly (3 Sep 2026)
--
-- 1. verify_identity gated STARTING a verification but not recording its
--    outcome. So a staff member without the permission, who happened to have
--    access to the client, could mark a verification 'passed' by attestation.
--    The permission is about the whole workflow, not just the spend: recording
--    "this client's identity was confirmed" is the part that becomes evidence,
--    and it needs the same authority as sending the code.
--
-- 2. verification_rate_limit_breach and to_e164_au were EXECUTE-able by
--    authenticated over /rest/v1/rpc/. Neither is called by the application:
--    their only caller is begin_identity_verification, which is SECURITY
--    DEFINER and so invokes them as the owner regardless. Left exposed,
--    verification_rate_limit_breach is an oracle — any signed-in user could ask
--    it whether a given mobile number had been sent a code recently.
--
-- mask_phone deliberately keeps its grant: identity_verification_summary is
-- security_invoker, so the view executes it as the CALLER. Revoking it would
-- break every read of the verification history.

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
  -- The outcome is the evidence. Writing it needs the same authority as
  -- sending the code, not merely access to the client.
  if not public.current_staff_has('verify_identity') then
    raise exception 'Permission denied: verify_identity required';
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

-- Internal helpers: reachable only from the SECURITY DEFINER functions above,
-- which run as the owner and so do not need the caller to hold these.
revoke all on function public.verification_rate_limit_breach(text, uuid) from public, anon, authenticated;
revoke all on function public.to_e164_au(text) from public, anon, authenticated;
grant execute on function public.verification_rate_limit_breach(text, uuid) to service_role;
grant execute on function public.to_e164_au(text) to service_role;

-- Re-stated after create or replace, which resets nothing but is worth being
-- explicit about given how easily a grant goes missing.
revoke all on function public.note_verification_check_attempt(uuid) from public, anon;
grant execute on function public.note_verification_check_attempt(uuid) to authenticated, service_role;
revoke all on function public.record_verification_outcome(uuid, boolean, public.verification_outcome_source) from public, anon;
grant execute on function public.record_verification_outcome(uuid, boolean, public.verification_outcome_source) to authenticated, service_role;
revoke all on function public.abandon_identity_verification(uuid, public.verification_status, text) from public, anon;
grant execute on function public.abandon_identity_verification(uuid, public.verification_status, text) to authenticated, service_role;
