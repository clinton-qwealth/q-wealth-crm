-- The only ways to write a verification (3 Sep 2026)
--
-- identity_verification grants SELECT and nothing else, so these functions are
-- the whole write surface. They are SECURITY DEFINER and therefore carry every
-- check themselves: active staff, the verify_identity permission, access to the
-- party, and the rate limit. Nothing can reach the table around them.

-- ---------------------------------------------------------------------------
-- Masking
-- ---------------------------------------------------------------------------
-- Enough for an adviser to confirm "the number ending 901?" out loud, and not
-- enough to be a copy of the client's mobile number in a second place.
create or replace function public.mask_phone(p_number text)
returns text
language sql
immutable
set search_path to ''
as $fn$
  select case
           when p_number is null or length(p_number) < 4 then null
           else '•••• ' || right(p_number, 3)
         end
$fn$;

revoke all on function public.mask_phone(text) from public, anon;
grant execute on function public.mask_phone(text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Start
-- ---------------------------------------------------------------------------
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

  -- The number comes from the record, never from the caller. If the caller
  -- supplied it, a pass would only prove they control some telephone; taken
  -- from the record, it proves they hold the client's.
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

  -- Written BEFORE the provider is called, deliberately. The row is what the
  -- rate limit counts, so counting it first means concurrent requests cannot
  -- slip through the gap between checking and writing. The cost is that a send
  -- the provider then refuses still counts — which fails in the safe direction.
  insert into public.identity_verification
    (party_id, group_id, destination, requested_by_staff_id)
  values (p_party_id, p_group_id, v_e164, v_staff)
  returning id into v_id;

  return query select v_id, v_e164, public.mask_phone(v_e164);
end $fn$;

revoke all on function public.begin_identity_verification(uuid, uuid) from public, anon;
grant execute on function public.begin_identity_verification(uuid, uuid) to authenticated, service_role;

comment on function public.begin_identity_verification(uuid, uuid) is
  'Opens a verification: checks staff, the verify_identity permission, access to the party, resolves the mobile from contact_points server-side, applies the rate limit, and writes a pending row. Returns the E.164 number for the provider call and a masked form for display. The E.164 value must never be sent to a browser.';

-- ---------------------------------------------------------------------------
-- Provider handle
-- ---------------------------------------------------------------------------
create or replace function public.attach_verification_provider_sid(
  p_id  uuid,
  p_sid text
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
  if p_sid is null or length(trim(p_sid)) = 0 then
    raise exception 'A provider reference is required';
  end if;

  update public.identity_verification v
     set provider_sid = trim(p_sid)
   where v.id = p_id
     and v.requested_by_staff_id = v_staff
     and v.status = 'pending'
     and v.provider_sid is null;

  if not found then
    raise exception 'No open verification of yours to attach a reference to';
  end if;
end $fn$;

revoke all on function public.attach_verification_provider_sid(uuid, text) from public, anon;
grant execute on function public.attach_verification_provider_sid(uuid, text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Check attempts
-- ---------------------------------------------------------------------------
-- Counted here as well as at the provider, so the cap holds even if something
-- talks to the provider directly.
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

revoke all on function public.note_verification_check_attempt(uuid) from public, anon;
grant execute on function public.note_verification_check_attempt(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Outcome
-- ---------------------------------------------------------------------------
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

revoke all on function public.record_verification_outcome(uuid, boolean, public.verification_outcome_source)
  from public, anon;
grant execute on function public.record_verification_outcome(uuid, boolean, public.verification_outcome_source)
  to authenticated, service_role;

comment on function public.record_verification_outcome(uuid, boolean, public.verification_outcome_source) is
  'Records the result once. p_source distinguishes a provider-checked code from an adviser attestation, and the two must never be collapsed into one "verified" flag - they are different strengths of evidence.';

-- ---------------------------------------------------------------------------
-- Abandon
-- ---------------------------------------------------------------------------
-- For a code that timed out unused, or a send the provider refused. Not an
-- outcome: nothing was decided about the caller's identity.
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

revoke all on function public.abandon_identity_verification(uuid, public.verification_status, text)
  from public, anon;
grant execute on function public.abandon_identity_verification(uuid, public.verification_status, text)
  to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Reading it back
-- ---------------------------------------------------------------------------
-- What the Activity tab renders. security_invoker, so the caller's own row-level
-- security decides which rows appear, and the destination is masked here so no
-- reader of this view ever receives a client's mobile number.
create or replace view public.identity_verification_summary
with (security_invoker = true) as
select v.id,
       v.party_id,
       v.group_id,
       v.channel,
       public.mask_phone(v.destination) as destination_masked,
       v.status,
       v.attempts,
       v.failure_reason,
       v.requested_at,
       v.requested_by_staff_id,
       rq.full_name as requested_by_name,
       v.outcome_source,
       v.outcome_at,
       v.outcome_by_staff_id,
       oc.full_name as outcome_by_name
from public.identity_verification v
left join public.staff_directory rq on rq.id = v.requested_by_staff_id
left join public.staff_directory oc on oc.id = v.outcome_by_staff_id;

comment on view public.identity_verification_summary is
  'Verification history for the Activity tab. The destination is masked, so the full mobile number never leaves identity_verification itself.';

grant select on public.identity_verification_summary to authenticated;
