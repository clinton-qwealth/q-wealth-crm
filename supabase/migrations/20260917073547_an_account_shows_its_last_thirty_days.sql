-- An account shows its last thirty days (17 Sep 2026)
--
-- The account drawer becomes three tabs — Overview, Activity, Details — and the
-- Overview opens with a bar per day of the account's recent value. The series
-- exists: `financial_account_valuations` has held one row per account per day
-- since 1 September, and the HUB24 and Netwealth feeds now write into it daily.
-- Nothing has ever drawn it.
--
-- IT ARRIVES AS A COLUMN, NOT AS A FETCH, and that is the same decision the
-- allocation got on 16 September for the same reason. The group page is held to
-- TWO round trips by `groups-page-round-trips.test.tsx`, which asserts the depth
-- exactly rather than as a ceiling. A separate read of the valuations keyed by
-- the account ids would be a third wave; a fetch when the drawer opens would
-- hide the same round trip behind a click and look perfectly correct on screen.
-- So the series is appended to the views the page already reads, and the test
-- is the thing that holds the design to it.
--
-- THE WINDOW IS ANCHORED TO THE ACCOUNT'S OWN LATEST VALUATION, not to today.
-- That is not a convenience: it is the rule the thirty-day trend beside it
-- already uses, and the wealth summary above it, and a chart on a different
-- window from the arrow it sits under would invite exactly the comparison that
-- is wrong. An account last valued in August shows August, and the drawer says
-- the as-at date beside the figure.
--
-- The series carries the DATE AND THE VALUE and nothing else. Source and
-- source_system were considered and left out: the drawer already names what
-- recorded the latest figure, a bar cannot carry a provenance mark that is
-- legible at this size, and a column nothing draws is a column that goes stale.
--
-- APPEND ONLY, as before. `create or replace view` permits nothing else, and
-- dropping a view drops its grants — so every existing column keeps its name,
-- type and position and `value_series` goes last on both views.
--
-- NO MCP RIPPLE THIS TIME, and that is the payoff of 16 September. The MCP's
-- `get_client_accounts` lists its columns explicitly rather than selecting the
-- star, so a column added here cannot reach a language model unexplained. That
-- change was made because `product_display_name` would have; this migration is
-- the first to benefit from it.

-- ---------------------------------------------------------------------------
-- 1. financial_accounts_summary — the same twenty-five, then one more
-- ---------------------------------------------------------------------------

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
  (select count(*) from public.financial_account_owners o
    where o.account_id = a.id) as owner_count,
  lv.value as latest_value,
  lv.as_at as valued_on,
  case when b.baseline_value is null then null::numeric
       else lv.value - b.baseline_value end as change_amount,
  case when b.baseline_value is null or b.baseline_value = 0 then null::numeric
       else round(((lv.value - b.baseline_value) / b.baseline_value) * 100, 2) end as change_pct,
  b.baseline_value,
  case when lv.as_at is null then null::bigint
       else b.baseline_points end as baseline_points,
  a.available_cash,
  a.snapshot_as_at,
  a.snapshot_source_system,
  a.product_display_name,
  lv.source        as valuation_source,
  lv.source_system as valuation_source_system,
  (select jsonb_agg(jsonb_build_object('party_id', o.party_id, 'name', p.display_name)
                    order by p.display_name)
     from public.financial_account_owners o
     join public.parties p on p.id = o.party_id
    where o.account_id = a.id) as owner_parties,
  alloc.allocation,
  alloc.allocation_as_at,

  -- ── appended 17 September 2026 ──────────────────────────────────────────
  series.value_series

