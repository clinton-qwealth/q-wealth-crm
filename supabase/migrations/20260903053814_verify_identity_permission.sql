-- A permission for triggering an identity verification (3 Sep 2026)
--
-- Being signed in is not the same as being allowed to telephone a client and
-- spend money doing it, so this is its own flag rather than a reuse of
-- manage_groups. Defaults to false: nobody acquires it by being created.
alter table public.access_profiles
  add column if not exists verify_identity boolean not null default false;

comment on column public.access_profiles.verify_identity is
  'May send an identity-verification code to a client. Separate from manage_groups because it spends money and contacts clients directly. Access scope still applies on top: holding this does not widen which clients are reachable.';

-- current_staff_has answers `false` for any permission name it does not know,
-- so the flag is inert until it appears in this list. Fail-closed, but it does
-- mean the column and this function must land in the same migration.
create or replace function public.current_staff_has(p_permission text)
returns boolean
language plpgsql
stable
security definer
set search_path to ''
as $fn$
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
           when 'file_unmatched_notes' then ap.file_unmatched_notes
           when 'verify_identity' then ap.verify_identity
           else false
         end
    into v_ok
  from public.staff_users su
  join public.staff_access_assignments saa on saa.staff_id = su.id
  join public.access_profiles ap on ap.id = saa.profile_id
  where su.auth_user_id = (select auth.uid())
    and su.status = 'active';
  return coalesce(v_ok, false);
end;
$fn$;

revoke all on function public.current_staff_has(text) from public, anon;
grant execute on function public.current_staff_has(text) to authenticated, service_role;
