-- HUB24 lands, and a promotion carries it into the accounts (15 Sep 2026)
--
-- An n8n workflow pulls a daily snapshot of every investment account from
-- HUB24 and writes it here. The CRM has had the tables to receive it since
-- 1 September — financial_accounts and one valuation per account per day, with
-- a thirty-day trend computed from exactly this cadence — and nothing has ever
-- written a valuation after an account's opening one. The summary view was
-- rewritten on 10 September to survive "the first time valuations are imported
-- in bulk". This is that import, and the first external writer this database
-- has had.
--
-- THREE LAYERS, and the boundary between the second and third is the design:
--
--   n8n, as role ingest_hub24  ->  ingest.hub24_accounts  ->  ingest.promote('hub24')  ->  public.*
--   one Postgres credential        every HUB24 field, raw,    security definer, the      valuations upserted
--   that can reach one table       one row per account/day   ONLY door into public      status via a map
--                                                                                        cash + allocation refreshed
--
-- Provider quirks stop at the landing table. Netwealth and the third platform
-- will each get their own landing table, their own role and their own
-- promote_<source>(), and all three write the same canonical rows.
--
-- WHY A DATABASE ROLE AND NOT THE API. PostgREST offers a machine exactly two
-- identities: the publishable key, which is `anon` and has held nothing since
-- 3 September, and the secret key, which is `service_role` and bypasses every
-- policy in the schema. There is no per-role API key. n8n's own Supabase node is
-- built around the secret key — which is the thing this project's rules forbid
-- anywhere. A role is the only credential that can write one table and touch
-- nothing else, and Postgres authenticates it with SCRAM over TLS rather than
-- with anything written here. `is_elevated_context()` returns true for a direct
-- connection and it does not matter: a bypass over privileges the role does
-- not hold bypasses nothing.
--
-- THE SCHEMA IS NOT EXPOSED. PostgREST serves `public` and `graphql_public`;
-- nothing in `ingest` is reachable through the API by construction, which is a
-- stronger guarantee than the grant-stripping the project has relied on so
-- far, and the right one for raw provider data no staff member should read
-- unshaped. Proved by probe on the branch, not assumed. RLS is enabled on every
-- table here regardless — the standing rule, and belt over braces.
--
-- Decided with the reader on 15 September: the connection model above; the
-- feed closes an account HUB24 reports closed, through a mapping table, and
-- flags a word it does not know rather than guessing; available cash and the
-- asset allocation are current values on the account, refreshed daily, with no
-- history — every field still lands raw.

-- ---------------------------------------------------------------------------
-- 1. The landing schema
-- ---------------------------------------------------------------------------

create schema ingest;
revoke all on schema ingest from public;

comment on schema ingest is
  'Landing zone for external feeds. Not exposed through PostgREST. One table per source, written by that source''s own database role; promoted into public.* only through ingest.promote(). Added 15 Sep 2026 for HUB24.';

-- ---------------------------------------------------------------------------
-- 2. The registry: one row per integration
-- ---------------------------------------------------------------------------

create table ingest.sources (
  source_system     text primary key
    constraint ingest_sources_key check (source_system ~ '^[a-z][a-z0-9_]*$'),
  provider_party_id uuid not null references public.parties(id) on delete restrict,
  role_name         text not null,
  enabled           boolean not null default true,
  created_at        timestamptz not null default now()
);
alter table ingest.sources enable row level security;
-- One row per provider, so the index is for the advisor rather than the planner.
create index sources_provider_idx on ingest.sources (provider_party_id);

comment on table ingest.sources is
  'Every external feed, one row each. `promote()` reads it. A misbehaving feed is switched off with an UPDATE of `enabled`, not a revoke. The same vocabulary as notes.source_system.';
comment on column ingest.sources.provider_party_id is
  'The product_provider party this source''s accounts belong to. What a landing row''s account_number is matched against, together with the number itself.';

-- ---------------------------------------------------------------------------
-- 3. HUB24 as a party. Nothing today can create an organisation party — only
--    person write paths exist — and the Add account modal's provider select is
--    disabled reading "None recorded yet" for exactly this reason. A fixed id,
--    so the registry row below and every future reference are stable.
-- ---------------------------------------------------------------------------

insert into public.parties (id, party_type, status)
values ('6f0b0c24-0000-4000-8000-000000000024', 'organisation', 'active');

