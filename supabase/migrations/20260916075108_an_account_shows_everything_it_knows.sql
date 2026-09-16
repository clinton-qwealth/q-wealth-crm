-- An account shows everything it knows (16 Sep 2026)
--
-- The HUB24 feed went live yesterday and everything it produces is invisible.
-- `available_cash`, `snapshot_as_at`, `snapshot_source_system`,
-- `product_display_name` and the whole of `financial_account_allocations`
-- appear in the migrations that created them and NOWHERE ELSE in the
-- repository — no view the app reads, no component, no query. A grep over
-- every .ts and .tsx file returns nothing.
--
-- Worse, data the page already pays for is thrown away: `group_financial_accounts`
-- has returned `account_number`, `provider`, `opened_on`, `closed_on` and
-- `owner_count` on every group-page load since 10 September and the loader
-- discards all five. `valued_on` is fetched, typed, and never rendered — so the
-- as-at date of a figure an adviser quotes in advice is not on screen at all.
--
-- THE DRAWER FETCHES NOTHING. Everything it shows is appended here, so the
-- page's existing wave-0 read carries it and opening a panel renders data that
-- is already in the React tree.
--
-- That is not a convenience, it is the only shape that leaves
-- groups-page-round-trips.test.tsx passing untouched. That test asserts depth 2
-- and that six named views are each issued in the FIRST wave. A separate
-- allocations view would cost a seventh request and a third copy of the
-- group-membership predicate; a read keyed by the account ids is wave 1 and
-- makes the depth 3; fetching when the drawer opens hides the same round trip
-- behind a click, ~170ms every time, and looks perfectly correct on screen.
-- The test is the proof this design met its constraint and must not be edited
-- to accommodate a later change of mind.
--
-- The precedent is already here: group_assets_liabilities.owner_shares is a
-- jsonb array of {party_id, name, share_percent}, for exactly this reason.
--
-- APPEND ONLY. `create or replace view` permits nothing else, and dropping a
-- view drops its grants. Every existing column below keeps its name, its type
-- and its position; the new ones land after them.

-- ---------------------------------------------------------------------------
-- 1. financial_accounts_summary — nine appended columns
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

  -- ── appended 16 September 2026 ──────────────────────────────────────────
  a.available_cash,
  a.snapshot_as_at,
  a.snapshot_source_system,
  -- A FEE-SCHEDULE IDENTIFIER, NOT A NAME. Eleven of the first twenty HUB24
  -- accounts share one string, and every CLOSED account's contains the word
  -- ACTIVE. It is here so a drawer can print it against a "Product" label; it
  -- must never be a heading, and the MCP's own select list omits it for exactly
  -- that reason — see crm-mcp/index.ts.
  a.product_display_name,
  -- Provenance of the figure two lines above it. Named `valuation_source`
  -- rather than `source`: this view already has `provider`, and a bare `source`
  -- would read as the account's rather than the valuation's.
  lv.source        as valuation_source,
  lv.source_system as valuation_source_system,
  -- The owners as PAIRS, not the comma-joined string above. That string cannot
  -- be turned back into ids — two people share a name, and a joint account may
  -- carry an owner who is not a member of the group the drawer was opened from
  -- — so an owner editor needs this. Same argument, same shape, as
  -- assets_liabilities_summary.owner_shares.
  (select jsonb_agg(jsonb_build_object('party_id', o.party_id, 'name', p.display_name)
                    order by p.display_name)
     from public.financial_account_owners o
     join public.parties p on p.id = o.party_id
    where o.account_id = a.id) as owner_parties,
  alloc.allocation,
  alloc.allocation_as_at

from public.financial_accounts a
left join public.parties prov on prov.id = a.provider_party_id
left join lateral (
  -- Two columns added to the existing lateral, so provenance costs no second
  -- probe of the valuations table.
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
  -- A CORRELATED lateral over the primary key (account_id, asset_class), at
  -- most eight rows per account. The 10 September lesson — never join a
  -- DISTINCT ON from a filtered query — does not apply here and must not be
  -- re-created: there is no DISTINCT ON, and the filter reaches the index.
  select jsonb_agg(jsonb_build_object('asset_class', c.asset_class, 'weight', c.weight)
                   order by c.asset_class) as allocation,
         max(c.updated_at)                 as allocation_as_at
    from public.financial_account_allocations c
   where c.account_id = a.id
) alloc on true;

