-- Expose the income-stream total alongside the lump-sum total (2 Sep 2026)
--
-- A policy can hold both: $750k of life cover and $6,500 a month of income
-- protection. Two separate totals rather than one combined figure, because the
-- combination has no meaning. Any consumer that wants to show both can; none can
-- accidentally add them.
--
-- CREATE OR REPLACE VIEW only permits new columns at the end, so every existing
-- column keeps its position and nothing reading this view breaks.
create or replace view public.insurance_policies_summary
with (security_invoker = true) as
select
  p.id as policy_id,
  p.policy_number,
  p.label,
  p.status,
  p.commenced_on,
  p.cancelled_on,
  prov.display_name as insurer,
  p.premium,
  p.premium_frequency,
  p.premium_structure,
  p.held_in_account_id,
  acc.label as held_in_account,
  (select string_agg(pt.display_name, ', ' order by pt.display_name)
     from public.insurance_policy_parties pp
     join public.parties pt on pt.id = pp.party_id
    where pp.policy_id = p.id and pp.role = 'owner') as owners,
  (select string_agg(pt.display_name, ', ' order by pt.display_name)
     from public.insurance_policy_parties pp
     join public.parties pt on pt.id = pp.party_id
    where pp.policy_id = p.id and pp.role = 'life_insured') as lives_insured,
  (select count(*) from public.insurance_policy_covers c where c.policy_id = p.id)
    as cover_count,
  (select sum(c.benefit_amount) from public.insurance_policy_covers c
    where c.policy_id = p.id and c.benefit_basis = 'lump_sum')
    as total_lump_sum_cover,
  (select string_agg(c.cover_type::text, ', ' order by c.cover_type)
     from public.insurance_policy_covers c where c.policy_id = p.id) as cover_types,
  -- Monthly-basis benefits, normalised: an annually-quoted income benefit is
  -- divided by twelve so the two are addable to each other, but never to the
  -- lump-sum column above.
  (select sum(case c.benefit_basis
                when 'annual' then c.benefit_amount / 12
                else c.benefit_amount end)
     from public.insurance_policy_covers c
    where c.policy_id = p.id and c.benefit_basis in ('monthly', 'annual'))
    as total_monthly_benefit
from public.insurance_policies p
left join public.parties prov on prov.id = p.provider_party_id
left join public.financial_accounts acc on acc.id = p.held_in_account_id;

comment on view public.insurance_policies_summary is
  'One row per policy with owners, lives insured and covers rolled up. total_lump_sum_cover and total_monthly_benefit are deliberately separate: a lump sum and an income stream are different quantities and must never be added together.';
