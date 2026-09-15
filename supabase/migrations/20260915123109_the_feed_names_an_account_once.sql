-- The feed names an account once, and records its product (15 Sep 2026)
--
-- Migration 95 deliberately left `label` and `account_type` alone, on the
-- grounds that the adviser owns them. That still holds for `account_type`, and
-- it was too strong for `label`: an account added purely so a HUB24 feed can
-- attach to it starts life with a placeholder nobody wants to type, and stays
-- that way.
--
-- WHAT THIS IS NOT. The obvious candidate, `ProductOfferingDisplayName`, is the
-- wrong field for a name and the first real run proved it twice over:
--
--   * Eleven of the twenty accounts share one string. As a label it would tell
--     an adviser nothing about which account they are looking at.
--   * EVERY CLOSED ACCOUNT CARRIES THE WORD "ACTIVE" in it — all five of them,
--     e.g. "HUB24 Invest (CHOICE Dimensional Nil MFF) ACTIVE" on an account
--     HUB24 itself reports Closed. The word describes the product being open to
--     new business, not the account. On the label of an account this feed has
--     just closed it would be a lie on the screen.
--
-- It is a fee-schedule identifier, so it gets a field of its own where saying
-- ACTIVE is harmless, and the label is built from the fields that actually
-- identify the account.
--
-- THE LABEL IS SEEDED EXACTLY ONCE: only while `product_display_name` is still
-- null, which is true before the first feed run for an account and false
-- forever after, because the column is sticky (a provider that stops sending a
-- product name does not clear it). So an adviser who renames the account keeps
-- that name for good — a label the feed rewrote nightly would make the field
-- useless to the people who own it.
--
-- THE ONE COST, STATED PLAINLY BECAUSE A BRANCH PROBE CAUGHT IT: a label typed
-- BEFORE the account is first matched is replaced by that first run. There is
-- no way to tell a name somebody chose from the placeholder the modal obliged
-- them to type, so the rule is "name it after linking, not before". The probe
-- created an account called "Reece - family super, DO NOT RENAME" and the first
-- run duly renamed it, which is why the previous label is now written into the
-- landing row's note as `label_seeded:was=<old label>` — the feed overwrites it
-- once, and never loses it.
--
-- The format is the holder and the product, which is what distinguishes two
-- accounts inside one household: "Orlando Alvarado — HUB24 Investment" beside
-- "Julian Byers — HUB24 Pension". Taken from `account_name` and
-- `product_offering_type`, never from `account_type` — the two disagree on real
-- records (24035500 is a superfund with a corporate trustee whose product type
-- reads Investment), and the CRM's own account_type stays the adviser's.

-- ---------------------------------------------------------------------------
-- 1. The product, in a field where it means something
-- ---------------------------------------------------------------------------

alter table public.financial_accounts
  add column product_display_name text;

comment on column public.financial_accounts.product_display_name is
  'The provider''s own name for the product this account sits in, e.g. "HUB24 Invest (CHOICE Dimensional Nil MFF) ACTIVE" — a fee-schedule identifier, refreshed by each feed run and sticky (a run that reports none leaves the last one standing). NOT a name for the account: eleven of the first twenty accounts shared one string and every closed account''s contains the word ACTIVE. See financial_accounts.label.';

comment on column public.financial_accounts.label is
  'What staff call this account. The adviser owns it. A feed seeds it ONCE, on the first run that reports a product for the account, and never touches it again — so a rename made after that first run sticks. A name typed BEFORE the first match is replaced by it, and the old one is recorded on the landing row as label_seeded:was=... Accounts with no provider feed are never touched at all.';

-- Accounts a feed has already matched keep their label (there is no way to know
-- whether it was chosen or typed in a hurry) but gain the product now, from
-- their newest landing row.
update public.financial_accounts a
   set product_display_name = h.product_offering_display_name
  from (select distinct on (account_number) account_number, product_offering_display_name
          from ingest.hub24_accounts
         where promotion_outcome in ('matched', 'no_value', 'status_unmapped')
           and product_offering_display_name is not null
         order by account_number, as_at_date desc, id desc) h
 where a.account_number = h.account_number
   and a.provider_party_id = '6f0b0c24-0000-4000-8000-000000000024'
   and a.product_display_name is null;