-- display_name is set from legal_name by trigger. ABN deliberately left null:
-- a company identifier is a fact to be entered from a document, not from
-- memory in a migration.
insert into public.organisations (party_id, legal_name, entity_type)
values ('6f0b0c24-0000-4000-8000-000000000024', 'HUB24 Limited', 'company');

insert into public.party_roles (party_id, role, status)
values ('6f0b0c24-0000-4000-8000-000000000024', 'product_provider', 'active');

insert into ingest.sources (source_system, provider_party_id, role_name)
values ('hub24', '6f0b0c24-0000-4000-8000-000000000024', 'ingest_hub24');

-- ---------------------------------------------------------------------------
-- 4. HUB24's status words -> the CRM's. SEEDED FROM THE FIRST REAL RUN, not
--    guessed here: until a word has a row the feed flags it and leaves the
--    account alone.
-- ---------------------------------------------------------------------------

create table ingest.hub24_status_map (
  hub24_status text primary key,
  crm_status   public.financial_account_status not null,
  created_at   timestamptz not null default now()
);
alter table ingest.hub24_status_map enable row level security;

comment on table ingest.hub24_status_map is
  'What HUB24 calls an account''s state, mapped to active/closed. A word with no row is flagged as status_unmapped and never acted on. The feed only ever moves an account active -> closed; suspended and any reopening stay decisions a person makes.';

-- ---------------------------------------------------------------------------
-- 5. The landing table. The reader's own schema, kept, with the changes the
--    header records.
-- ---------------------------------------------------------------------------

create table ingest.hub24_accounts (
  id                            bigint generated always as identity primary key,
  as_at_date                    date        not null,
  account_number                text        not null
    constraint hub24_accounts_number_not_blank check (length(trim(account_number)) > 0),
  account_type                  text,
  account_name                  text,
  account_group_name            text,
  account_status                text,
  creation_date                 date,
  inception_date                date,
  closed_date                   date,
  adviser_login_id              text,
  adviser_name                  text,
  practice_name                 text,
  organisation_name             text,
  product_offering_type         text,
  product_offering_display_name text,

  -- Available cash
  available_to_trade            numeric,
  cash_as_at_timestamp          timestamptz,

  -- Portfolio / asset allocation. Fractions of one, as HUB24 sends them.
  portfolio_value               numeric,
  alloc_shares_australian             numeric,
  alloc_shares_international          numeric,
  alloc_fixed_interest_australian     numeric,
  alloc_fixed_interest_international  numeric,
  alloc_property_listed_australian    numeric,
  alloc_cash_australian               numeric,
  alloc_cash_international            numeric,
  alloc_other                         numeric,
  asset_allocations_raw         jsonb,

  -- THE WHOLE RECORD. The flat columns are the fields seen so far;
  -- PropertyListedAustralian appeared on some accounts and not others, which
  -- is the proof that a field will arrive before a column exists for it.
  payload                       jsonb       not null,

  fetched_at                    timestamptz not null default now(),

  -- What became of this row. Reconciliation — "what did the feed write today,
  -- and what could it not place?" — is a filter here, not a scan of valuations.
  -- promoted_at stays NULL while a row is still waiting: never tried, or tried
  -- and unmatched (outcome says which). Those are retried every run.
  promoted_at                   timestamptz,
  promotion_outcome             text
    constraint hub24_accounts_outcome_known check (promotion_outcome is null or promotion_outcome in
      ('matched', 'unmatched', 'no_value', 'status_unmapped', 'invalid_date', 'invalid_value', 'error')),
  promotion_note                text,

  -- One row per account per day; a same-day re-run updates rather than
  -- duplicates.
  unique (account_number, as_at_date)
);

create index hub24_accounts_account_idx on ingest.hub24_accounts (account_number);
create index hub24_accounts_as_at_idx   on ingest.hub24_accounts (as_at_date);
-- The promotion's work queue.
create index hub24_accounts_pending_idx on ingest.hub24_accounts (as_at_date, id) where promoted_at is null;

alter table ingest.hub24_accounts enable row level security;

comment on table ingest.hub24_accounts is
  'One HUB24 account snapshot per account per day, exactly as received. Written by n8n as ingest_hub24; read by ingest.promote(). Never shaped here — promotion is where HUB24''s vocabulary becomes the CRM''s.';
comment on column ingest.hub24_accounts.payload is
  'The entire HUB24 record for this account and day. The flat columns are a convenience over this; a field HUB24 adds tomorrow is already here.';
