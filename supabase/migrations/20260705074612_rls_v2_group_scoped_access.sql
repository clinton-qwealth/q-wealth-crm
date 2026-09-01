-- Can the calling staff member access a given client group?
-- Yes if: profile has view_all_groups, OR they own the group, OR granted directly/via team.
create or replace function public.staff_can_access_group(p_group_id uuid)
returns boolean
language plpgsql
security definer
stable
set search_path = ''
as $$
declare
  v_staff uuid;
begin
  if current_user in ('postgres', 'service_role') then
    return true;
  end if;
  v_staff := public.current_staff_id();
  if v_staff is null then
    return false;
  end if;
  if public.current_staff_has('view_all_groups') then
    return true;
  end if;
  return exists (
      select 1 from public.client_groups g
      where g.id = p_group_id and g.owner_staff_id = v_staff
    )
    or exists (
      select 1 from public.client_group_access a
      where a.group_id = p_group_id
        and (
          a.staff_id = v_staff
          or a.team_id in (select tm.team_id from public.team_members tm where tm.staff_id = v_staff)
        )
    );
end;
$$;
revoke all on function public.staff_can_access_group(uuid) from public, anon;
grant execute on function public.staff_can_access_group(uuid) to authenticated, service_role;

-- Can the calling staff member see a given party?
-- Yes if: view_all_groups, OR the party belongs to an accessible group,
-- OR the party has no group memberships yet (new/ungrouped parties visible to all active staff).
create or replace function public.staff_can_access_party(p_party_id uuid)
returns boolean
language plpgsql
security definer
stable
set search_path = ''
as $$
declare
  v_staff uuid;
begin
  if current_user in ('postgres', 'service_role') then
    return true;
  end if;
  v_staff := public.current_staff_id();
  if v_staff is null then
    return false;
  end if;
  if public.current_staff_has('view_all_groups') then
    return true;
  end if;
  if not exists (
    select 1 from public.client_group_members m
    where m.party_id = p_party_id and m.end_date is null
  ) then
    return true; -- ungrouped party
  end if;
  return exists (
    select 1 from public.client_group_members m
    where m.party_id = p_party_id
      and m.end_date is null
      and public.staff_can_access_group(m.group_id)
  );
end;
$$;
revoke all on function public.staff_can_access_party(uuid) from public, anon;
grant execute on function public.staff_can_access_party(uuid) to authenticated, service_role;

-- Replace the all-staff policies with scoped ones
drop policy staff_all_parties on public.parties;
drop policy staff_all_persons on public.persons;
drop policy staff_all_organisations on public.organisations;
drop policy staff_all_party_roles on public.party_roles;
drop policy staff_all_party_relationships on public.party_relationships;
drop policy staff_all_contact_points on public.contact_points;
drop policy staff_all_client_groups on public.client_groups;
drop policy staff_all_client_group_members on public.client_group_members;

create policy scoped_parties on public.parties
  for all to authenticated
  using (public.staff_can_access_party(id))
  with check (public.staff_can_access_party(id));

create policy scoped_persons on public.persons
  for all to authenticated
  using (public.staff_can_access_party(party_id))
  with check (public.staff_can_access_party(party_id));

create policy scoped_organisations on public.organisations
  for all to authenticated
  using (public.staff_can_access_party(party_id))
  with check (public.staff_can_access_party(party_id));

create policy scoped_party_roles on public.party_roles
  for all to authenticated
  using (public.staff_can_access_party(party_id))
  with check (public.staff_can_access_party(party_id));

create policy scoped_party_relationships on public.party_relationships
  for all to authenticated
  using (public.staff_can_access_party(from_party_id) and public.staff_can_access_party(to_party_id))
  with check (public.staff_can_access_party(from_party_id) and public.staff_can_access_party(to_party_id));

create policy scoped_contact_points on public.contact_points
  for all to authenticated
  using (public.staff_can_access_party(party_id))
  with check (public.staff_can_access_party(party_id));

-- client_groups: read requires access; create requires manage_groups; change requires both
create policy scoped_read_client_groups on public.client_groups
  for select to authenticated
  using (public.staff_can_access_group(id));
create policy scoped_insert_client_groups on public.client_groups
  for insert to authenticated
  with check (public.current_staff_has('manage_groups'));
create policy scoped_update_client_groups on public.client_groups
  for update to authenticated
  using (public.staff_can_access_group(id) and public.current_staff_has('manage_groups'))
  with check (public.staff_can_access_group(id) and public.current_staff_has('manage_groups'));
create policy scoped_delete_client_groups on public.client_groups
  for delete to authenticated
  using (public.staff_can_access_group(id) and public.current_staff_has('manage_groups'));

create policy scoped_read_client_group_members on public.client_group_members
  for select to authenticated
  using (public.staff_can_access_group(group_id));
create policy scoped_write_client_group_members on public.client_group_members
  for insert to authenticated
  with check (public.staff_can_access_group(group_id) and public.current_staff_has('manage_groups'));
create policy scoped_update_client_group_members on public.client_group_members
  for update to authenticated
  using (public.staff_can_access_group(group_id) and public.current_staff_has('manage_groups'))
  with check (public.staff_can_access_group(group_id) and public.current_staff_has('manage_groups'));
create policy scoped_delete_client_group_members on public.client_group_members
  for delete to authenticated
  using (public.staff_can_access_group(group_id) and public.current_staff_has('manage_groups'));

-- New admin/config tables
alter table public.access_profiles enable row level security;
alter table public.teams enable row level security;
alter table public.team_members enable row level security;
alter table public.client_group_access enable row level security;

create policy staff_read_access_profiles on public.access_profiles
  for select to authenticated using (public.is_active_staff());
create policy admin_write_access_profiles on public.access_profiles
  for all to authenticated using (public.current_staff_has('manage_staff')) with check (public.current_staff_has('manage_staff'));

create policy staff_read_teams on public.teams
  for select to authenticated using (public.is_active_staff());
create policy admin_write_teams on public.teams
  for all to authenticated using (public.current_staff_has('manage_staff')) with check (public.current_staff_has('manage_staff'));

create policy staff_read_team_members on public.team_members
  for select to authenticated using (public.is_active_staff());
create policy admin_write_team_members on public.team_members
  for all to authenticated using (public.current_staff_has('manage_staff')) with check (public.current_staff_has('manage_staff'));

create policy staff_read_group_access on public.client_group_access
  for select to authenticated using (public.staff_can_access_group(group_id));
create policy managers_write_group_access on public.client_group_access
  for all to authenticated
  using (public.staff_can_access_group(group_id) and public.current_staff_has('manage_groups'))
  with check (public.staff_can_access_group(group_id) and public.current_staff_has('manage_groups'));
