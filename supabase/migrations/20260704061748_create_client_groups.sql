-- client_groups: the service & billing unit. Household or business entity - same structure.
create table public.client_groups (
  id uuid primary key default gen_random_uuid(),
  group_type public.group_type not null,
  name text not null,
  status public.group_status not null default 'prospect',
  primary_contact_party_id uuid references public.parties (id),
  service_level text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.client_groups is 'Service and billing unit. group_type household (family) or business_entity (company + associated people). Same mechanics, different label.';

create trigger trg_client_groups_updated_at
  before update on public.client_groups
  for each row execute function public.set_updated_at();

-- client_group_members: joins any party (person, trust, company) to a group.
-- Persons can appear in multiple groups (family household + business group).
create table public.client_group_members (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.client_groups (id) on delete cascade,
  party_id uuid not null references public.parties (id) on delete cascade,
  member_role public.member_role not null,
  is_primary_group boolean not null default false,
  start_date date not null default current_date,
  end_date date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint client_group_members_dates check (end_date is null or end_date >= start_date)
);
comment on table public.client_group_members is 'Group membership with a role per membership. is_primary_group marks which group owns the person for reporting.';

create unique index client_group_members_one_open
  on public.client_group_members (group_id, party_id)
  where end_date is null;
create unique index client_group_members_one_primary_group
  on public.client_group_members (party_id)
  where is_primary_group and end_date is null;
create index client_group_members_group_idx on public.client_group_members (group_id);
create index client_group_members_party_idx on public.client_group_members (party_id);

create trigger trg_client_group_members_updated_at
  before update on public.client_group_members
  for each row execute function public.set_updated_at();
