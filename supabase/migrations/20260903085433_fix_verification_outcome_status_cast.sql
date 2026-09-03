-- record_verification_outcome could never have worked (3 Sep 2026)
--
--   ERROR 42804: column "status" is of type public.verification_status but
--   expression is of type text
--
-- `case when p_passed then 'passed' else 'failed' end` is text, and assigning
-- text to an enum column needs an explicit cast. plpgsql only type-checks a
-- statement when it executes, so the function was created without complaint and
-- would have failed the FIRST TIME an adviser recorded an outcome.
--
-- Why it survived the earlier round of testing, which is the more useful
-- lesson: the tests exercised this function's REFUSALS thoroughly — no
-- permission, no second factor, no open verification, outcome already recorded
-- — and every one of those returns before reaching the update. The happy path
-- was never run. A refusal test proves the guard, not the body behind it.
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
     set status              = (case when p_passed then 'passed' else 'failed' end)::public.verification_status,
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
