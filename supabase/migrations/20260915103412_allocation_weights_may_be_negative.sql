-- An allocation weight may be negative (15 Sep 2026)
--
-- The first real HUB24 record, read the day migration 95 went live, carried
-- Other = -0.0228 with the seven classes still totalling exactly one. A
-- negative "other" is a fact about a portfolio — pending settlements, a short
-- derivative overlay, an accrual — and HUB24 reports it as one. Migration 95
-- refused any weight below zero, so such an account would have had its
-- valuation and cash land and its allocation skipped with a note, every day.
--
-- The rule becomes: each weight in [-1, 1], the set summing to within one per
-- cent of one, and a class is written when its weight is non-zero rather than
-- positive. Nothing reads the allocation on a screen yet; when something does,
-- a negative slice is its problem to draw honestly, not this table's to hide.

alter table public.financial_account_allocations
  drop constraint financial_account_allocations_weight_range,
  add constraint financial_account_allocations_weight_range check (weight >= -1 and weight <= 1);

comment on column public.financial_account_allocations.weight is
  'A fraction of one, as the provider reports it: 0.2456 is 24.56%. May be negative — HUB24 reports a negative Other for some accounts (a short overlay, pending settlements) with the classes still totalling one. Since 15 Sep 2026; was [0, 1].';

-- Same function as migration 95 with two comparisons changed: the refusal is
-- now `w < -1`, and a class is written when its weight is `<> 0`.
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
      continue;
    end if;

    -- Each weight in [-1, 1] and the set summing to within one per cent of one.
    select sum(coalesce(w, 0)) into v_sum from unnest(v_w) w;
    if exists (select 1 from unnest(v_w) w where w < -1 or w > 1) or abs(v_sum - 1) > 0.01 then
      update ingest.hub24_accounts
         set promotion_note = concat_ws(' ', promotion_note,
               'allocation_skipped:sum=' || round(v_sum, 4)::text)
       where id = r.id;
      continue;
    end if;

    delete from public.financial_account_allocations where account_id = r.account_id;
    for i in 1..7 loop
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
    'allocations_refreshed', v_alloc_refreshed);
end $fn$;

-- A replaced function keeps its grants; re-stated so the file says what holds.
revoke all on function ingest.promote_hub24(uuid) from public, anon, authenticated;