comment on view public.financial_accounts_summary is
  'One row per account: owners rolled up, the latest valuation and its thirty-day baseline, and since 16 Sep 2026 the current state a provider feed maintains — cash, product, allocation — plus the provenance of the figure and the owners as id/name pairs. The valuation columns are looked up per account with LATERAL, not through financial_account_latest_valuation; see the 10 September migration for why.';

-- ---------------------------------------------------------------------------
-- 2. group_financial_accounts — the same nine, in the same order
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
  s.allocation_as_at
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
-- 3. The policy views
-- ---------------------------------------------------------------------------

-- `parties` and `covers` go on the GROUP view only, deliberately, and not on
-- insurance_policies_summary. The MCP's get_client_insurance reads the summary,
-- fetches covers separately and WORDS them — "$6,500 per month" — because a
-- benefit amount without its basis is understated twelvefold when read as a
-- lump sum. A second, unworded copy of the same amounts in the same response is
-- how a model reads the wrong one.
create or replace view public.group_insurance_policies
with (security_invoker = true) as
select
  g.group_id,
  s.policy_id,
  s.policy_number,
  s.label,
  s.status,
  s.commenced_on,
  s.cancelled_on,
  s.insurer,
  s.premium,
  s.premium_frequency,
  s.premium_structure,
  s.held_in_account_id,
  s.held_in_account,
  s.owners,
  s.lives_insured,
  s.cover_count,
  s.total_lump_sum_cover,
  s.cover_types,
  s.total_monthly_benefit,

  -- ── appended 16 September 2026 ──────────────────────────────────────────
  -- ONE column carrying the role, not two columns split by it. A person is
  -- routinely both the owner and the life insured, which is two rows in
  -- insurance_policy_parties for one party — the table's own comment calls that
  -- the common case rather than a special one — and two id arrays would lose
  -- which of them a given name came from.
  (select jsonb_agg(jsonb_build_object('party_id', pp.party_id,
                                       'name', pt.display_name,
                                       'role', pp.role)
                    order by pp.role, pt.display_name)
     from public.insurance_policy_parties pp
     join public.parties pt on pt.id = pp.party_id
    where pp.policy_id = s.policy_id) as parties,
  -- Each cover WITH ITS BASIS. The two are never separated: the basis is what
  -- says whether 6500 is a lump sum or a monthly benefit, and the summary's two
  -- totals above are deliberately separate figures that must never be added.
  (select jsonb_agg(jsonb_build_object('cover_type', c.cover_type,
                                       'benefit_amount', c.benefit_amount,
                                       'benefit_basis', c.benefit_basis,
                                       'benefit_period', c.benefit_period,
                                       'waiting_period', c.waiting_period,
                                       'indexed', c.indexed)
                    order by c.cover_type)
     from public.insurance_policy_covers c
    where c.policy_id = s.policy_id) as covers
from (
  select distinct m.group_id, pp.policy_id
    from public.client_group_members m
    join public.insurance_policy_parties pp on pp.party_id = m.party_id
   where m.end_date is null
) g
join public.insurance_policies_summary s on s.policy_id = g.policy_id;

comment on view public.group_insurance_policies is
  'insurance_policies_summary keyed by group: every policy on which a current member holds any role, once. Since 16 Sep 2026 it also carries the parties with their roles and the covers with their bases, so the policy drawer renders without a round trip. Both are on this view and NOT on the summary, because the MCP reads the summary and words its own copy of the covers.';

-- ---------------------------------------------------------------------------
-- 4. Grants, restated
-- ---------------------------------------------------------------------------

-- `create or replace view` preserves them; they are written out anyway, because
-- the standing rule is that a migration touching an object states what may be
-- done to it rather than leaving a reader to check.
revoke all on public.financial_accounts_summary from anon, public, authenticated;
revoke all on public.group_financial_accounts   from anon, public, authenticated;
revoke all on public.group_insurance_policies   from anon, public, authenticated;
grant select on public.financial_accounts_summary to authenticated;
grant select on public.group_financial_accounts   to authenticated;
grant select on public.group_insurance_policies   to authenticated;
