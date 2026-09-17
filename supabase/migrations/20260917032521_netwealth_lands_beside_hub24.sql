-- Netwealth lands beside HUB24, and the promotion's rules move into one place (17 Sep 2026)
--
-- The second provider feed. The 15 September migration that built the landing
-- zone said what this one would look like — "Netwealth and the third platform
-- will each get their own landing table, their own role and their own
-- promote_<source>(), and all three write the same canonical rows" — and that
-- is what this is, with one addition the second feed earned.
--
-- SEPARATE WHERE THE PROVIDER'S SHAPE LIVES, SHARED WHERE THE CRM'S RULES LIVE.
--
--   n8n, as ingest_netwealth  ->  ingest.netwealth_accounts  ->  ingest.promote('netwealth')  ->  promote_netwealth()  ->  apply_valuation() / apply_snapshot()  ->  public.*
--   its own credential            its own columns, raw          the same door                   Netwealth's words to ours   THE CRM'S RULES, ONCE
--
-- Two feeds cannot write over each other, at any layer, and none of it is new
-- policy — it is the 15 September design doing what it said:
--   - two landing tables, each keyed on (account_number, as_at_date) on its own;
--   - two roles, each granted on its own table and blind to the other's;
--   - one matching rule, provider party AND account number, so a Netwealth
--     number equal to a HUB24 number lands on a different CRM account;
--   - valuations keyed on (account_id, as_at), each stamped source_system.
--
-- WHY THE RULES MOVE. promote_hub24 was two hundred lines and most of them were
-- not about HUB24: upsert the valuation, close through the map, refresh cash,
-- keep the product string sticky, seed the label exactly once, refuse an
-- allocation outside its tolerance, drop zero weights. A second copy of that in
-- promote_netwealth is two copies of the business rules, and a later fix to the
-- tolerance lands in one of them. So the canonical tail is lifted into
-- apply_valuation() and apply_snapshot(), promote_hub24 is rewritten to call
-- them, and promote_netwealth is only the mapping. Verified on a branch by
-- replaying HUB24's landing rows through the rewritten function and diffing
-- every outcome, note, valuation and allocation against the old one.
--
-- WHAT THE REAL NETWEALTH RECORD TAUGHT US, from the sandbox on 17 September:
--   1. No status word. `isExited` is a boolean with a `dateExited` beside it,
--      so there is no status map here — an exited account is closed on that
--      date, and nothing else about status is ever inferred. Reopening stays a
--      decision a person makes, as it is for HUB24.
--   2. Netwealth DATES ITS OWN VALUATION. `/balance` carries a valuationDate,
--      and on a 17 September run it read 16 September. HUB24 gives no such
--      date, so its valuation is dated by the run. Netwealth's is dated by
--      Netwealth — which also means two weekend runs that both report Friday's
--      value update ONE valuation row rather than inventing three.
--   3. Asset classes arrive as WORDS — "Australian Fixed Interest" — each with
--      a fraction of one. They are mapped through a table, and an unknown word
--      skips the allocation and names itself in the note, so the picture is
--      never written with a class silently missing.
--   4. The sandbox is degenerate: every account is one hundred per cent a cash
--      account that Netwealth classes as fixed interest. So the map is seeded
--      with the one word observed plus exact-string guesses marked as such,
--      and the tripwire is what tells us which words were wrong.
--   5. `productOption` — "netwealth Wealth Accelerator Plus" — reads like a
--      name and is a product. Same treatment as HUB24's: product_display_name,
--      sticky, never a heading.
--   6. Dates carry a +10:00 offset and the database session is UTC, so a
--      midnight-Sydney valuation date cast naively becomes the day before.
--      Instants are landed raw and the calendar date is taken IN SYDNEY at
--      promotion, once, in one place.

-- ---------------------------------------------------------------------------
-- 1. Netwealth as a party, with a fixed id like HUB24's
-- ---------------------------------------------------------------------------

insert into public.parties (id, party_type, status)
values ('6f0b0c24-0000-4000-8000-000000000025', 'organisation', 'active');

-- display_name is set from legal_name by trigger. ABN deliberately null, as
-- HUB24's is: a company identifier is entered from a document, not from memory.
insert into public.organisations (party_id, legal_name, entity_type)
values ('6f0b0c24-0000-4000-8000-000000000025', 'Netwealth Investments Limited', 'company');

insert into public.party_roles (party_id, role, status)
values ('6f0b0c24-0000-4000-8000-000000000025', 'product_provider', 'active');

