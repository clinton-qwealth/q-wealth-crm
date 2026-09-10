-- An account summary reads its own valuations (10 Sep 2026)
--
-- Found on a branch while proving the group views that follow this migration,
-- and older than them: financial_accounts_summary, asked for FOUR accounts,
-- read every valuation in the database -- twice.
--
-- The summary joined financial_account_latest_valuation, a view that picks each
-- account's newest row with DISTINCT ON ... ORDER BY, and through it
-- financial_account_value_trend. A DISTINCT ON is a wall the planner will not
-- push a filter through: it cannot know that "the newest row per account,
-- restricted to account X" equals "the newest row for account X" without
-- reasoning it does not do, so it materialises the newest row for EVERY account
-- and only then joins. With 3,000 accounts and 30,000 valuations, seeded on the
-- branch to find exactly this, a four-account query took 2.1 seconds: two
-- sequential scans of the valuations table, a 20,000-row sort each, and the
-- row-level policy function called 60,000 times. Production has a few hundred
-- valuations today, which is why the page has not felt it; it would have felt
-- it the first time valuations were imported in bulk, and by then it would
-- have been the whole group page.
--
-- THE FIX IS SHAPE, NOT INDEXES. The index the lookup needs --
-- financial_account_valuations_account_idx on (account_id, as_at desc) --
-- already exists; the query just never reached it. Both lookups are now
-- LATERAL subqueries correlated on the account, which the planner evaluates
-- once per account row using that index: "this account's newest valuation",
-- then "this account's valuations in the thirty days before it". Work is
-- proportional to the accounts asked for. Measured on the same branch and the
-- same four accounts after this change: 2,080ms and 339,443 buffers became
-- 9.5ms and 988, every scan an index scan.
--
-- SAME COLUMNS, SAME VALUES. Column names, order and types are unchanged so
-- `create or replace` is permitted and nothing reading the view -- the group
-- page, the group views -- sees a difference. Diffed on the branch against a
-- snapshot of the old output over 3,003 accounts: identical, including the
-- accounts with no valuation at all, whose baseline_points stays NULL rather
-- than becoming 0 (the CASE below is there for those rows -- the old trend
-- view simply had no row for such an account, so its columns were NULL).
--
-- The two views this used to lean on, financial_account_latest_valuation and
-- financial_account_value_trend, are left in place: nothing in the application
-- reads them, but they are granted and documented, and removing them is a
-- separate decision. They keep their DISTINCT ON and are still the wrong thing
-- to join from a filtered query; the comment on each now says so.

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
  case
    when b.baseline_value is null then null
    else lv.value - b.baseline_value
  end as change_amount,
  case
    when b.baseline_value is null or b.baseline_value = 0 then null
    else round((lv.value - b.baseline_value) / b.baseline_value * 100, 2)
  end as change_pct,
  b.baseline_value,
  -- NULL, not 0, for an account that has never been valued: there is no
  -- latest point for a trend to be measured against. 0 keeps its meaning of
  -- "valued once, nothing in the thirty days before".
  case when lv.as_at is null then null else b.baseline_points end as baseline_points
from public.financial_accounts a
left join public.parties prov on prov.id = a.provider_party_id
-- This account's newest valuation: one index probe, newest first, limit 1.
left join lateral (
  select v.value, v.as_at
  from public.financial_account_valuations v
  where v.account_id = a.id
  order by v.as_at desc, v.created_at desc
  limit 1
) lv on true
-- The thirty days before that point, for the same account. Correlated on lv,
-- so it is skipped when there is no latest point.
left join lateral (
  select round(avg(v.value), 2) as baseline_value,
         count(*)               as baseline_points
  from public.financial_account_valuations v
  where v.account_id = a.id
    and v.as_at >= lv.as_at - 30   -- date minus integer days
    and v.as_at <  lv.as_at        -- excludes the latest point itself
) b on true;

comment on view public.financial_accounts_summary is
  'One row per account with provider, owners and the latest valuation against its thirty-day baseline. Valuations are looked up per account (LATERAL), never through the DISTINCT ON views -- see the 10 Sep 2026 migration for why.';

comment on view public.financial_account_latest_valuation is
  'Newest valuation per account via DISTINCT ON. Correct, but a filter on account_id is NOT pushed through it: joining this from a filtered query computes every account first. financial_accounts_summary stopped using it on 10 Sep 2026 for that reason; look up one account''s newest valuation with a correlated LIMIT 1 instead.';

comment on view public.financial_account_value_trend is
  'Latest account value against the average of the preceding 30 days, built on financial_account_latest_valuation and so with the same caveat: not for filtered joins. financial_accounts_summary computes the same figures inline since 10 Sep 2026. baseline_points is how many valuations the average is built from; 0 means no trend can be stated.';

-- `create or replace view` keeps existing grants, so this changes nothing --
-- restated so the intent is in the file: signed-in staff read, nobody else.
revoke all on public.financial_accounts_summary from anon, public;
revoke all on public.financial_accounts_summary from authenticated;
grant select on public.financial_accounts_summary to authenticated;
