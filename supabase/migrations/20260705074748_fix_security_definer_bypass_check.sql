-- BUG FIX: inside SECURITY DEFINER functions current_user is the function owner (postgres),
-- so the admin bypass fired for every caller. Base the bypass on the request JWT instead:
-- no JWT (direct admin/DB connection) or service_role JWT -> bypass; otherwise evaluate the caller.

create or replace function public.is_elevated_context()
returns boolean
language plpgsql
stable
set search_path = ''
as $$
declare
  v_claims text;
begin
  v_claims := coalesce(current_setting('request.jwt.claims', true), '');
  if v_claims = '' or v_claims = 'null' then
    return true; -- direct database connection (postgres/admin tooling), no API JWT
  end if;
  return coalesce(v_claims::jsonb ->> 'role', '') = 'service_role';
end;
$$;
revoke all on function public.is_elevated_context() from public, anon;
grant execute on function public.is_elevated_context() to authenticated, service_role;

create or replace function public.is_active_staff()
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  select
    case
      when public.is_elevated_context() then true
      else exists (
        select 1 from public.staff_users su
        where su.auth_user_id = (select auth.uid())
          and su.status = 'active'
      )
    end;
$$;

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
  if public.is_elevated_context() then
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
  if public.is_elevated_context() then
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
  if public.is_elevated_context() then
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
    return true;
  end if;
  return exists (
    select 1 from public.client_group_members m
    where m.party_id = p_party_id
      and m.end_date is null
      and public.staff_can_access_group(m.group_id)
  );
end;
$$;
