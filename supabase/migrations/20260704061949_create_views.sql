-- clients: parties with an active client role, with subtype details
create view public.clients
with (security_invoker = true) as
select
  p.id as party_id,
  p.party_type,
  p.display_name,
  r.start_date as client_since,
  per.first_name,
  per.last_name,
  per.preferred_name,
  per.date_of_birth,
  org.legal_name,
  org.entity_type,
  org.abn,
  (select cp.value from public.contact_points cp
     where cp.party_id = p.id and cp.kind = 'email' and cp.is_preferred limit 1) as preferred_email,
  (select cp.value from public.contact_points cp
     where cp.party_id = p.id and cp.kind = 'phone_mobile' and cp.is_preferred limit 1) as preferred_mobile
from public.parties p
join public.party_roles r
  on r.party_id = p.id and r.role = 'client' and r.status = 'active' and r.end_date is null
left join public.persons per on per.party_id = p.id
left join public.organisations org on org.party_id = p.id
where p.status = 'active';

comment on view public.clients is 'Everyday view: all active clients (persons and organisations) with preferred contact details.';

-- households: client_groups filtered to households
create view public.households
with (security_invoker = true) as
select * from public.client_groups where group_type = 'household';

comment on view public.households is 'client_groups of type household.';

-- business_entities: client_groups filtered to business entities
create view public.business_entities
with (security_invoker = true) as
select * from public.client_groups where group_type = 'business_entity';

comment on view public.business_entities is 'client_groups of type business_entity.';

-- group_summary: group with member roll-up
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
