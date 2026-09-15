-- HUB24 sends ten asset classes, not eight (15 Sep 2026)
--
-- The first real run landed twenty accounts and showed the gap. Migration 95
-- built flat columns for the eight classes the sample record carried;
-- production sends two more:
--
--   PropertyListedInternational   3 accounts, up to $14,840
--   PropertyDirect                1 account,  $228,739
--
-- Nothing was lost — both sat in asset_allocations_raw and payload the whole
-- time, which is what that escape hatch is for — but neither reached a flat
-- column, so the promotion could not see them. The damage would have split two
-- ways, and the second is the one worth preventing: an account short by more
-- than the one per cent tolerance has its allocation SKIPPED, visibly; an
-- account short by less passes the check and is WRITTEN understating property,
-- looking perfectly correct. Three of the four were in the second group.
--
-- THE CANONICAL SET GAINS ONE CLASS, not two:
--
--   PropertyListedInternational  ->  listed_property, folded in beside
--                                    PropertyListedAustralian, exactly as
--                                    CashInternational already folds into cash
--   PropertyDirect               ->  direct_property, ITS OWN CLASS
--
-- Direct property is illiquid, valued by appraisal rather than by market, and
-- behaves nothing like a listed trust. Folding $228,739 of it into `other`
-- would hide a real holding from whoever reads the mix to give advice, which is
-- the same argument that put benefit_basis on insurance covers in July.
--
-- AND A TRIPWIRE, so this class of defect announces itself next time rather
-- than waiting to be noticed: the promotion now compares the keys HUB24 sent
-- against the keys it knows, and records any it does not in the landing row's
-- note as `allocation_unmapped:<keys>`. The existing sum tolerance still
-- decides whether the allocation is written; what changes is that an unmapped
-- class can no longer pass silently at any weight.

-- ---------------------------------------------------------------------------
-- 1. The landing table learns the two columns
-- ---------------------------------------------------------------------------

alter table ingest.hub24_accounts
  add column alloc_property_listed_international numeric,
  add column alloc_property_direct              numeric;

comment on column ingest.hub24_accounts.alloc_property_listed_international is
  'HUB24 PropertyListedInternational. Folded into the canonical listed_property beside its Australian counterpart. Added 15 Sep 2026 from the first real run.';
comment on column ingest.hub24_accounts.alloc_property_direct is
  'HUB24 PropertyDirect. Promoted to its own canonical class, direct_property — unlisted property is illiquid and appraisal-valued, and does not belong with listed trusts or in `other`. Added 15 Sep 2026 from the first real run.';

-- Today's twenty rows already hold both figures in asset_allocations_raw.
-- Backfilling costs nothing and makes the first run correct rather than
-- correctable. None of them has been promoted, so nothing is re-queued.
update ingest.hub24_accounts
   set alloc_property_listed_international = (asset_allocations_raw->>'PropertyListedInternational')::numeric,
       alloc_property_direct               = (asset_allocations_raw->>'PropertyDirect')::numeric
 where asset_allocations_raw ?| array['PropertyListedInternational', 'PropertyDirect'];

-- ---------------------------------------------------------------------------
-- 2. The canonical set gains direct_property
-- ---------------------------------------------------------------------------

alter table public.financial_account_allocations
  drop constraint financial_account_allocations_class_known,
  add constraint financial_account_allocations_class_known check (asset_class in (
    'australian_shares', 'international_shares',
    'australian_fixed_interest', 'international_fixed_interest',
    'listed_property', 'direct_property', 'cash', 'other'));

comment on table public.financial_account_allocations is
  'How an account is currently allocated across the standard asset classes, as its provider last reported — CURRENT STATE, refreshed by each feed run, no history. The landing table under ingest.* is the record of every day. Not audited for the same reason. Eight classes since 15 Sep 2026: direct_property was added when the first real HUB24 run reported unlisted property.';

-- ---------------------------------------------------------------------------
-- 3. The status map, seeded from the first real run rather than guessed
-- ---------------------------------------------------------------------------

-- Twenty accounts, two words: Open on fifteen, Closed on five. This is the
-- whole vocabulary production has shown. A word HUB24 adds later still lands
-- as status_unmapped and still acts on nothing.
insert into ingest.hub24_status_map (hub24_status, crm_status)
values ('Open', 'active'), ('Closed', 'closed')
on conflict (hub24_status) do nothing;

-- ---------------------------------------------------------------------------
-- 4. The promotion: nine columns onto eight classes, and the tripwire
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
  v_touched     uuid[] := '{}';
  v_sum         numeric;
  v_w           numeric[];
  v_strange     text;
  -- Every allocation key HUB24 is known to send. A key outside this list is
  -- reported, never silently dropped.
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
    update public.financial_accounts
       set available_cash         = case when r.available_to_trade is null then null
                                         else round(r.available_to_trade, 2) end,
           snapshot_as_at         = r.as_at_date,
           snapshot_source_system = 'hub24'
     where id = r.account_id;

    -- THE TRIPWIRE. A class HUB24 has started sending that nothing here knows
    -- about is recorded by name, whatever its weight — the defect this
    -- migration exists to fix went unseen precisely because a small unmapped
    -- weight still passed the sum check.
    select string_agg(k, ',' order by k) into v_strange
      from jsonb_object_keys(coalesce(r.asset_allocations_raw, '{}'::jsonb)) k
     where k <> all(v_known);
    if v_strange is not null then
      update ingest.hub24_accounts
         set promotion_note = concat_ws(' ', promotion_note, 'allocation_unmapped:' || v_strange)
       where id = r.id;
      v_alloc_unmapped := v_alloc_unmapped + 1;
    end if;

    -- HUB24's nine reported figures onto the canonical eight. International
    -- listed property folds into listed_property and international cash into
    -- cash, each beside its Australian counterpart; direct property stands on
    -- its own.
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
      continue; -- nothing reported: leave what is there
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
    'allocations_with_unmapped_class', v_alloc_unmapped);
end $fn$;

revoke all on function ingest.promote_hub24(uuid) from public, anon, authenticated;