-- ---------------------------------------------------------------------------
-- 2. The promotion learns to name an account, once
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
  v_sum         numeric;
  v_w           numeric[];
  v_strange     text;
  v_first       boolean;
  v_label       text;
  v_was         text;
  v_known       text[] := array[
    'SharesAustralian', 'SharesInternational',
    'FixedInterestAustralian', 'FixedInterestInternational',
    'PropertyListedAustralian', 'PropertyListedInternational', 'PropertyDirect',
    'CashAustralian', 'CashInternational', 'Other'];
  v_classes     text[] := array[
    'australian_shares', 'international_shares',
    'australian_fixed_interest', 'international_fixed_interest',
    'listed_property', 'direct_property', 'cash', 'other'];
  i             int;
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
          insert into public.financial_account_valuations
            (account_id, value, as_at, source, source_system)
          values (v_account.id, round(r.portfolio_value, 2), r.as_at_date, 'integration', 'hub24')
          on conflict (account_id, as_at) do update
            set value = excluded.value,
                source = excluded.source,
                source_system = excluded.source_system;
          v_outcome := 'matched';
        end if;

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
    -- Has any feed ever reported a product for this account? Only while the
    -- answer is no may the label be seeded, and the column is sticky below, so
    -- the answer turns to yes exactly once and stays there.
    select (a.product_display_name is null), a.label into v_first, v_was
      from public.financial_accounts a where a.id = r.account_id;

    -- "Orlando Alvarado — HUB24 Investment". Either half may be missing, and
    -- with both missing there is nothing worth calling the account, so the
    -- label is left as it is.
    v_label := nullif(btrim(concat_ws(' — ',
                 nullif(btrim(coalesce(r.account_name, '')), ''),
                 nullif(btrim('HUB24 ' || coalesce(r.product_offering_type, '')), 'HUB24'))), '');

    update public.financial_accounts
       set available_cash         = case when r.available_to_trade is null then null
                                         else round(r.available_to_trade, 2) end,
           snapshot_as_at         = r.as_at_date,
           snapshot_source_system = 'hub24',
           -- Sticky: a run that reports no product leaves the last one standing,
           -- which is what keeps the seeding condition above a one-way door.
           product_display_name   = coalesce(r.product_offering_display_name, product_display_name),
           label                  = case when v_first and v_label is not null
                                         then v_label else label end
     where id = r.account_id;

    -- The old label is kept in the note, so a name the feed replaced can always
    -- be read back and restored.
    if v_first and v_label is not null then
      update ingest.hub24_accounts
         set promotion_note = concat_ws(' ', promotion_note,
               'label_seeded:was=' || coalesce(v_was, ''))
       where id = r.id;
      v_labelled := v_labelled + 1;
    end if;

    select string_agg(k, ',' order by k) into v_strange
      from jsonb_object_keys(coalesce(r.asset_allocations_raw, '{}'::jsonb)) k
     where k <> all(v_known);
    if v_strange is not null then
      update ingest.hub24_accounts
         set promotion_note = concat_ws(' ', promotion_note, 'allocation_unmapped:' || v_strange)
       where id = r.id;
      v_alloc_unmapped := v_alloc_unmapped + 1;
    end if;

    v_w := array[
      r.alloc_shares_australian,
      r.alloc_shares_international,
      r.alloc_fixed_interest_australian,
      r.alloc_fixed_interest_international,
      coalesce(r.alloc_property_listed_australian, 0) + coalesce(r.alloc_property_listed_international, 0),
      r.alloc_property_direct,
      coalesce(r.alloc_cash_australian, 0) + coalesce(r.alloc_cash_international, 0),
      r.alloc_other];

    if r.alloc_shares_australian is null and r.alloc_shares_international is null
       and r.alloc_fixed_interest_australian is null and r.alloc_fixed_interest_international is null
       and r.alloc_property_listed_australian is null and r.alloc_property_listed_international is null
       and r.alloc_property_direct is null and r.alloc_cash_australian is null
       and r.alloc_cash_international is null and r.alloc_other is null then
      continue;
    end if;

    select sum(coalesce(w, 0)) into v_sum from unnest(v_w) w;
    if exists (select 1 from unnest(v_w) w where w < -1 or w > 1) or abs(v_sum - 1) > 0.01 then
      update ingest.hub24_accounts
         set promotion_note = concat_ws(' ', promotion_note,
               'allocation_skipped:sum=' || round(v_sum, 4)::text)
       where id = r.id;
      continue;
    end if;

    delete from public.financial_account_allocations where account_id = r.account_id;
    for i in 1..8 loop
      if coalesce(v_w[i], 0) <> 0 then
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
    'allocations_refreshed', v_alloc_refreshed,
    'allocations_with_unmapped_class', v_alloc_unmapped,
    'labels_seeded', v_labelled);
end $fn$;

revoke all on function ingest.promote_hub24(uuid) from public, anon, authenticated;
