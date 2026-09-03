-- Readable rate-limit messages (3 Sep 2026)
--
-- These strings are shown to an adviser mid-telephone-call, and interpolating
-- an interval rendered them as "in the last 00:10:00". The window is now
-- described in words. Caught by reading the message a negative-control test
-- printed, rather than by reading the code.
create or replace function public.verification_rate_limit_breach(
  p_destination text,
  p_staff_id    uuid
) returns text
language plpgsql
stable
security definer
set search_path to ''
as $fn$
declare
  -- A genuine call needs one code, occasionally two.
  c_per_destination constant integer := 3;
  c_destination_window constant interval := interval '10 minutes';
  c_destination_words constant text := '10 minutes';
  -- A per-contact limit alone does not stop one compromised account working
  -- through the client book one number at a time.
  c_per_staff constant integer := 20;
  c_staff_window constant interval := interval '1 hour';
  c_staff_words constant text := 'hour';
  v_count integer;
begin
  select count(*) into v_count
  from public.identity_verification v
  where v.destination = p_destination
    and v.requested_at > now() - c_destination_window;
  if v_count >= c_per_destination then
    return format('That number has already been sent %s codes in the last %s. Try again shortly.',
                  v_count, c_destination_words);
  end if;

  select count(*) into v_count
  from public.identity_verification v
  where v.requested_by_staff_id = p_staff_id
    and v.requested_at > now() - c_staff_window;
  if v_count >= c_per_staff then
    return format('You have sent %s verification codes in the last %s, which is the limit.',
                  v_count, c_staff_words);
  end if;

  return null;
end $fn$;

revoke all on function public.verification_rate_limit_breach(text, uuid) from public, anon;
grant execute on function public.verification_rate_limit_breach(text, uuid) to authenticated, service_role;

comment on function public.verification_rate_limit_breach(text, uuid) is
  'Returns a human-readable reason if this send would breach a rate limit, or null if it may proceed. 3 per destination per 10 minutes; 20 per staff member per hour. The message is shown to the adviser, so it is written in words.';
