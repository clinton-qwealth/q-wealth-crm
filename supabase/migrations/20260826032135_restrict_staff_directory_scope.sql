-- Staff directory scope (decided 26 Aug 2026)
--
-- Before: staff_read_staff_users was USING (is_active_staff()) - unscoped, so every
-- active staff member could read every staff row, including auth_user_id and
-- profile_id. profile_id joins to access_profiles, exposing each colleague's full
-- permission matrix (who can reveal TFNs, who is admin).
--
-- After: the base table is readable only for your own row, or by manage_staff.
-- A separate staff_directory view carries the columns the app legitimately needs
-- (owner pickers, note-author names, access-grant screens) for all staff.

-- 1. Base table: own row, or staff administrators.
drop policy if exists staff_read_staff_users on public.staff_users;

create policy staff_read_own_or_admin on public.staff_users
  for select to authenticated
  using (
    auth_user_id = (select auth.uid())
    or public.current_staff_has('manage_staff')
  );

-- 2. Directory view: safe columns, every staff member, active and former.
--
-- Deliberately NOT security_invoker: the view must read past the policy above,
-- and its WHERE clause is the access control. is_active_staff() is SECURITY
-- DEFINER and evaluates the caller's JWT, so a caller who is not active staff
-- (including anon) gets zero rows.
--
-- Former staff are included on purpose: notes are append-only and reference
-- author_staff_id forever, so a departed adviser must still resolve to a name
-- or historical advice records render a raw UUID.
create or replace view public.staff_directory as
  select su.id,
         su.full_name,
         su.email,
         su.status
  from public.staff_users su
  where public.is_active_staff();

comment on view public.staff_directory is
  'Staff name/email directory readable by any active staff member. Includes former staff so append-only note authors always resolve. Permission mapping (profile_id) is deliberately excluded - see staff_users.';

-- 3. Grants. Supabase default privileges grant new objects to anon and
--    authenticated; anon must not reach the directory even though the WHERE
--    guard would already return nothing.
revoke all on public.staff_directory from anon;
grant select on public.staff_directory to authenticated;
