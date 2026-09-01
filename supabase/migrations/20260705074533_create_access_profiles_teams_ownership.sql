-- access_profiles: named permission sets
create table public.access_profiles (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  description text,
  view_all_groups boolean not null default false,
  view_sensitive boolean not null default false,
  manage_groups boolean not null default false,
  manage_staff boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.access_profiles is 'Named permission profiles. Every staff member has exactly one.';

create trigger trg_access_profiles_updated_at
  before update on public.access_profiles
  for each row execute function public.set_updated_at();

insert into public.access_profiles (name, description, view_all_groups, view_sensitive, manage_groups, manage_staff) values
  ('Adviser',    'Financial advisers. See own/assigned client groups only.',            false, true,  true,  false),
  ('Services',   'Client services & paraplanning. Work across all client groups.',      true,  true,  true,  false),
  ('Management', 'Practice management oversight. All groups, no sensitive reveals.',    true,  false, true,  false),
  ('Admin',      'System administrators. Full access including staff management.',      true,  true,  true,  true);

-- staff_users: move from boolean flags to profile
alter table public.staff_users add column profile_id uuid not null references public.access_profiles (id);
alter table public.staff_users drop column is_admin;
alter table public.staff_users drop column view_sensitive;

-- teams
create table public.teams (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  status public.record_status not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger trg_teams_updated_at
  before update on public.teams
  for each row execute function public.set_updated_at();

create table public.team_members (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams (id) on delete cascade,
  staff_id uuid not null references public.staff_users (id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (team_id, staff_id)
);

-- ownership: every client group can have an owning staff member (usually an adviser)
alter table public.client_groups
  add column owner_staff_id uuid references public.staff_users (id);
comment on column public.client_groups.owner_staff_id is 'Owning staff member (usually the servicing adviser). Owner always has access.';
create index client_groups_owner_idx on public.client_groups (owner_staff_id);

-- extra access grants beyond ownership (to a staff member or a whole team)
create type public.group_access_level as enum ('servicing', 'view');

create table public.client_group_access (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.client_groups (id) on delete cascade,
  staff_id uuid references public.staff_users (id) on delete cascade,
  team_id uuid references public.teams (id) on delete cascade,
  access_level public.group_access_level not null default 'servicing',
  created_at timestamptz not null default now(),
  constraint client_group_access_one_grantee check (
    (staff_id is not null and team_id is null) or (staff_id is null and team_id is not null)
  )
);
comment on table public.client_group_access is 'Access grants to client groups beyond ownership, for individual staff or teams.';

create unique index client_group_access_staff_unique on public.client_group_access (group_id, staff_id) where staff_id is not null;
create unique index client_group_access_team_unique on public.client_group_access (group_id, team_id) where team_id is not null;
create index client_group_access_group_idx on public.client_group_access (group_id);

-- helper: current staff row id
create or replace function public.current_staff_id()
returns uuid
language sql
security definer
stable
set search_path = ''
as $$
  select su.id from public.staff_users su
  where su.auth_user_id = (select auth.uid())
    and su.status = 'active';
$$;
revoke all on function public.current_staff_id() from public, anon;
grant execute on function public.current_staff_id() to authenticated, service_role;

-- rewire permission check to profiles
create or replace function public.current_staff_has(p_permission text)
returns boolean
language plpgsql
security definer
stable
set search_path = ''
as $$
declare
  v_ok boolean;
begin
  if current_user in ('postgres', 'service_role') then
    return true;
  end if;
  select case p_permission
           when 'view_sensitive' then ap.view_sensitive
           when 'view_all_groups' then ap.view_all_groups
           when 'manage_groups' then ap.manage_groups
           when 'manage_staff' then ap.manage_staff
           when 'admin' then ap.manage_staff
           else false
         end
    into v_ok
  from public.staff_users su
  join public.access_profiles ap on ap.id = su.profile_id
  where su.auth_user_id = (select auth.uid())
    and su.status = 'active';
  return coalesce(v_ok, false);
end;
$$;
