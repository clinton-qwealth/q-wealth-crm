-- Separate permission assignment from staff identity (31 Aug 2026)
--
-- On 26 Aug the staff_users read policy was tightened to "own row or manage_staff",
-- because the table carried profile_id and therefore exposed every colleague's
-- permission matrix. That fixed the disclosure but forced staff_directory to be a
-- SECURITY DEFINER view, since an invoker view would have respected the new policy
-- and returned only the caller's own row. The linter flags every definer view at
-- ERROR level, permanently.
--
-- The tightening was the right response to the wrong problem. The disclosure was
-- never about staff identity; it was about the person-to-profile mapping sharing a
-- table with it. Moving the mapping into its own strictly-scoped table lets
-- staff_users go back to being plainly readable, removes the need for a definer
-- view entirely, and clears the advisor notice rather than reclassifying it.
--
-- Nothing else in the database referenced profile_id: only current_staff_has(),
-- confirmed by inspecting every function, view and policy first.
--
-- !! THIS MIGRATION BROKE THE LIVE MCP SERVER FOR ABOUT TEN MINUTES. !!
-- Dropping staff_users.profile_id removed the foreign key that the deployed
-- getStaff() embed relied on, so every MCP request returned "Not an active Q
-- Wealth staff member" until crm-mcp v0.1.5 was deployed. The safe sequence for a
-- database holding real client data is three separate steps:
--   1. add the new table and backfill    (additive, nothing breaks)
--   2. deploy clients reading the new path
--   3. only then drop the old column
-- Doing all three at once is only acceptable while the database is empty of real
-- data. See readiness checklist item 5.

create table public.staff_access_assignments (
  staff_id   uuid primary key references public.staff_users(id) on delete cascade,
  profile_id uuid not null references public.access_profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.staff_access_assignments is
  'Which access profile each staff member holds. Separated from staff_users so that staff identity can be readable by colleagues while the permission mapping stays restricted to administrators. Primary key on staff_id enforces exactly one profile per person.';

insert into public.staff_access_assignments (staff_id, profile_id)
select id, profile_id from public.staff_users;

-- SECURITY DEFINER, so it reads past RLS on the new table. That is what stops a
-- recursion: the table's own policy calls current_staff_has('manage_staff'),
-- which would otherwise re-enter this function.
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

alter table public.staff_users drop column profile_id;

-- staff_users now holds only identity. auth_user_id stays readable by colleagues
-- deliberately: it is an opaque identifier that grants nothing on its own, since
-- auth.uid() cannot be forged and the logs keyed by it are admin-read only.
-- Inactive rows remain visible to active staff on purpose, because notes are
-- append-only and reference author_staff_id forever.
drop policy if exists staff_read_own_or_admin on public.staff_users;

create policy staff_read_staff_users on public.staff_users
  for select to authenticated
  using (public.is_active_staff());

-- Now a convenience surface rather than a boundary: staff_users itself is
-- readable, so this view exists to keep callers from over-fetching. Being an
-- invoker view, it draws no advisor notice.
drop view if exists public.staff_directory;

create view public.staff_directory
with (security_invoker = true) as
  select su.id, su.full_name, su.email, su.status
  from public.staff_users su;

comment on view public.staff_directory is
  'Name/email directory of all staff, active and former, for owner pickers and note-author lookups. A least-exposure convenience over staff_users, not an access boundary; security_invoker so the caller''s own RLS applies.';

revoke all on public.staff_directory from anon;
grant select on public.staff_directory to authenticated;

alter table public.staff_access_assignments enable row level security;

create policy read_own_or_admin_assignment on public.staff_access_assignments
  for select to authenticated
  using (
    staff_id = public.current_staff_id()
    or public.current_staff_has('manage_staff')
  );

create policy admin_write_assignment on public.staff_access_assignments
  for all to authenticated
  using (public.current_staff_has('manage_staff'))
  with check (public.current_staff_has('manage_staff'));

revoke all on public.staff_access_assignments from anon;
grant select, insert, update, delete on public.staff_access_assignments to authenticated;

-- Permission grants are among the entries a regulator is most likely to ask
-- about, so this table must be in the audit trail.
create trigger trg_staff_access_assignments_updated_at
  before update on public.staff_access_assignments
  for each row execute function public.set_updated_at();

create trigger trg_staff_access_assignments_audit
  after insert or update or delete on public.staff_access_assignments
  for each row execute function public.record_audit('staff_id', '');