comment on column ingest.hub24_accounts.promotion_outcome is
  'matched: valuation written. unmatched: no CRM account with this provider and number — the row stays queued (promoted_at null) and is retried every run; add the account and the next promotion places every day it has accumulated. no_value: portfolio_value was null. status_unmapped: valuation written, account_status has no row in hub24_status_map. invalid_date / invalid_value: refused, nothing written. error: this row raised (see promotion_note) and was rolled back on its own; the rest of the run went through.';

-- A same-day re-run that CHANGES a row gets promoted again; one that changes
-- nothing does not. Compared as jsonb with the bookkeeping columns removed, so
-- a column added to this table later is compared without anybody remembering
-- to add it here.
create or replace function ingest.hub24_row_changed()
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

create trigger trg_hub24_accounts_changed
  before update on ingest.hub24_accounts
  for each row execute function ingest.hub24_row_changed();

revoke all on function ingest.hub24_row_changed() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 6. The accounts table: a real key to match on, and the current-state fields
-- ---------------------------------------------------------------------------

-- Nothing stopped two accounts sharing a number until now; a feed cannot be
-- allowed to pick one. Partial, because accounts with no provider recorded
-- (every existing row) may legitimately reuse a number across providers.
create unique index financial_accounts_provider_number_key
  on public.financial_accounts (provider_party_id, account_number)
  where provider_party_id is not null;

alter table public.financial_accounts
  add column available_cash          numeric(14,2),
  add column snapshot_as_at          date,
  add column snapshot_source_system  text;

comment on column public.financial_accounts.available_cash is
  'Cash available to trade, as the provider last reported it. A CURRENT value refreshed by each feed run, not a series — decided 15 Sep 2026. NULL where no feed reports one.';
comment on column public.financial_accounts.snapshot_as_at is
  'The day available_cash and the rows in financial_account_allocations were taken. Set only by ingest.promote().';
comment on column public.financial_accounts.snapshot_source_system is
  'Which feed last refreshed the current-state fields. The same vocabulary as ingest.sources.source_system.';

-- ---------------------------------------------------------------------------
-- 7. The allocation: current state only, one row per asset class
-- ---------------------------------------------------------------------------

-- A table rather than eight nullable columns on the account: a new asset class
-- is a check-constraint value, not an ALTER TABLE, and a provider that reports
-- five classes leaves no null columns behind. text + check rather than an enum
-- because this is a closed set that WILL grow — the third platform will bring
-- a class HUB24 does not have — and an enum value cannot be used in the
-- transaction that adds it.
create table public.financial_account_allocations (
  account_id  uuid not null references public.financial_accounts(id) on delete cascade,
  asset_class text not null
    constraint financial_account_allocations_class_known check (asset_class in (
      'australian_shares', 'international_shares',
      'australian_fixed_interest', 'international_fixed_interest',
      'listed_property', 'cash', 'other')),
  -- A fraction of one, as every provider reports it. 0.2456 is 24.56%.
  weight      numeric(7,6) not null
    constraint financial_account_allocations_weight_range check (weight >= 0 and weight <= 1),
  updated_at  timestamptz not null default now(),
  primary key (account_id, asset_class)
);

alter table public.financial_account_allocations enable row level security;

-- Readable exactly where the account is. NO insert, update or delete policy
-- for staff: these rows are what the provider said, and only ingest.promote()
-- writes them. A hand-edited allocation would be overwritten by the next run
-- anyway, which is the wrong way to find out it was not the place to type.
create policy account_allocations_select on public.financial_account_allocations
  for select to authenticated
  using (public.staff_can_access_account(account_id));

comment on table public.financial_account_allocations is
  'How an account is currently allocated across the standard asset classes, as its provider last reported — CURRENT STATE, refreshed by each feed run, no history. The landing table under ingest.* is the record of every day. Not audited for the same reason.';

-- ---------------------------------------------------------------------------
-- 8. Provenance on valuations: the notes shape
-- ---------------------------------------------------------------------------

-- `source` has been free text since 1 September and two values have ever been
-- written: manual and seed. It is closed now, and an integration row must name
-- its system — the check the notes table has carried since July. The MCP
-- promises that latest_value "is the most recent RECORDED valuation"; knowing
-- whether HUB24 or a hand recorded it is what that promise is worth.
alter table public.financial_account_valuations
  add column source_system text;

alter table public.financial_account_valuations
  alter column source set default 'manual';
