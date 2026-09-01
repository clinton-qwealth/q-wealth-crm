-- Enable RLS on every table
alter table public.parties enable row level security;
alter table public.persons enable row level security;
alter table public.organisations enable row level security;
alter table public.party_roles enable row level security;
alter table public.party_relationships enable row level security;
alter table public.contact_points enable row level security;
alter table public.client_groups enable row level security;
alter table public.client_group_members enable row level security;
alter table public.staff_users enable row level security;
alter table public.party_sensitive_data enable row level security;
alter table public.sensitive_access_log enable row level security;

-- Standard CRM tables: full access for active staff (authenticated users in staff_users)
create policy staff_all_parties on public.parties
  for all to authenticated using (public.is_active_staff()) with check (public.is_active_staff());
create policy staff_all_persons on public.persons
  for all to authenticated using (public.is_active_staff()) with check (public.is_active_staff());
create policy staff_all_organisations on public.organisations
  for all to authenticated using (public.is_active_staff()) with check (public.is_active_staff());
create policy staff_all_party_roles on public.party_roles
  for all to authenticated using (public.is_active_staff()) with check (public.is_active_staff());
create policy staff_all_party_relationships on public.party_relationships
  for all to authenticated using (public.is_active_staff()) with check (public.is_active_staff());
create policy staff_all_contact_points on public.contact_points
  for all to authenticated using (public.is_active_staff()) with check (public.is_active_staff());
create policy staff_all_client_groups on public.client_groups
  for all to authenticated using (public.is_active_staff()) with check (public.is_active_staff());
create policy staff_all_client_group_members on public.client_group_members
  for all to authenticated using (public.is_active_staff()) with check (public.is_active_staff());

-- staff_users: staff can read the roster; only admins can change it
create policy staff_read_staff_users on public.staff_users
  for select to authenticated using (public.is_active_staff());
create policy admin_write_staff_users on public.staff_users
  for insert to authenticated with check (public.current_staff_has('admin'));
create policy admin_update_staff_users on public.staff_users
  for update to authenticated using (public.current_staff_has('admin')) with check (public.current_staff_has('admin'));
create policy admin_delete_staff_users on public.staff_users
  for delete to authenticated using (public.current_staff_has('admin'));

-- party_sensitive_data: NO policies -> deny all. Access only via security definer functions.

-- sensitive_access_log: admins may read the audit trail; nobody writes directly
create policy admin_read_sensitive_log on public.sensitive_access_log
  for select to authenticated using (public.current_staff_has('admin'));