insert into ingest.sources (source_system, provider_party_id, role_name)
values ('netwealth', '6f0b0c24-0000-4000-8000-000000000025', 'ingest_netwealth');

-- ---------------------------------------------------------------------------
-- 2. Netwealth's asset-class words -> the CRM's eight classes
-- ---------------------------------------------------------------------------
-- A table and not a CASE in the function, because the words are Netwealth's
-- and will change without a deploy. `observed` is the receipt: a row seeded
-- from a guess says so, and the tripwire in promote_netwealth names any word
-- with no row at all rather than writing an allocation with a hole in it.

create table ingest.netwealth_asset_class_map (
  netwealth_class text primary key,
  crm_class       text not null
    constraint netwealth_asset_class_map_class_known check (crm_class in (
      'australian_shares', 'international_shares',
      'australian_fixed_interest', 'international_fixed_interest',
      'listed_property', 'direct_property', 'cash', 'other')),
  observed        boolean not null default false,
  note            text,
  created_at      timestamptz not null default now()
);
alter table ingest.netwealth_asset_class_map enable row level security;

comment on table ingest.netwealth_asset_class_map is
  'What Netwealth calls an asset class, mapped to the CRM''s eight. A word with no row skips the allocation for that account and is named in the landing row''s note (allocation_unmapped). observed = false marks a row seeded from a guess on 17 Sep 2026; confirm or correct it when the word arrives from a real account.';

insert into ingest.netwealth_asset_class_map (netwealth_class, crm_class, observed, note) values
  ('Australian Fixed Interest',    'australian_fixed_interest',    true,  'Sandbox, 17 Sep 2026 — the Netwealth Cash Account is classed here'),
  ('International Fixed Interest', 'international_fixed_interest', false, 'Assumed from the observed pattern'),
  ('Australian Shares',            'australian_shares',            false, 'Assumed'),
  ('Australian Equities',          'australian_shares',            false, 'Assumed'),
  ('International Shares',         'international_shares',         false, 'Assumed'),
  ('International Equities',       'international_shares',         false, 'Assumed'),
  ('Australian Listed Property',   'listed_property',              false, 'Assumed'),
  ('International Listed Property','listed_property',              false, 'Assumed'),
  ('Listed Property',              'listed_property',              false, 'Assumed'),
  ('Property',                     'listed_property',              false, 'Assumed. If Netwealth folds direct property into this word, split it here'),
  ('Direct Property',              'direct_property',              false, 'Assumed'),
  ('Unlisted Property',            'direct_property',              false, 'Assumed'),
  ('Cash',                         'cash',                         false, 'Assumed'),
  ('Australian Cash',              'cash',                         false, 'Assumed'),
  ('International Cash',           'cash',                         false, 'Assumed'),
  ('Other',                        'other',                        false, 'Assumed'),
  ('Alternatives',                 'other',                        false, 'Assumed'),
  ('Alternative',                  'other',                        false, 'Assumed');

-- ---------------------------------------------------------------------------
-- 3. The landing table, shaped to the four sandbox calls the flow makes
-- ---------------------------------------------------------------------------

create table ingest.netwealth_accounts (
  id                          bigint generated always as identity primary key,
  as_at_date                  date not null,
  account_number              text not null
    constraint netwealth_accounts_number_not_blank check (length(trim(account_number)) > 0),
  adviser_code                text,

  -- /accounts/{n}/detail
  client_id                   bigint,
  client_title                text,
  client_first_name           text,
  client_last_name            text,
  client_trust_name           text,
  non_custodial_account_name  text,
  date_joined_at              timestamptz,
  is_exited                   boolean,
  date_exited_at              timestamptz,
  account_type                text,
  product_option              text,
  external_reference_number   text,

  -- /accounts/{n}/cash
  available_cash              numeric,
  total_cash                  numeric,
  minimum_cash                numeric,
  managed_account_cash        numeric,
  cash_effective_at           timestamptz,

  -- /accounts/{n}/balance
  total_value                 numeric,
  custodial_assets_value      numeric,
  non_custodial_assets_value  numeric,
  currency                    text,
  -- The INSTANT, raw. Netwealth sends "2026-09-16T00:00:00+10:00"; the
  -- calendar day is taken in Sydney at promotion. Cast to date here and a
  -- UTC session would call it the 15th.
  valuation_at                timestamptz,

  -- /accounts/{n}/holdings/by-asset-class
  -- No offset on this one ("2026-09-16T00:00:00"), so it is a local timestamp.
  holdings_effective_at       timestamp,
  asset_classes_raw           jsonb,

  -- The four responses, whole, and the combined record around them.
  detail_raw                  jsonb,
  cash_raw                    jsonb,
  balance_raw                 jsonb,
  payload                     jsonb not null,

  fetched_at                  timestamptz not null default now(),
  promoted_at                 timestamptz,
  -- The same vocabulary as HUB24's, so reconciliation reads the same across
  -- feeds. status_unmapped cannot occur here — there is no status word to map
  -- — and is kept in the list so the two constraints stay identical.
  promotion_outcome           text
    constraint netwealth_accounts_outcome_known check (promotion_outcome is null or promotion_outcome in
      ('matched', 'unmatched', 'no_value', 'status_unmapped', 'invalid_date', 'invalid_value', 'error')),
  promotion_note              text,

  unique (account_number, as_at_date)
);

