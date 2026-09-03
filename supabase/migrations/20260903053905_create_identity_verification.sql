-- Identity verification over the telephone (3 Sep 2026)
--
-- An adviser on a call sends a one-time code to the mobile ALREADY ON FILE, the
-- caller reads it back, and the outcome is recorded. Twilio Verify generates,
-- sends and checks the code, so no code, hash or expiry is stored here — there
-- is nothing in this table an attacker could use to pass a check.
--
-- What this table is for is the row afterwards: on this date, this named staff
-- member sent a code to this number held against this client, and the caller
-- did or did not return it. That is the evidence of a client identity check.

create type public.verification_channel as enum ('sms');

create type public.verification_status as enum (
  'pending',    -- sent, awaiting a read-back
  'passed',
  'failed',
  'expired',    -- the code timed out unused
  'cancelled'   -- abandoned, or the provider refused to send
);

-- The distinction that must survive for years. "The server matched the code"
-- and "a staff member ticked a box" are very different pieces of evidence, and
-- one 'verified' flag would erase the difference.
create type public.verification_outcome_source as enum (
  'code_checked',     -- the provider confirmed the code the caller read back
  'adviser_attested'  -- fallback: no SMS possible, a named adviser vouched
);

create table public.identity_verification (
  id                    uuid primary key default gen_random_uuid(),
  -- restrict, not cascade: evidence of an identity check must not disappear
  -- because someone tidied up a party record.
  party_id              uuid not null references public.parties (id) on delete restrict,
  group_id              uuid references public.client_groups (id) on delete set null,
  channel               public.verification_channel not null default 'sms',
  -- E.164 as actually sent. Stored in full because that IS the evidence:
  -- proving a code went to the number on file means knowing which number.
  -- Masked at every point it is read back — see identity_verification_summary.
  destination           text not null,
  provider              text not null default 'twilio_verify',
  -- The provider's own handle for this verification: external corroboration
  -- that does not depend on our own records being intact.
  provider_sid          text,
  status                public.verification_status not null default 'pending',
  -- Providers cap how many times one code may be checked. Counted here so the
  -- limit holds even if the caller talks to the provider directly.
  attempts              integer not null default 0,
  failure_reason        text,
  requested_by_staff_id uuid not null references public.staff_users (id),
  requested_at          timestamptz not null default now(),
  outcome_source        public.verification_outcome_source,
  outcome_by_staff_id   uuid references public.staff_users (id),
  outcome_at            timestamptz,

  constraint identity_verification_destination_e164
    check (destination ~ '^\+[1-9][0-9]{7,14}$'),
  constraint identity_verification_attempts_sane
    check (attempts >= 0 and attempts <= 10),
  -- An outcome is three facts recorded together or not at all. Half of one is
  -- worse than none: it looks like a record and cannot be read.
  constraint identity_verification_outcome_whole
    check (
      (outcome_source is null and outcome_by_staff_id is null and outcome_at is null)
      or (outcome_source is not null and outcome_by_staff_id is not null and outcome_at is not null)
    ),
  -- ...and the status must agree with it, so no row can claim to have passed
  -- while carrying no evidence of who decided that.
  constraint identity_verification_outcome_matches_status
    check (
      (status in ('passed', 'failed') and outcome_at is not null)
      or (status in ('pending', 'expired', 'cancelled') and outcome_at is null)
    )
);

comment on table public.identity_verification is
  'One row per identity-verification attempt: a one-time code sent to a client''s mobile and the outcome of the read-back. Evidence of a client identity check. Append-only in effect - the outcome is recordable once, enforced by trigger, and there is no delete grant. No code, hash or expiry is stored; the provider holds those.';
comment on column public.identity_verification.destination is
  'The E.164 number the code was sent to, in full, because it is the evidence. Read it back through identity_verification_summary, which masks it.';
comment on column public.identity_verification.outcome_source is
  'How the outcome was decided. code_checked is a proof; adviser_attested is an attestation. Never collapse the two.';

create index identity_verification_party_idx
  on public.identity_verification (party_id, requested_at desc);
-- Both rate-limit keys get an index, since the limit is checked on every send.
create index identity_verification_destination_idx
  on public.identity_verification (destination, requested_at desc);
create index identity_verification_staff_idx
  on public.identity_verification (requested_by_staff_id, requested_at desc);
create unique index identity_verification_provider_sid_idx
  on public.identity_verification (provider_sid) where provider_sid is not null;