update public.financial_account_valuations set source = 'manual' where source is null;
alter table public.financial_account_valuations
  alter column source set not null;

alter table public.financial_account_valuations
  add constraint financial_account_valuations_source_known
    check (source in ('manual', 'seed', 'integration')),
  -- Integration if and only if a system is named. One expression, both ways.
  add constraint financial_account_valuations_integration_fields
    check ((source = 'integration') = (source_system is not null));

comment on column public.financial_account_valuations.source is
  'manual: typed by a staff member. seed: test data. integration: written by a feed, which must be named in source_system. Closed on 15 Sep 2026; was free text.';
comment on column public.financial_account_valuations.source_system is
  'Which feed wrote this row, e.g. hub24. Required for source = integration, forbidden otherwise. The same vocabulary as ingest.sources.';

-- ---------------------------------------------------------------------------
-- 9. Audit: the trail, not the noise
-- ---------------------------------------------------------------------------

-- One audit row per account per day, forever, each carrying the full row as
-- jsonb, in an append-only admin-only table, is volume without information:
-- the landing table IS the immutable record of what the feed said, down to the
-- payload. Manual valuations stay audited exactly as they were. A status change
-- the feed makes to financial_accounts stays audited too — that is rare and
-- worth reading.
--
-- TWO triggers rather than one: a WHEN clause on an INSERT trigger may not
-- reference OLD and one on a DELETE trigger may not reference NEW, so a single
-- insert-or-update-or-delete trigger cannot carry this condition.
drop trigger trg_financial_account_valuations_audit on public.financial_account_valuations;

create trigger trg_financial_account_valuations_audit_write
  after insert or update on public.financial_account_valuations
  for each row
  when (new.source is distinct from 'integration')
  execute function public.record_audit('id', '');

create trigger trg_financial_account_valuations_audit_delete
  after delete on public.financial_account_valuations
  for each row
  when (old.source is distinct from 'integration')
  execute function public.record_audit('id', '');

-- The accounts audit stops seeing the three columns the feed refreshes every
-- day. record_audit already treats an update that changes nothing else as a
-- non-event, so a cash refresh writes no audit row and a status change still
-- does — proved on the branch: zero rows from two refresh runs, one row with
-- changed_fields = {closed_on, status} from a close. Nothing but promote()
-- writes these columns, so nothing is lost.
drop trigger trg_financial_accounts_audit on public.financial_accounts;
create trigger trg_financial_accounts_audit
  after insert or update or delete on public.financial_accounts
  for each row execute function public.record_audit('id', 'available_cash,snapshot_as_at,snapshot_source_system');

-- ---------------------------------------------------------------------------
-- 10. Promotion: the only door from ingest.* into public.*
-- ---------------------------------------------------------------------------

-- Owned by postgres, so it may write public.* whatever role called it. That is
-- the point and the whole risk, which is why the only thing it accepts is a
-- source name and the only rows it reads are that source's own landing rows.
--
-- A NOTE ON ATTRIBUTION. Inside a security definer function `current_user` is
-- the owner, so audit_log.db_user reads `postgres` for the rare status change
-- this makes — not the integration role. The integration is attributed through
-- the landing row (promoted_at, promotion_outcome) and through
-- snapshot_source_system / valuations.source_system on the canonical side.
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
  v_touched     uuid[] := '{}';
  v_sum         numeric;
  v_w           numeric[];
  v_classes     text[] := array[
    'australian_shares', 'international_shares',
    'australian_fixed_interest', 'international_fixed_interest',
    'listed_property', 'cash', 'other'];
  i             int;
