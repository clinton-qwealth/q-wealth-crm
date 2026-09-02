-- A policy needs both an owner and a life insured (2 Sep 2026)
--
-- Deferred, so the policy row and its party rows can be written in one
-- transaction. The existence guard is not theoretical: the equivalent trigger on
-- financial_accounts fired for accounts created and rolled back inside the same
-- transaction until it checked the row still existed.
create or replace function public.enforce_policy_has_parties()
returns trigger language plpgsql set search_path to '' as $fn$
begin
  if not exists (select 1 from public.insurance_policies p where p.id = new.id) then
    return null;  -- created and removed in the same transaction: nothing to protect
  end if;
  if not exists (
    select 1 from public.insurance_policy_parties pp
    where pp.policy_id = new.id and pp.role = 'owner'
  ) then
    raise exception 'An insurance policy must have at least one owner (policy %)', new.id;
  end if;
  if not exists (
    select 1 from public.insurance_policy_parties pp
    where pp.policy_id = new.id and pp.role = 'life_insured'
  ) then
    raise exception 'An insurance policy must name at least one life insured (policy %)', new.id;
  end if;
  return null;
end $fn$;

revoke all on function public.enforce_policy_has_parties() from public, anon, authenticated;

create constraint trigger trg_insurance_policies_parties_required
  after insert on public.insurance_policies
  deferrable initially deferred
  for each row execute function public.enforce_policy_has_parties();

-- Visibility: reachable through any related party, or created by you.
create or replace function public.staff_can_access_policy(p_policy_id uuid)
returns boolean
language plpgsql
security definer
stable
set search_path to ''
as $fn$
declare
  v_staff uuid;
begin
  if public.is_elevated_context() then
    return true;
  end if;
  v_staff := public.current_staff_id();
  if v_staff is null then
    return false;
  end if;
  if exists (
    select 1 from public.insurance_policies p
    where p.id = p_policy_id and p.created_by_staff_id = v_staff
  ) then
    return true;
  end if;
  return exists (
    select 1 from public.insurance_policy_parties pp
    where pp.policy_id = p_policy_id
      and public.staff_can_access_party(pp.party_id)
  );
end $fn$;

revoke all on function public.staff_can_access_policy(uuid) from public, anon;
grant execute on function public.staff_can_access_policy(uuid) to authenticated, service_role;

alter table public.insurance_policies enable row level security;
alter table public.insurance_policy_parties enable row level security;
alter table public.insurance_policy_covers enable row level security;

-- The created_by condition is INLINED rather than delegated to the helper above.
-- A SECURITY DEFINER helper that re-reads this table cannot see the row being
-- written by the current statement, which breaks INSERT ... RETURNING. That cost
-- a day on notes before it was understood.
create policy policies_select on public.insurance_policies
  for select to authenticated
  using (
    created_by_staff_id = public.current_staff_id()
    or exists (
      select 1 from public.insurance_policy_parties pp
      where pp.policy_id = id and public.staff_can_access_party(pp.party_id)
    )
  );

create policy policies_insert on public.insurance_policies
  for insert to authenticated
  with check (public.is_active_staff() and created_by_staff_id = public.current_staff_id());

create policy policies_update on public.insurance_policies
  for update to authenticated
  using (public.staff_can_access_policy(id));

create policy policies_delete on public.insurance_policies
  for delete to authenticated
  using (public.staff_can_access_policy(id));

create policy policy_parties_all on public.insurance_policy_parties
  for all to authenticated
  using (public.staff_can_access_policy(policy_id))
  with check (
    public.staff_can_access_policy(policy_id)
    and public.staff_can_access_party(party_id)
  );

create policy policy_covers_all on public.insurance_policy_covers
  for all to authenticated
  using (public.staff_can_access_policy(policy_id))
  with check (public.staff_can_access_policy(policy_id));

grant select, insert, update, delete on public.insurance_policies to authenticated;
grant select, insert, update, delete on public.insurance_policy_parties to authenticated;
grant select, insert, update, delete on public.insurance_policy_covers to authenticated;
