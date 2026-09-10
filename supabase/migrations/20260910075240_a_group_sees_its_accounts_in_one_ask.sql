-- A group sees its accounts in one ask (10 Sep 2026)
--
-- Accounts and policies have no group column, by design: an account belongs to
-- the group(s) its owners belong to, and a policy to the group(s) of anyone
-- with a role on it. The group page has honoured that by asking three times in
-- a row -- who are the members, which accounts and policies are theirs, what do
-- the summaries say -- and each ask is a round trip of about 170ms whatever it
-- carries. With the group row and the file notes already down to one wave, this
-- chain was the deepest thing on the page and set its load time on its own.
--
-- These two views answer all three questions in one, keyed by group_id. They
-- are saved queries, not copies: Postgres inlines them and pushes `group_id = X`
-- to the start of the join, so the work is proportional to the group, not to
-- the tables. Proved on a branch with EXPLAIN before this was applied: for one
-- group among 1,000, with 3,000 accounts and 30,000 valuations seeded, the
-- whole thing is 9.5ms and every scan is an index scan -- once the summary
-- view underneath had been fixed by the migration before this one. The plan
-- and the row counts are recorded on the Data Model page.
--
-- WHAT COUNTS AS THE GROUP'S. Exactly what the page counted before, so nothing
-- appears or disappears from a tab:
--   * a CURRENT member -- end_date is null. Someone who has left the group takes
--     their accounts with them.
--   * an account owned by any current member; a policy on which any current
--     member holds ANY role -- a person whose life is insured on a policy
--     someone else owns still belongs on this group's insurance tab.
--   * once each. Two members owning one account is one row.
-- Diffed on the branch against the page's old three-step logic over every
-- group: 3,002 account pairs and 1,002 policy pairs, identical both ways, no
-- duplicates.
--
-- ACCESS IS UNCHANGED. Both views are security_invoker, so they run as the
-- caller and every row policy on the underlying tables applies exactly as it
-- did to the three separate asks: client_group_members by group access,
-- financial_accounts and insurance_policies by party access through their
-- owner/party rows. A staff member sees, through these views, the same rows
-- they could already see by asking three times -- checked on the branch as two
-- advisers who each own one group: each saw their own group's rows and nobody
-- else's, and anon was refused. The summary views they sit on are themselves
-- security_invoker.

create view public.group_financial_accounts
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
  s.baseline_points
from (
  -- One (group, account) pair however many members own the account. DISTINCT
  -- on the pair rather than on the whole row, so the planner can still push a
  -- group_id filter into this subquery: a filter on a DISTINCT column is one it
  -- may move below the DISTINCT.
  select distinct m.group_id, o.account_id
  from public.client_group_members m
  join public.financial_account_owners o on o.party_id = m.party_id
  where m.end_date is null
) g
join public.financial_accounts_summary s on s.account_id = g.account_id;

comment on view public.group_financial_accounts is
  'financial_accounts_summary with a group_id: every account owned by a CURRENT member of the group, once. Replaces the members -> owners -> summary chain on the group page. security_invoker; see the migration for what counts.';

create view public.group_insurance_policies
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
  s.total_monthly_benefit
from (
  -- Any role, not just owner: see the header.
  select distinct m.group_id, pp.policy_id
  from public.client_group_members m
  join public.insurance_policy_parties pp on pp.party_id = m.party_id
  where m.end_date is null
) g
join public.insurance_policies_summary s on s.policy_id = g.policy_id;

comment on view public.group_insurance_policies is
  'insurance_policies_summary with a group_id: every policy on which a CURRENT member of the group holds any role, once. Replaces the members -> policy parties -> summary chain on the group page. security_invoker; see the migration for what counts.';

-- Read by signed-in staff only, and READ is the whole grant.
--
-- Supabase's default privileges hand every new object in public to anon,
-- authenticated and service_role with ALL privileges -- checked on the branch:
-- as created, these views carried INSERT, UPDATE, DELETE and TRUNCATE for
-- authenticated. The revoke therefore names authenticated as well as anon and
-- public, and the grant that follows is select alone. That matches the two
-- summary views these sit on, whose migrations did the same. Neither view is
-- updatable in practice (the DISTINCT subquery rules it out), but a grant
-- should say what is meant, not lean on what happens not to work.
revoke all on public.group_financial_accounts from anon, public, authenticated;
revoke all on public.group_insurance_policies from anon, public, authenticated;
grant select on public.group_financial_accounts to authenticated;
grant select on public.group_insurance_policies to authenticated;
