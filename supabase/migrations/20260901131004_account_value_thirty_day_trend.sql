-- Direction of travel for an account's value (1 Sep 2026)
--
-- The baseline is the AVERAGE of the valuations dated in the 30 days before the
-- latest one, and the latest figure is compared against it. Valuations are
-- expected daily, and a single day's movement is noise — averaging the trailing
-- month means the arrow reports where the account is running, not what happened
-- overnight.
--
-- The latest valuation is excluded from its own baseline. Including it would make
-- the comparison partly self-referential, and with a short history it would drag
-- the baseline toward the very figure being tested, damping a real move.
--
-- No valuations in the window means no baseline, which means NO arrow rather than
-- a flat one: with one observation there is no direction to report, and drawing
-- an arrow would assert more than the data supports.

create or replace view public.financial_account_value_trend
with (security_invoker = true) as
select
  lv.account_id,
  lv.value  as latest_value,
  lv.as_at  as valued_on,
  b.baseline_value,
  b.baseline_points,
  case
    when b.baseline_value is null then null
    else lv.value - b.baseline_value
  end as change_amount,
  case
    when b.baseline_value is null or b.baseline_value = 0 then null
    else round((lv.value - b.baseline_value) / b.baseline_value * 100, 2)
  end as change_pct
from public.financial_account_latest_valuation lv
left join lateral (
  select round(avg(v.value), 2) as baseline_value,
         count(*)               as baseline_points
  from public.financial_account_valuations v
  where v.account_id = lv.account_id
    and v.as_at >= lv.as_at - 30   -- date minus integer days
    and v.as_at <  lv.as_at        -- excludes the latest point itself
) b on true;

comment on view public.financial_account_value_trend is
  'Latest account value against the average of the preceding 30 days. baseline_points is how many valuations that average is built from — 0 means no trend can be stated.';

revoke all on public.financial_account_value_trend from anon;
grant select on public.financial_account_value_trend to authenticated;

-- Append the trend columns to the summary the web app reads. CREATE OR REPLACE
-- VIEW permits new columns only at the end, so latest_value and valued_on keep
-- their existing positions and nothing already reading this view breaks.
create or replace view public.financial_accounts_summary
with (security_invoker = true) as
select
  a.id as account_id,
  a.account_type,
  a.label,
  a.account_number,
  a.status,
  a.opened_on,
  a.closed_on,
  prov.display_name as provider,
  (select string_agg(p.display_name, ', ' order by p.display_name)
     from public.financial_account_owners o
     join public.parties p on p.id = o.party_id
    where o.account_id = a.id) as owners,
  (select count(*)
     from public.financial_account_owners o
    where o.account_id = a.id) as owner_count,
  lv.value as latest_value,
  lv.as_at as valued_on,
  t.change_amount,
  t.change_pct,
  t.baseline_value,
  t.baseline_points
from public.financial_accounts a
left join public.parties prov on prov.id = a.provider_party_id
left join public.financial_account_latest_valuation lv on lv.account_id = a.id
left join public.financial_account_value_trend t on t.account_id = a.id;