create index netwealth_accounts_account_idx on ingest.netwealth_accounts (account_number);
create index netwealth_accounts_as_at_idx   on ingest.netwealth_accounts (as_at_date);
create index netwealth_accounts_pending_idx on ingest.netwealth_accounts (as_at_date, id) where promoted_at is null;

alter table ingest.netwealth_accounts enable row level security;

comment on table ingest.netwealth_accounts is
  'One Netwealth account snapshot per account per day, exactly as received from four calls: accounts, detail, cash, balance, holdings by asset class. Written by n8n as ingest_netwealth; read by ingest.promote(). Never shaped here.';
comment on column ingest.netwealth_accounts.valuation_at is
  'Netwealth''s own valuation instant from /balance. The valuation written to public.* is dated by THIS, in Australia/Sydney, not by as_at_date — Netwealth dates its figure, HUB24 does not.';
comment on column ingest.netwealth_accounts.is_exited is
  'Netwealth''s only statement of status. true closes the CRM account on date_exited_at; false never reopens one.';
comment on column ingest.netwealth_accounts.promotion_outcome is
  'matched: valuation written. unmatched: no CRM account with Netwealth as provider and this number — queued (promoted_at null) and retried every run. no_value: total_value was null. invalid_date / invalid_value: refused. error: this row raised and was rolled back alone. status_unmapped: never for this source; kept so the vocabulary matches hub24_accounts.';

-- The same changed-row rule HUB24 has, under a name that says it is generic.
-- HUB24's own trigger keeps its function; renaming a working thing gains nothing.
create or replace function ingest.landing_row_changed()
returns trigger
language plpgsql
set search_path to ''
as $fn$
declare
  v_strip text[] := array['id', 'fetched_at', 'promoted_at', 'promotion_outcome', 'promotion_note'];
begin
  if (to_jsonb(new) - v_strip) is distinct from (to_jsonb(old) - v_strip) then
    new.fetched_at        := now();
    new.promoted_at       := null;
    new.promotion_outcome := null;
    new.promotion_note    := null;
  end if;
  return new;
end $fn$;

create trigger trg_netwealth_accounts_changed
  before update on ingest.netwealth_accounts
  for each row execute function ingest.landing_row_changed();

revoke all on function ingest.landing_row_changed() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. The CRM's rules, once: what every feed does after it has matched an account
-- ---------------------------------------------------------------------------
-- Plain functions, not security definer: they are only ever reached from inside
-- promote(), which already runs as its owner, so they inherit that and add no
-- second definer surface. Revoked from every API role regardless.

create or replace function ingest.apply_valuation(
  p_account_id uuid,
  p_source     text,
  p_value      numeric,
  p_as_at      date)
returns void
language sql
set search_path to ''
as $fn$
  insert into public.financial_account_valuations
    (account_id, value, as_at, source, source_system)
  values (p_account_id, round(p_value, 2), p_as_at, 'integration', p_source)
  on conflict (account_id, as_at) do update
    set value         = excluded.value,
        source        = excluded.source,
        source_system = excluded.source_system;
$fn$;

comment on function ingest.apply_valuation(uuid, text, numeric, date) is
  'One valuation per account per day, from a feed. A same-day re-run updates the figure. The only writer of integration-sourced valuations; lifted out of promote_hub24 on 17 Sep 2026 so every feed writes them by one rule.';

create or replace function ingest.close_if_active(
  p_account_id uuid,
  p_closed_on  date)
returns boolean
language plpgsql
set search_path to ''
as $fn$
begin
  update public.financial_accounts
     set status = 'closed', closed_on = p_closed_on
   where id = p_account_id and status = 'active';
  return found;
end $fn$;

comment on function ingest.close_if_active(uuid, date) is
  'The one status move a feed may make: active -> closed. Suspended is untouched and nothing is ever reopened. Returns whether it did anything.';

