-- Extended personal detail (2 Sep 2026)

create type public.employment_status as enum (
  'employed', 'self_employed', 'unemployed', 'retired',
  'home_duties', 'student', 'not_disclosed'
);

alter table public.persons
  add column place_of_birth       text,
  -- Nullable on purpose, and the nullability carries meaning: null is "not
  -- asked", which is NOT the same as "non-smoker". Smoker status changes an
  -- insurance premium materially, so a boolean defaulting to false would assert
  -- something nobody has established.
  add column smoker               boolean,
  add column primary_citizenship  text,
  add column secondary_citizenship text,
  add column tax_residency        text,
  add column employment_status    public.employment_status,
  add column occupation           text,
  add column company_name         text,
  -- CHESS identifiers. Plain columns: a HIN is printed on every holding
  -- statement and needed for routine settlement work, and a PID identifies the
  -- sponsoring broker rather than the client.
  add column hin                  text,
  add column chess_pid            text,
  add column coffee_preference    text;

comment on column public.persons.smoker is
  'null = not asked, which is not the same as non-smoker. Affects insurance premiums, so it is never defaulted.';
comment on column public.persons.primary_citizenship is
  'ISO 3166-1 alpha-2 country code.';
comment on column public.persons.secondary_citizenship is
  'ISO 3166-1 alpha-2 country code. Dual citizenship is common and affects tax residency questions.';
comment on column public.persons.tax_residency is
  'ISO 3166-1 alpha-2 country code. Drives whether a foreign TIN is required.';
comment on column public.persons.hin is
  'CHESS Holder Identification Number. A plain column deliberately: it appears on every holding statement and is needed for settlement admin. The genuinely sensitive identifiers (TIN, Centrelink CRN, Director ID) live encrypted in party_sensitive_data.';
comment on column public.persons.chess_pid is
  'CHESS sponsor Participant ID. Identifies the broker, not the client, so not personal information.';
comment on column public.persons.coffee_preference is
  'How they take it. Small courtesies are what clients remember about a meeting.';

-- One call per person instead of one per field. get_masked_hint is per-kind, so
-- a panel showing three encrypted identifiers for four household members would
-- otherwise make twelve round trips.
create or replace function public.get_masked_hints(p_party_id uuid)
returns jsonb
language sql
stable
security definer
set search_path to ''
as $fn$
  select case
    when public.is_active_staff() then
      coalesce(
        (select jsonb_object_agg(d.field_kind::text, d.masked_hint)
           from public.party_sensitive_data d
          where d.party_id = p_party_id),
        '{}'::jsonb)
    else '{}'::jsonb
  end;
$fn$;

comment on function public.get_masked_hints(uuid) is
  'Masked hints for every encrypted field held against a party, as kind -> hint. Hints only; the plaintext still requires reveal_sensitive_field with view_sensitive and a verified second factor.';

revoke all on function public.get_masked_hints(uuid) from public, anon;
grant execute on function public.get_masked_hints(uuid) to authenticated, service_role;
