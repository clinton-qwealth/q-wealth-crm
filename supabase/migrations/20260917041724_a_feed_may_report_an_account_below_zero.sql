-- A feed may report an account below zero (17 Sep 2026)
--
-- The first real Netwealth run landed 176 sandbox accounts and the promotion
-- refused four of them as invalid_value: total values of -1.56, -69.23, -69.12
-- and -67.56. The rule it applied — a negative portfolio value is garbage — was
-- written for HUB24 as a sanity check and inherited by Netwealth through the
-- shared shape. It is the wrong rule for a wrap account, where an overdrawn
-- cash balance is a real, if uncommon, state: refusing it leaves the CRM
-- showing the last positive figure as though nothing had happened, stamps the
-- row so it is never retried, and tells nobody.
--
-- Decided with the reader on 17 September: accept negatives, keep the sanity
-- check. A value below -100,000 is still refused — no wrap account owes that
-- much on its cash account, and a figure like it is a feed fault — and the
-- floor lives in ONE function both feeds call, so they cannot drift.
--
-- What already copes downstream, checked before deciding: financial_account_
-- valuations.value has no non-negative constraint; the wealth summary sums
-- every value, so an overdraft reduces Total investments, which is right; the
-- investment mix ring filters to value > 0, so a negative account leaves the
-- picture — and the app is changed in the same commit to SAY so beneath the
-- ring rather than dropping it silently.
--
-- The four refused rows are reset at the end so the next promotion picks them
-- up; with no Netwealth account linked yet they will land as unmatched, which
-- is where they belong.

create or replace function ingest.value_is_plausible(p_value numeric)
returns boolean
language sql
immutable
set search_path to ''
as $fn$
  select p_value is null or p_value >= -100000;
$fn$;

comment on function ingest.value_is_plausible(numeric) is
  'The one sanity floor every feed applies to a reported account value before it becomes a valuation: NULL passes (the caller reports no_value), anything at or above -100,000 passes, anything below is refused as invalid_value. Negative is allowed since 17 Sep 2026 — an overdrawn wrap account is real; -100,000 on a cash account is not.';

revoke all on function ingest.value_is_plausible(numeric) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Both promotions, unchanged except for the one predicate.
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
    elsif not ingest.value_is_plausible(r.portfolio_value) then
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
    elsif not ingest.value_is_plausible(r.total_value) then
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

revoke all on function ingest.promote_hub24(uuid)     from public, anon, authenticated;
revoke all on function ingest.promote_netwealth(uuid) from public, anon, authenticated;

-- The four rows the old rule refused, back in the queue. Scoped to the new
-- floor so a genuinely implausible value, were there one, would stay refused.
update ingest.netwealth_accounts
   set promoted_at = null, promotion_outcome = null, promotion_note = null
 where promotion_outcome = 'invalid_value'
   and ingest.value_is_plausible(total_value);