create or replace function ingest.apply_snapshot(
  p_account_id           uuid,
  p_source               text,
  p_available_cash       numeric,
  p_snapshot_as_at       date,
  p_product_display_name text,
  p_label_candidate      text,
  -- Eight weights in canonical order, or NULL when the provider sent no
  -- allocation at all. A weight the provider did not report is NULL inside
  -- the array; a class it reported as zero is 0.
  p_weights              numeric[])
returns jsonb
language plpgsql
set search_path to ''
as $fn$
declare
  v_first   boolean;
  v_was     text;
  v_sum     numeric;
  v_alloc   text := 'none';
  v_classes text[] := array[
    'australian_shares', 'international_shares',
    'australian_fixed_interest', 'international_fixed_interest',
    'listed_property', 'direct_property', 'cash', 'other'];
  i         int;
begin
  -- Has any feed ever reported a product for this account? Only while the
  -- answer is no may the label be seeded; the column is sticky below, so the
  -- answer turns to yes exactly once and stays there.
  select (a.product_display_name is null), a.label into v_first, v_was
    from public.financial_accounts a where a.id = p_account_id;

  update public.financial_accounts
     set available_cash         = case when p_available_cash is null then null
                                       else round(p_available_cash, 2) end,
         snapshot_as_at         = p_snapshot_as_at,
         snapshot_source_system = p_source,
         product_display_name   = coalesce(p_product_display_name, product_display_name),
         label                  = case when v_first and p_label_candidate is not null
                                       then p_label_candidate else label end
   where id = p_account_id;

  if p_weights is not null and exists (select 1 from unnest(p_weights) w where w is not null) then
    select sum(coalesce(w, 0)) into v_sum from unnest(p_weights) w;
    if exists (select 1 from unnest(p_weights) w where w < -1 or w > 1) or abs(v_sum - 1) > 0.01 then
      v_alloc := 'skipped';
    else
      delete from public.financial_account_allocations where account_id = p_account_id;
      for i in 1..8 loop
        if coalesce(p_weights[i], 0) <> 0 then
          insert into public.financial_account_allocations (account_id, asset_class, weight)
          values (p_account_id, v_classes[i], round(p_weights[i], 6));
        end if;
      end loop;
      v_alloc := 'refreshed';
    end if;
  end if;

  return jsonb_build_object(
    'label_seeded', (v_first and p_label_candidate is not null),
    'was',          v_was,
    'allocation',   v_alloc,
    'sum',          v_sum);
end $fn$;

comment on function ingest.apply_snapshot(uuid, text, numeric, date, text, text, numeric[]) is
  'The current-state refresh every feed performs after matching an account: cash, snapshot date, sticky product string, the label seeded once, and the allocation rewritten when its eight weights are each within [-1, 1] and sum to 1 within 0.01 — otherwise left standing and reported as skipped. Lifted out of promote_hub24 on 17 Sep 2026 so the rules exist once. Returns what it did so the caller can write the landing note.';

revoke all on function ingest.apply_valuation(uuid, text, numeric, date)                            from public, anon, authenticated;
revoke all on function ingest.close_if_active(uuid, date)                                           from public, anon, authenticated;
revoke all on function ingest.apply_snapshot(uuid, text, numeric, date, text, text, numeric[])     from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. promote_hub24, rewritten onto the shared rules. Same outcomes, same
--    notes, same return shape — proved by replay on the branch.
-- ---------------------------------------------------------------------------

