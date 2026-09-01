-- 1) Replace group status values: prospect | onboarding | active | inactive
create type public.client_group_status as enum ('prospect', 'onboarding', 'active', 'inactive');

drop view public.group_summary;
drop view public.households;
drop view public.business_entities;

alter table public.client_groups
  alter column status drop default,
  alter column status type public.client_group_status
    using (case status::text when 'former' then 'inactive' else status::text end)::public.client_group_status,
  alter column status set default 'prospect';

drop type public.group_status;

create view public.households
with (security_invoker = true) as
select * from public.client_groups where group_type = 'household';
comment on view public.households is 'client_groups of type household.';

create view public.business_entities
with (security_invoker = true) as
select * from public.client_groups where group_type = 'business_entity';
comment on view public.business_entities is 'client_groups of type business_entity.';

create view public.group_summary
with (security_invoker = true) as
select
  g.id as group_id,
  g.group_type,
  g.name,
  g.status,
  pc.display_name as primary_contact,
  count(m.id) filter (where m.end_date is null) as member_count,
  string_agg(
    p.display_name || ' (' || m.member_role || ')', ', '
    order by m.member_role, p.display_name
  ) filter (where m.end_date is null) as members
from public.client_groups g
left join public.client_group_members m on m.group_id = g.id
left join public.parties p on p.id = m.party_id
left join public.parties pc on pc.id = g.primary_contact_party_id
group by g.id, g.group_type, g.name, g.status, pc.display_name;
comment on view public.group_summary is 'One row per client group with member names and roles rolled up.';

-- 2) R11: when the last open membership of a group ends, the group becomes inactive
create or replace function public.deactivate_empty_group()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_group_id uuid;
begin
  v_group_id := coalesce(new.group_id, old.group_id);
  if not exists (
    select 1 from public.client_group_members m
    where m.group_id = v_group_id and m.end_date is null
  ) then
    update public.client_groups
      set status = 'inactive'
      where id = v_group_id and status <> 'inactive';
  end if;
  return coalesce(new, old);
end;
$$;
revoke all on function public.deactivate_empty_group() from public, anon, authenticated;

create trigger trg_group_members_deactivate_empty
  after update of end_date or delete on public.client_group_members
  for each row execute function public.deactivate_empty_group();