begin
  -- Oldest first, so an account added to the CRM today has its history land in
  -- order. SKIP LOCKED so a retry running beside this one takes different rows
  -- rather than blocking on the same ones.
  for r in
    select * from ingest.hub24_accounts
     where promoted_at is null
     order by as_at_date, id
     for update skip locked
  loop
    v_outcome := null;
    v_note    := null;

    -- What the feed is fed is validated before anything is written. A garbage
    -- row — from a compromised feed or a malfunctioning one — is refused with
    -- an outcome, not promoted.
    if r.as_at_date > current_date then
      v_outcome := 'invalid_date';
    elsif r.portfolio_value is not null and r.portfolio_value < 0 then
      v_outcome := 'invalid_value';
    end if;

    -- One row's failure — a closed_date before opened_on tripping the
    -- accounts date-order check, say — is that row's outcome, not the
    -- whole run's. A subtransaction per row costs little at this volume.
    begin
    if v_outcome is null then
      select a.* into v_account
        from public.financial_accounts a
       where a.provider_party_id = p_provider_party_id
         and a.account_number = r.account_number;

      if not found then
        v_outcome := 'unmatched';
      else
        -- The valuation. Zero is written: a zero balance is a fact.
        if r.portfolio_value is null then
          v_outcome := 'no_value';
        else
          insert into public.financial_account_valuations
            (account_id, value, as_at, source, source_system)
          values (v_account.id, round(r.portfolio_value, 2), r.as_at_date, 'integration', 'hub24')
          on conflict (account_id, as_at) do update
            set value = excluded.value,
                source = excluded.source,
                source_system = excluded.source_system;
          v_outcome := 'matched';
        end if;

        -- Status, through the map. The feed only ever CLOSES, and only an
        -- account that is active — never reopens, never suspends.
        if r.account_status is not null then
          select m.crm_status into v_crm_status
            from ingest.hub24_status_map m
           where m.hub24_status = r.account_status;
          if not found then
            if v_outcome = 'matched' then v_outcome := 'status_unmapped'; end if;
            v_note := concat_ws(' ', v_note, 'status_unmapped:' || r.account_status);
          elsif v_crm_status = 'closed' and v_account.status = 'active' then
            update public.financial_accounts
               set status = 'closed',
                   closed_on = coalesce(r.closed_date, r.as_at_date)
             where id = v_account.id;
          end if;
        end if;
      end if;
    end if;
    exception when others then
      v_outcome := 'error';
      v_note    := left(sqlerrm, 500);
    end;

    -- Only a row that went through drives the refresh below.
    if v_outcome in ('matched', 'no_value', 'status_unmapped') then
      v_touched := array_append(v_touched, v_account.id);
    end if;

    -- An unmatched row is NOT stamped: it stays in the queue and is tried
    -- again every run, so the day a person adds the account, every day it has
    -- accumulated lands at once. Proved on the branch — the first cut stamped
    -- them, and adding the account did nothing.
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

  -- Current-state fields, from each touched account's NEWEST landing row —
  -- which may be older than today if today's row was refused.
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
    update public.financial_accounts
       set available_cash         = case when r.available_to_trade is null then null
                                         else round(r.available_to_trade, 2) end,
           snapshot_as_at         = r.as_at_date,
           snapshot_source_system = 'hub24'
     where id = r.account_id;

    -- HUB24's eight classes onto the canonical seven. International cash
    -- folds into cash. Refreshed only when the weights are worth having:
    -- each in [0,1] and summing to within one per cent of one; otherwise the
    -- previous allocation is kept and the row says why.
    v_w := array[
      r.alloc_shares_australian,
      r.alloc_shares_international,
      r.alloc_fixed_interest_australian,
      r.alloc_fixed_interest_international,
      r.alloc_property_listed_australian,
      coalesce(r.alloc_cash_australian, 0) + coalesce(r.alloc_cash_international, 0),
      r.alloc_other];

    if r.alloc_shares_australian is null and r.alloc_shares_international is null
       and r.alloc_fixed_interest_australian is null and r.alloc_fixed_interest_international is null
       and r.alloc_property_listed_australian is null and r.alloc_cash_australian is null
       and r.alloc_cash_international is null and r.alloc_other is null then
      continue; -- nothing reported: leave what is there
    end if;

    select sum(coalesce(w, 0)) into v_sum from unnest(v_w) w;
    if exists (select 1 from unnest(v_w) w where w < 0 or w > 1) or abs(v_sum - 1) > 0.01 then
      update ingest.hub24_accounts
         set promotion_note = concat_ws(' ', promotion_note,
               'allocation_skipped:sum=' || round(v_sum, 4)::text)
       where id = r.id;
      continue;
    end if;

    delete from public.financial_account_allocations where account_id = r.account_id;
    for i in 1..7 loop
      if coalesce(v_w[i], 0) > 0 then
        insert into public.financial_account_allocations (account_id, asset_class, weight)
        values (r.account_id, v_classes[i], round(v_w[i], 6));
      end if;
    end loop;
    v_alloc_refreshed := v_alloc_refreshed + 1;
  end loop;

  return jsonb_build_object(
    'source', 'hub24',
    'matched', v_matched,
    'status_unmapped', v_unmapped,
    'unmatched', v_unmatched,
    'no_value', v_no_value,
    'invalid', v_invalid,
    'errors', v_errors,
    'allocations_refreshed', v_alloc_refreshed);
