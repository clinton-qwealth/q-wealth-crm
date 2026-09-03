-- A stubbed verification must never look like a real one (3 Sep 2026)
--
-- The edge function is built so it can run without Twilio credentials, so the
-- whole path — permission checks, rate limits, database writes, UI states —
-- can be exercised with nothing sent and nothing charged.
--
-- That creates a risk worth designing against rather than documenting away: a
-- row written during a stubbed run must be permanently distinguishable from a
-- row where a code genuinely went to a client's handset. Otherwise the evidence
-- table quietly fills with checks that never happened, and no one can tell
-- which is which later.
--
-- So the caller must now DECLARE the provider when it attaches its reference,
-- and 'stub' is a value the table carries forever.
--
-- The two-argument form is dropped rather than overloaded: a third parameter
-- with a default would make a two-argument call ambiguous, and leaving both
-- would let a caller write a row with the provider silently defaulted to
-- twilio_verify. Nothing calls it yet, so dropping is free.
drop function if exists public.attach_verification_provider_sid(uuid, text);

create or replace function public.attach_verification_provider_sid(
  p_id       uuid,
  p_sid      text,
  p_provider text
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
  if p_sid is null or length(trim(p_sid)) = 0 then
    raise exception 'A provider reference is required';
  end if;
  -- A closed list. An unrecognised provider name would make the evidence
  -- unreadable later, which is the whole thing this column exists to prevent.
  if p_provider not in ('twilio_verify', 'stub') then
    raise exception 'Unknown verification provider: %', p_provider;
  end if;

  update public.identity_verification v
     set provider_sid = trim(p_sid),
         provider     = p_provider
   where v.id = p_id
     and v.requested_by_staff_id = v_staff
     and v.status = 'pending'
     and v.provider_sid is null;

  if not found then
    raise exception 'No open verification of yours to attach a reference to';
  end if;
end $fn$;

revoke all on function public.attach_verification_provider_sid(uuid, text, text) from public, anon;
grant execute on function public.attach_verification_provider_sid(uuid, text, text) to authenticated, service_role;

comment on function public.attach_verification_provider_sid(uuid, text, text) is
  'Records the provider''s reference for a verification, and which provider it was. provider = ''stub'' marks a run where no message was actually sent - such a row is not evidence of a client identity check and must never be read as one.';

-- Surface the provider where the history is read, so a stubbed row is visible
-- as such rather than needing a join back to the base table to find out.
-- Dropped and recreated rather than replaced: create or replace cannot insert a
-- column into the middle of a view's column list. RESTRICT is the default, so
-- this fails loudly if anything has come to depend on the view.
drop view if exists public.identity_verification_summary;

create view public.identity_verification_summary
with (security_invoker = true) as
select v.id,
       v.party_id,
       v.group_id,
       v.channel,
       v.provider,
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
  'Verification history for the Activity tab. The destination is masked, so the full mobile number never leaves identity_verification itself. provider distinguishes a real send from a stubbed one.';

-- A freshly created view is handed straight to anon by the schema's default
-- privileges, so the grants are restated rather than assumed.
revoke all on public.identity_verification_summary from anon, public;
revoke insert, update, delete, truncate, references, trigger
  on public.identity_verification_summary from authenticated;
grant select on public.identity_verification_summary to authenticated;