from public.financial_accounts a
left join public.parties prov on prov.id = a.provider_party_id
left join lateral (
  select v.value, v.as_at, v.source, v.source_system
    from public.financial_account_valuations v
   where v.account_id = a.id
   order by v.as_at desc, v.created_at desc
   limit 1
) lv on true
left join lateral (
  select round(avg(v.value), 2) as baseline_value,
         count(*)               as baseline_points
    from public.financial_account_valuations v
   where v.account_id = a.id
     and v.as_at >= lv.as_at - 30
     and v.as_at <  lv.as_at
) b on true
left join lateral (
  select jsonb_agg(jsonb_build_object('asset_class', c.asset_class, 'weight', c.weight)
                   order by c.asset_class) as allocation,
         max(c.updated_at)                 as allocation_as_at
    from public.financial_account_allocations c
   where c.account_id = a.id
) alloc on true
left join lateral (
  -- The SAME window as the baseline lateral above, plus the latest day itself:
  -- `>= lv.as_at - 30` where the baseline is `>= lv.as_at - 30 and < lv.as_at`.
  -- So the chart draws what the arrow compares, with the figure the arrow is
  -- about as its last bar.
  --
  -- Correlated over `(account_id, as_at)`, the table's own unique key, and
  -- bounded by it: at most 31 rows per account, one per day. Ascending, because
  -- a chart reads left to right and sorting in the browser is a step that can
  -- be forgotten.
  select jsonb_agg(jsonb_build_object('as_at', v.as_at, 'value', v.value)
                   order by v.as_at) as value_series
    from public.financial_account_valuations v
   where v.account_id = a.id
     and lv.as_at is not null
     and v.as_at >= lv.as_at - 30
) series on true;

comment on view public.financial_accounts_summary is
  'One row per account: owners rolled up, the latest valuation and its thirty-day baseline, and since 16 Sep 2026 the current state a provider feed maintains — cash, product, allocation — plus the provenance of the figure and the owners as id/name pairs. Since 17 Sep 2026 it also carries value_series, the valuations of the thirty days up to and including the latest one, for the drawer''s chart. The valuation columns are looked up per account with LATERAL, not through financial_account_latest_valuation; see the 10 September migration for why.';

comment on column public.financial_accounts_summary.value_series is
  'The account''s valuations over the thirty days ending at its OWN latest one — not at today — as [{as_at, value}] ascending. The same window the change_amount/change_pct baseline uses, plus the latest day, so a chart of this and the trend beside it describe one thing. NULL where the account has never been valued.';

-- ---------------------------------------------------------------------------
-- 2. group_financial_accounts — the same again, in the same order
-- ---------------------------------------------------------------------------

create or replace view public.group_financial_accounts
with (security_invoker = true) as
select
  g.group_id,
  s.account_id,
  s.account_type,
  s.label,
  s.account_number,
  s.status,
  s.opened_on,
  s.closed_on,
  s.provider,
  s.owners,
  s.owner_count,
  s.latest_value,
  s.valued_on,
  s.change_amount,
  s.change_pct,
  s.baseline_value,
  s.baseline_points,
  s.available_cash,
  s.snapshot_as_at,
  s.snapshot_source_system,
  s.product_display_name,
  s.valuation_source,
  s.valuation_source_system,
  s.owner_parties,
  s.allocation,
  s.allocation_as_at,
  s.value_series
from (
  select distinct m.group_id, o.account_id
    from public.client_group_members m
    join public.financial_account_owners o on o.party_id = m.party_id
   where m.end_date is null
) g
join public.financial_accounts_summary s on s.account_id = g.account_id;

comment on view public.group_financial_accounts is
  'financial_accounts_summary keyed by group: every account owned by a CURRENT member, once however many members own it. The group page reads this in its first wave and the account drawer renders out of the result, so opening a panel costs no round trip — see groups-page-round-trips.test.tsx, which is the proof and must not be edited to accommodate a later fetch.';

-- ---------------------------------------------------------------------------
-- 3. Grants, restated
-- ---------------------------------------------------------------------------

revoke all on public.financial_accounts_summary from anon, public, authenticated;
revoke all on public.group_financial_accounts   from anon, public, authenticated;
grant select on public.financial_accounts_summary to authenticated;
grant select on public.group_financial_accounts   to authenticated;