-- ---------------------------------------------------------------------------
-- Immutability
-- ---------------------------------------------------------------------------
-- The request details and the outcome are the evidence. Neither may be edited
-- after the fact, or the table is worth nothing as a record.
create or replace function public.enforce_verification_immutable()
returns trigger language plpgsql set search_path to '' as $fn$
begin
  if old.outcome_at is not null then
    raise exception 'The outcome of a verification is recorded once and cannot be changed';
  end if;
  if new.party_id <> old.party_id
     or new.destination <> old.destination
     or new.requested_by_staff_id <> old.requested_by_staff_id
     or new.requested_at <> old.requested_at
     or new.channel <> old.channel then
    raise exception 'The request details of a verification cannot be altered';
  end if;
  return new;
end $fn$;

revoke all on function public.enforce_verification_immutable() from public, anon, authenticated;

create trigger trg_identity_verification_immutable
  before update on public.identity_verification
  for each row execute function public.enforce_verification_immutable();

-- ---------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------
alter table public.identity_verification enable row level security;

-- Read only, and only within your access scope. Every write goes through the
-- functions below, which is what makes the rate limit impossible to bypass:
-- there is no insert grant to route around it with.
create policy identity_verification_select on public.identity_verification
  for select to authenticated
  using (
    requested_by_staff_id = public.current_staff_id()
    or public.staff_can_access_party(party_id)
  );

grant select on public.identity_verification to authenticated;

-- ---------------------------------------------------------------------------
-- Phone normalisation
-- ---------------------------------------------------------------------------
-- Numbers are typed into contact_points as people write them ('0412 555 901').
-- Twilio needs E.164. This refuses rather than guesses: a number it cannot read
-- with confidence raises, because silently sending a code to the wrong number
-- is worse than not sending one.
create or replace function public.to_e164_au(p_raw text)
returns text
language plpgsql
immutable
set search_path to ''
as $fn$
declare
  v_clean text;
begin
  if p_raw is null or length(trim(p_raw)) = 0 then
    raise exception 'No telephone number given';
  end if;

  -- Already international: validate the shape, change nothing. Overseas clients
  -- exist, so a number the client has stored in full is trusted as written.
  if left(trim(p_raw), 1) = '+' then
    v_clean := '+' || regexp_replace(p_raw, '[^0-9]', '', 'g');
    if v_clean ~ '^\+[1-9][0-9]{7,14}$' then
      return v_clean;
    end if;
    raise exception 'Cannot read "%" as an international number', p_raw;
  end if;

  v_clean := regexp_replace(p_raw, '[^0-9]', '', 'g');

  -- Australian mobile, the only local form worth inferring: 04xx xxx xxx.
  if v_clean ~ '^04[0-9]{8}$' then
    return '+61' || substr(v_clean, 2);
  end if;
  if v_clean ~ '^614[0-9]{8}$' then
    return '+' || v_clean;
  end if;

  raise exception 'Cannot read "%" as a mobile number. Store it in full international form, for example +61412345678', p_raw;
end $fn$;

revoke all on function public.to_e164_au(text) from public, anon;
grant execute on function public.to_e164_au(text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Rate limiting
-- ---------------------------------------------------------------------------
-- Enforced here rather than in the edge function. A limit that lives in
-- application code is bypassed by the next piece of code that forgets it; here,
-- a second function, a direct API call and a bug in the edge function all hit
-- the same wall. An unlimited one-time-code endpoint is the ordinary way an
-- organisation discovers a large telephony bill.
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
  -- A per-contact limit alone does not stop one compromised account working
  -- through the client book one number at a time.
  c_per_staff constant integer := 20;
  c_staff_window constant interval := interval '1 hour';
  v_count integer;
begin
  select count(*) into v_count
  from public.identity_verification v
  where v.destination = p_destination
    and v.requested_at > now() - c_destination_window;
  if v_count >= c_per_destination then
    return format('That number has already been sent %s codes in the last %s. Try again shortly.',
                  v_count, c_destination_window);
  end if;

  select count(*) into v_count
  from public.identity_verification v
  where v.requested_by_staff_id = p_staff_id
    and v.requested_at > now() - c_staff_window;
  if v_count >= c_per_staff then
    return format('You have sent %s verification codes in the last %s, which is the hourly limit.',
                  v_count, c_staff_window);
  end if;

  return null;
end $fn$;

revoke all on function public.verification_rate_limit_breach(text, uuid) from public, anon;
grant execute on function public.verification_rate_limit_breach(text, uuid) to authenticated, service_role;

comment on function public.verification_rate_limit_breach(text, uuid) is
  'Returns a human-readable reason if this send would breach a rate limit, or null if it may proceed. 3 per destination per 10 minutes; 20 per staff member per hour.';