end $fn$;

-- The door. One argument, the registry decides the rest. Every future source
-- adds a branch here and a promote_<source>() beside it.
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
    when 'hub24' then return ingest.promote_hub24(v_src.provider_party_id);
    else raise exception 'No promotion is written for %', p_source;
  end case;
end $fn$;

comment on function ingest.promote(text) is
  'Carries every unpromoted landing row for a source into public.*: valuations upserted, status closed through the map, cash and allocation refreshed from the newest row. Idempotent — a row is promoted once unless a re-run changes it. Returns counts by outcome.';

-- Only the door is callable by anyone but postgres.
revoke all on function ingest.promote(text)          from public, anon, authenticated;
revoke all on function ingest.promote_hub24(uuid)    from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 11. The unmatched queue, for a person or a future MCP tool
-- ---------------------------------------------------------------------------

create view ingest.hub24_unmatched as
select distinct on (h.account_number)
  h.account_number,
  h.account_name,
  h.account_group_name,
  h.product_offering_display_name,
  h.adviser_name,
  h.practice_name,
  h.portfolio_value      as latest_value,
  h.as_at_date           as latest_as_at,
  count(*) over (partition by h.account_number) as days_waiting
from ingest.hub24_accounts h
where h.promotion_outcome = 'unmatched'
order by h.account_number, h.as_at_date desc, h.id desc;

comment on view ingest.hub24_unmatched is
  'HUB24 accounts the CRM has no row for. Resolution: add the account with HUB24 as the provider and this account_number, and the next promotion places every day it has accumulated. The adviser columns are the routing hint for a later mapping to staff.';

-- ---------------------------------------------------------------------------
-- 12. The role n8n connects as
-- ---------------------------------------------------------------------------

-- NOLOGIN until a password is set, once, out of band, in the SQL editor:
--   alter role ingest_hub24 login password '...';
-- The password appears in no file. Three connections is more than n8n needs
-- and few enough that a runaway workflow cannot exhaust the pooler.
-- Roles live at the cluster, not in the database, so a branch RESET keeps the
-- role while it replays this file: guarded, or every later reset would fail
-- here. Found on the branch on 15 Sep.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'ingest_hub24') then
    create role ingest_hub24 nologin noinherit connection limit 3;
  end if;
end $$;
alter role ingest_hub24 set statement_timeout = '60s';
-- Applied when the role LOGS IN, so n8n may write `hub24_accounts` unqualified.
-- (Not applied by SET ROLE — a probe that switches role must qualify.)
alter role ingest_hub24 set search_path = 'ingest';

grant usage on schema ingest to ingest_hub24;
grant select, insert, update on ingest.hub24_accounts to ingest_hub24;
grant usage, select on all sequences in schema ingest to ingest_hub24;
grant select on ingest.sources to ingest_hub24;
grant select on ingest.hub24_status_map to ingest_hub24;
grant select on ingest.hub24_unmatched to ingest_hub24;
grant execute on function ingest.promote(text) to ingest_hub24;
-- And NOTHING on public. There is no grant to give: a new role holds none, and
-- none is added here. The probe on the branch is `select from
-- public.financial_accounts` as this role, expecting permission denied.

-- RLS is enabled on every landing table; this role is the one principal that
-- needs through it, and the promotion function is the owner and bypasses it.
create policy hub24_accounts_feed on ingest.hub24_accounts
  for all to ingest_hub24 using (true) with check (true);
create policy sources_feed_read on ingest.sources
  for select to ingest_hub24 using (true);
create policy hub24_status_map_feed_read on ingest.hub24_status_map
  for select to ingest_hub24 using (true);

-- ---------------------------------------------------------------------------
-- 13. Nothing in ingest.* for the API roles; the new public object narrowed
-- ---------------------------------------------------------------------------

revoke all on all tables    in schema ingest from public, anon, authenticated;
revoke all on all sequences in schema ingest from public, anon, authenticated;
revoke all on all functions in schema ingest from public, anon, authenticated;

-- Supabase's default privileges hand a new public table to authenticated in
-- full. Narrowed here, in the migration that creates it, to what the policy
-- justifies: reading.
revoke all on public.financial_account_allocations from public, anon, authenticated;
grant select on public.financial_account_allocations to authenticated;