create or replace function ingest.promote_hub24(p_provider_party_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $fn$
declare
  r             record;
  v_account     public.financial_accounts%rowtype;
  v_crm_status  public.financial_account_status;
  v_outcome     text;
  v_note        text;
  v_matched     int := 0;
  v_unmatched   int := 0;
  v_no_value    int := 0;
  v_unmapped    int := 0;
  v_invalid     int := 0;
  v_errors      int := 0;
  v_alloc_refreshed int := 0;
  v_alloc_unmapped  int := 0;
  v_labelled    int := 0;
  v_touched     uuid[] := '{}';
  v_w           numeric[];
  v_strange     text;
  v_label       text;
  v_done        jsonb;
  v_known       text[] := array[
    'SharesAustralian', 'SharesInternational',
    'FixedInterestAustralian', 'FixedInterestInternational',
    'PropertyListedAustralian', 'PropertyListedInternational', 'PropertyDirect',
    'CashAustralian', 'CashInternational', 'Other'];
begin
  for r in
    select * from ingest.hub24_accounts
     where promoted_at is null
     order by as_at_date, id
     for update skip locked
  loop
    v_outcome := null;
    v_note    := null;

    if r.as_at_date > current_date then
      v_outcome := 'invalid_date';
    elsif r.portfolio_value is not null and r.portfolio_value < 0 then
      v_outcome := 'invalid_value';
    end if;

    begin
    if v_outcome is null then
      select a.* into v_account
        from public.financial_accounts a
       where a.provider_party_id = p_provider_party_id
         and a.account_number = r.account_number;

      if not found then
        v_outcome := 'unmatched';
      else
        if r.portfolio_value is null then
          v_outcome := 'no_value';
        else
          -- HUB24 gives no valuation date of its own, so the run's day is it.
          perform ingest.apply_valuation(v_account.id, 'hub24', r.portfolio_value, r.as_at_date);
          v_outcome := 'matched';
        end if;

        if r.account_status is not null then
          select m.crm_status into v_crm_status
            from ingest.hub24_status_map m
           where m.hub24_status = r.account_status;
          if not found then
            if v_outcome = 'matched' then v_outcome := 'status_unmapped'; end if;
            v_note := concat_ws(' ', v_note, 'status_unmapped:' || r.account_status);
          elsif v_crm_status = 'closed' then
            perform ingest.close_if_active(v_account.id, coalesce(r.closed_date, r.as_at_date));
          end if;
        end if;
      end if;
    end if;
    exception when others then
      v_outcome := 'error';
      v_note    := left(sqlerrm, 500);
    end;

    if v_outcome in ('matched', 'no_value', 'status_unmapped') then
      v_touched := array_append(v_touched, v_account.id);
    end if;

    update ingest.hub24_accounts
       set promoted_at       = case when v_outcome = 'unmatched' then null else now() end,
           promotion_outcome = v_outcome,
           promotion_note    = v_note
     where id = r.id;

    case v_outcome
      when 'matched'         then v_matched   := v_matched + 1;
      when 'status_unmapped' then v_unmapped  := v_unmapped + 1;
      when 'unmatched'       then v_unmatched := v_unmatched + 1;
      when 'no_value'        then v_no_value  := v_no_value + 1;
      when 'error'           then v_errors    := v_errors + 1;
      else                        v_invalid   := v_invalid + 1;
    end case;
  end loop;

  for r in
    select distinct on (h.account_number) h.*, a.id as account_id
      from ingest.hub24_accounts h
      join public.financial_accounts a
        on a.provider_party_id = p_provider_party_id
       and a.account_number = h.account_number
     where a.id = any(v_touched)
       and h.promotion_outcome in ('matched', 'no_value', 'status_unmapped')
     order by h.account_number, h.as_at_date desc, h.id desc
  loop
    -- "Orlando Alvarado — HUB24 Investment". Either half may be missing, and
    -- with both missing there is nothing worth calling the account.
    v_label := nullif(btrim(concat_ws(' — ',
                 nullif(btrim(coalesce(r.account_name, '')), ''),
                 nullif(btrim('HUB24 ' || coalesce(r.product_offering_type, '')), 'HUB24'))), '');

    -- HUB24's tripwire: a key in the raw allocation that no column knows. Named
    -- in the note at any weight — the quiet failure on 15 September was three
    -- shortfalls under the tolerance. Computed here, written below, so the note
    -- reads in the order the original wrote it: label, unmapped, skipped.
    select string_agg(k, ',' order by k) into v_strange
      from jsonb_object_keys(coalesce(r.asset_allocations_raw, '{}'::jsonb)) k
     where k <> all(v_known);

    -- HUB24's ten classes folded onto the CRM's eight.
    v_w := array[
      r.alloc_shares_australian,
      r.alloc_shares_international,
      r.alloc_fixed_interest_australian,
      r.alloc_fixed_interest_international,
      case when r.alloc_property_listed_australian is null and r.alloc_property_listed_international is null then null
           else coalesce(r.alloc_property_listed_australian, 0) + coalesce(r.alloc_property_listed_international, 0) end,
      r.alloc_property_direct,
      case when r.alloc_cash_australian is null and r.alloc_cash_international is null then null
           else coalesce(r.alloc_cash_australian, 0) + coalesce(r.alloc_cash_international, 0) end,
      r.alloc_other];

    v_done := ingest.apply_snapshot(
      r.account_id, 'hub24',
      r.available_to_trade, r.as_at_date,
      r.product_offering_display_name, v_label, v_w);

    if (v_done->>'label_seeded')::boolean then
      update ingest.hub24_accounts
         set promotion_note = concat_ws(' ', promotion_note,
               'label_seeded:was=' || coalesce(v_done->>'was', ''))
       where id = r.id;
      v_labelled := v_labelled + 1;
    end if;

    if v_strange is not null then
      update ingest.hub24_accounts
         set promotion_note = concat_ws(' ', promotion_note, 'allocation_unmapped:' || v_strange)
       where id = r.id;
      v_alloc_unmapped := v_alloc_unmapped + 1;
    end if;

    if v_done->>'allocation' = 'skipped' then
      update ingest.hub24_accounts
         set promotion_note = concat_ws(' ', promotion_note,
               'allocation_skipped:sum=' || round((v_done->>'sum')::numeric, 4)::text)
       where id = r.id;
    elsif v_done->>'allocation' = 'refreshed' then
      v_alloc_refreshed := v_alloc_refreshed + 1;
    end if;
  end loop;

  return jsonb_build_object(
    'source', 'hub24',
    'matched', v_matched,
    'status_unmapped', v_unmapped,
    'unmatched', v_unmatched,
    'no_value', v_no_value,
    'invalid', v_invalid,
    'errors', v_errors,
    'allocations_refreshed', v_alloc_refreshed,
    'allocations_with_unmapped_class', v_alloc_unmapped,
    'labels_seeded', v_labelled);
end $fn$;

revoke all on function ingest.promote_hub24(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 6. promote_netwealth: Netwealth's words to ours, and nothing else
-- ---------------------------------------------------------------------------

create or replace function ingest.promote_netwealth(p_provider_party_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $fn$
declare
  r             record;
  e             jsonb;
  v_account     public.financial_accounts%rowtype;
  v_outcome     text;
  v_note        text;
  v_matched     int := 0;
  v_unmatched   int := 0;
  v_no_value    int := 0;
  v_invalid     int := 0;
  v_errors      int := 0;
  v_alloc_refreshed int := 0;
  v_alloc_unmapped  int := 0;
  v_labelled    int := 0;
  v_touched     uuid[] := '{}';
  v_w           numeric[];
  v_strange     text;
  v_label       text;
  v_name        text;
  v_crm_class   text;
  v_done        jsonb;
  v_as_at       date;
  v_classes     text[] := array[
    'australian_shares', 'international_shares',
    'australian_fixed_interest', 'international_fixed_interest',
    'listed_property', 'direct_property', 'cash', 'other'];
  i             int;
begin
  for r in
    select * from ingest.netwealth_accounts
     where promoted_at is null
     order by as_at_date, id
     for update skip locked
  loop
    v_outcome := null;
    v_note    := null;

    -- The valuation is dated by Netwealth, in Sydney; the run's day only when
    -- Netwealth sent no date at all.
    v_as_at := coalesce((r.valuation_at at time zone 'Australia/Sydney')::date, r.as_at_date);

    if r.as_at_date > current_date or v_as_at > current_date then
      v_outcome := 'invalid_date';
    elsif r.total_value is not null and r.total_value < 0 then
      v_outcome := 'invalid_value';
    end if;

    begin
    if v_outcome is null then
      select a.* into v_account
        from public.financial_accounts a
       where a.provider_party_id = p_provider_party_id
         and a.account_number = r.account_number;

      if not found then
        v_outcome := 'unmatched';
      else
        if r.total_value is null then
          v_outcome := 'no_value';
        else
          perform ingest.apply_valuation(v_account.id, 'netwealth', r.total_value, v_as_at);
          v_outcome := 'matched';
        end if;

        -- The only status Netwealth states. Closed on the day Netwealth says,
        -- failing that the valuation day. Never reopened from here.
        if r.is_exited then
          perform ingest.close_if_active(v_account.id,
            coalesce((r.date_exited_at at time zone 'Australia/Sydney')::date, v_as_at));
        end if;
      end if;
    end if;
    exception when others then
      v_outcome := 'error';
      v_note    := left(sqlerrm, 500);
    end;

    if v_outcome in ('matched', 'no_value') then
      v_touched := array_append(v_touched, v_account.id);
    end if;

    update ingest.netwealth_accounts
       set promoted_at       = case when v_outcome = 'unmatched' then null else now() end,
           promotion_outcome = v_outcome,
           promotion_note    = v_note
     where id = r.id;

    case v_outcome
      when 'matched'   then v_matched   := v_matched + 1;
      when 'unmatched' then v_unmatched := v_unmatched + 1;
      when 'no_value'  then v_no_value  := v_no_value + 1;
      when 'error'     then v_errors    := v_errors + 1;
      else                  v_invalid   := v_invalid + 1;
    end case;
  end loop;

  for r in
    select distinct on (n.account_number) n.*, a.id as account_id
      from ingest.netwealth_accounts n
      join public.financial_accounts a
        on a.provider_party_id = p_provider_party_id
       and a.account_number = n.account_number
     where a.id = any(v_touched)
       and n.promotion_outcome in ('matched', 'no_value')
     order by n.account_number, n.as_at_date desc, n.id desc
  loop
    -- Who the account is for: the trust, else the non-custodial name, else the
    -- person. Then "— Netwealth Wrap". Either half may be missing.
    v_name := coalesce(
      nullif(btrim(coalesce(r.client_trust_name, '')), ''),
      nullif(btrim(coalesce(r.non_custodial_account_name, '')), ''),
      nullif(btrim(concat_ws(' ', nullif(btrim(coalesce(r.client_first_name, '')), ''),
                                  nullif(btrim(coalesce(r.client_last_name, '')), ''))), ''));
    v_label := nullif(btrim(concat_ws(' — ',
                 v_name,
                 nullif(btrim('Netwealth ' || coalesce(initcap(lower(r.account_type)), '')), 'Netwealth'))), '');

    -- Words to weights. Every class must have a row in the map; one that does
    -- not skips the whole allocation and names itself, so the picture is never
    -- written with a class quietly missing. Two Netwealth words mapping to one
    -- CRM class add up.
    v_w := null;
    v_strange := null;
    if r.asset_classes_raw is not null and jsonb_typeof(r.asset_classes_raw) = 'array'
       and jsonb_array_length(r.asset_classes_raw) > 0 then
      v_w := array_fill(null::numeric, array[8]);
      for e in select * from jsonb_array_elements(r.asset_classes_raw) loop
        select m.crm_class into v_crm_class
          from ingest.netwealth_asset_class_map m
         where m.netwealth_class = e->>'assetClass';
        if not found then
          v_strange := concat_ws(',', v_strange, coalesce(e->>'assetClass', '?'));
        else
          i := array_position(v_classes, v_crm_class);
          v_w[i] := coalesce(v_w[i], 0) + coalesce((e->>'totalAssetClassPercentageValue')::numeric, 0);
        end if;
      end loop;
      -- An unknown word voids the whole picture; the note is written below, in
      -- the same order HUB24's reads: label, unmapped, skipped.
      if v_strange is not null then
        v_w := null;
      end if;
    end if;

    v_done := ingest.apply_snapshot(
      r.account_id, 'netwealth',
      r.available_cash,
      -- The day the cash was struck, which Netwealth states; the run's day if not.
      coalesce((r.cash_effective_at at time zone 'Australia/Sydney')::date, r.as_at_date),
      r.product_option, v_label, v_w);

    if (v_done->>'label_seeded')::boolean then
      update ingest.netwealth_accounts
         set promotion_note = concat_ws(' ', promotion_note,
               'label_seeded:was=' || coalesce(v_done->>'was', ''))
       where id = r.id;
      v_labelled := v_labelled + 1;
    end if;

    if v_strange is not null then
      update ingest.netwealth_accounts
         set promotion_note = concat_ws(' ', promotion_note, 'allocation_unmapped:' || v_strange)
       where id = r.id;
      v_alloc_unmapped := v_alloc_unmapped + 1;
    end if;

    if v_done->>'allocation' = 'skipped' then
      update ingest.netwealth_accounts
         set promotion_note = concat_ws(' ', promotion_note,
               'allocation_skipped:sum=' || round((v_done->>'sum')::numeric, 4)::text)
       where id = r.id;
    elsif v_done->>'allocation' = 'refreshed' then
      v_alloc_refreshed := v_alloc_refreshed + 1;
    end if;
  end loop;

  return jsonb_build_object(
    'source', 'netwealth',
    'matched', v_matched,
    'status_unmapped', 0,
    'unmatched', v_unmatched,
    'no_value', v_no_value,
    'invalid', v_invalid,
    'errors', v_errors,
    'allocations_refreshed', v_alloc_refreshed,
    'allocations_with_unmapped_class', v_alloc_unmapped,
    'labels_seeded', v_labelled);
end $fn$;

revoke all on function ingest.promote_netwealth(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 7. The door gains its second branch
-- ---------------------------------------------------------------------------

create or replace function ingest.promote(p_source text)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $fn$
declare
  v_src ingest.sources%rowtype;
begin
  select * into v_src from ingest.sources where source_system = p_source;
  if not found then
    raise exception 'Unknown source %', p_source;
  end if;
  if not v_src.enabled then
    raise exception 'Source % is disabled', p_source;
  end if;

  case p_source
    when 'hub24'     then return ingest.promote_hub24(v_src.provider_party_id);
    when 'netwealth' then return ingest.promote_netwealth(v_src.provider_party_id);
    else raise exception 'No promotion is written for %', p_source;
  end case;
end $fn$;

revoke all on function ingest.promote(text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 8. The unmatched queue, Netwealth's
-- ---------------------------------------------------------------------------

create view ingest.netwealth_unmatched as
select distinct on (n.account_number)
  n.account_number,
  coalesce(nullif(n.client_trust_name, ''), nullif(n.non_custodial_account_name, ''),
           nullif(btrim(concat_ws(' ', n.client_first_name, n.client_last_name)), '')) as account_name,
  n.account_type,
  n.product_option,
  n.adviser_code,
  n.total_value          as latest_value,
  n.as_at_date           as latest_as_at,
  count(*) over (partition by n.account_number) as days_waiting
from ingest.netwealth_accounts n
where n.promotion_outcome = 'unmatched'
order by n.account_number, n.as_at_date desc, n.id desc;

comment on view ingest.netwealth_unmatched is
  'Netwealth accounts the CRM has no row for. Resolution: add the account with Netwealth Investments Limited as the provider and this account_number, and the next promotion places every day it has accumulated.';

-- ---------------------------------------------------------------------------
-- 9. The role n8n connects as for Netwealth. Blind to HUB24's table by having
--    no grant on it — the same way HUB24's role is blind to this one.
-- ---------------------------------------------------------------------------
-- NOLOGIN until a password is set, once, out of band, in the SQL editor:
--   alter role ingest_netwealth login password '...' valid until '2027-03-17';
-- The password appears in no file. Guarded, because roles live at the cluster
-- and survive a branch reset.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'ingest_netwealth') then
    create role ingest_netwealth nologin noinherit connection limit 3;
  end if;
end $$;
alter role ingest_netwealth set statement_timeout = '60s';
alter role ingest_netwealth set search_path = 'ingest';

grant usage on schema ingest to ingest_netwealth;
grant select, insert, update on ingest.netwealth_accounts to ingest_netwealth;
grant usage, select on all sequences in schema ingest to ingest_netwealth;
grant select on ingest.sources to ingest_netwealth;
grant select on ingest.netwealth_asset_class_map to ingest_netwealth;
grant select on ingest.netwealth_unmatched to ingest_netwealth;
grant execute on function ingest.promote(text) to ingest_netwealth;
-- And NOTHING on public, and nothing on hub24_accounts. The probes on the
-- branch: `select from ingest.hub24_accounts` as this role and
-- `select from ingest.netwealth_accounts` as ingest_hub24, both expecting
-- permission denied.

-- RLS is on every landing table; this role is the one principal that needs
-- through it, and the promotion function is the owner and bypasses it. Without
-- these three the grants above are hollow — found by reading HUB24's migration
-- rather than by a refused insert, which is the cheaper way round.
create policy netwealth_accounts_feed on ingest.netwealth_accounts
  for all to ingest_netwealth using (true) with check (true);
create policy sources_feed_read_netwealth on ingest.sources
  for select to ingest_netwealth using (true);
create policy netwealth_asset_class_map_feed_read on ingest.netwealth_asset_class_map
  for select to ingest_netwealth using (true);

-- Nothing in ingest.* for the API roles, restated for the new objects.
revoke all on all tables    in schema ingest from public, anon, authenticated;
revoke all on all sequences in schema ingest from public, anon, authenticated;
revoke all on all functions in schema ingest from public, anon, authenticated;

-- The sequence grant above is "all sequences", which now includes Netwealth's
-- identity sequence for HUB24's role too — a read of a sequence value is
-- harmless, but the grant is trimmed so each role holds exactly its own.
revoke usage, select on all sequences in schema ingest from ingest_hub24, ingest_netwealth;
grant usage, select on sequence ingest.hub24_accounts_id_seq     to ingest_hub24;
grant usage, select on sequence ingest.netwealth_accounts_id_seq to ingest_netwealth;

comment on schema ingest is
  'Landing zone for external feeds. Not exposed through PostgREST. One table per source, written by that source''s own database role; promoted into public.* only through ingest.promote(), whose per-source functions map the provider''s words and then call the shared apply_valuation()/apply_snapshot(). HUB24 since 15 Sep 2026, Netwealth since 17 Sep 2026.';
