-- Read surface and the single transactional write path (2 Sep 2026)

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
  -- Only lump sums are summable. Adding a monthly income-protection benefit to a
  -- life sum insured would produce a number that means nothing, so it is excluded
  -- rather than silently mixed in.
  (select sum(c.benefit_amount) from public.insurance_policy_covers c
    where c.policy_id = p.id and c.benefit_basis = 'lump_sum')
    as total_lump_sum_cover,
  (select string_agg(c.cover_type::text, ', ' order by c.cover_type)
     from public.insurance_policy_covers c where c.policy_id = p.id) as cover_types
from public.insurance_policies p
left join public.parties prov on prov.id = p.provider_party_id
left join public.financial_accounts acc on acc.id = p.held_in_account_id;

comment on view public.insurance_policies_summary is
  'One row per policy with owners, lives insured and covers rolled up. total_lump_sum_cover excludes income-protection benefits, which are a monthly stream and not addable to a lump sum.';

revoke all on public.insurance_policies_summary from anon;
grant select on public.insurance_policies_summary to authenticated;

-- Policy, its parties and its covers are written together or not at all.
create or replace function public.create_insurance_policy(
  p_label             text,
  p_policy_number     text,
  p_owner_party_ids   uuid[],
  p_life_insured_ids  uuid[],
  p_covers            jsonb,          -- [{cover_type, benefit_amount, benefit_basis?, benefit_period?, waiting_period?, indexed?}]
  p_provider_party_id uuid default null,
  p_status            public.insurance_policy_status default 'in_force',
  p_commenced_on      date default null,
  p_premium           numeric default null,
  p_premium_frequency public.premium_frequency default null,
  p_premium_structure public.premium_structure default null,
  p_held_in_account_id uuid default null
) returns uuid
language plpgsql
security invoker
set search_path to ''
as $fn$
declare
  v_policy uuid;
  v_staff  uuid := public.current_staff_id();
  v_party  uuid;
  v_cover  jsonb;
  v_type   public.insurance_cover_type;
  v_basis  public.benefit_basis;
begin
  if v_staff is null then
    raise exception 'Not an active staff member';
  end if;
  if p_label is null or length(trim(p_label)) = 0 then
    raise exception 'A policy needs a label';
  end if;
  if p_policy_number is null or length(trim(p_policy_number)) = 0 then
    raise exception 'A policy needs a policy number';
  end if;
  if p_owner_party_ids is null or cardinality(p_owner_party_ids) = 0 then
    raise exception 'A policy must have at least one owner';
  end if;
  if p_life_insured_ids is null or cardinality(p_life_insured_ids) = 0 then
    raise exception 'A policy must name at least one life insured';
  end if;
  if p_covers is null or jsonb_array_length(p_covers) = 0 then
    raise exception 'A policy needs at least one cover';
  end if;

  insert into public.insurance_policies
    (label, policy_number, provider_party_id, status, commenced_on,
     premium, premium_frequency, premium_structure, held_in_account_id,
     created_by_staff_id)
  values
    (trim(p_label), trim(p_policy_number), p_provider_party_id,
     coalesce(p_status, 'in_force'), p_commenced_on,
     p_premium, p_premium_frequency, p_premium_structure, p_held_in_account_id,
     v_staff)
  returning id into v_policy;

  foreach v_party in array p_owner_party_ids loop
    insert into public.insurance_policy_parties (policy_id, party_id, role)
    values (v_policy, v_party, 'owner')
    on conflict do nothing;
  end loop;

  foreach v_party in array p_life_insured_ids loop
    insert into public.insurance_policy_parties (policy_id, party_id, role)
    values (v_policy, v_party, 'life_insured')
    on conflict do nothing;
  end loop;

  for v_cover in select * from jsonb_array_elements(p_covers) loop
    v_type := (v_cover ->> 'cover_type')::public.insurance_cover_type;

    -- Basis defaults from the cover type so the common case needs no thought,
    -- but stays overridable: an income protection benefit is occasionally
    -- quoted annually rather than monthly.
    v_basis := coalesce(
      nullif(v_cover ->> 'benefit_basis', '')::public.benefit_basis,
      case when v_type = 'income_protection' then 'monthly'::public.benefit_basis
           else 'lump_sum'::public.benefit_basis end
    );

    insert into public.insurance_policy_covers
      (policy_id, cover_type, benefit_amount, benefit_basis,
       benefit_period, waiting_period, indexed)
    values (
      v_policy,
      v_type,
      (v_cover ->> 'benefit_amount')::numeric,
      v_basis,
      nullif(v_cover ->> 'benefit_period', ''),
      nullif(v_cover ->> 'waiting_period', ''),
      coalesce((v_cover ->> 'indexed')::boolean, false)
    );
  end loop;

  return v_policy;
end
$fn$;

revoke all on function public.create_insurance_policy(
  text, text, uuid[], uuid[], jsonb, uuid, public.insurance_policy_status, date,
  numeric, public.premium_frequency, public.premium_structure, uuid) from public, anon;
grant execute on function public.create_insurance_policy(
  text, text, uuid[], uuid[], jsonb, uuid, public.insurance_policy_status, date,
  numeric, public.premium_frequency, public.premium_structure, uuid) to authenticated;
