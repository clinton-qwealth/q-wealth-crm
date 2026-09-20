-- A user group can actually be created (20 Sep 2026)
--
-- BUG FIX, found by Clinton within minutes of the territories migration landing:
-- pressing "New user group" answered `permission denied for function
-- user_group_name`.
--
-- ## The mistake, and why the branch probe missed it
--
-- `create_user_group`, `update_user_group_patch`, `set_user_group_members` and
-- `update_staff_patch` are all SECURITY INVOKER — deliberately, because RLS is
-- the enforcement point and a definer function would bypass it. That means they
-- execute AS THE CALLER, so the caller needs EXECUTE on everything they call.
-- Both little helpers had `revoke all ... from public, anon, authenticated` and
-- no matching grant, so every one of those four paths died the moment it reached
-- one:
--
--   create a user group            → user_group_name
--   rename one                     → user_group_name
--   set a group's members          → apply_user_group_membership
--   save a person's user groups    → apply_user_group_membership
--
-- The probe on the `administration` branch tested only the REFUSAL paths for
-- those functions — a non-administrator creating, an inactive person joining, an
-- archived group being assigned — and every one of those raises before reaching
-- a helper. The refusals hid the breakage. **A write function needs its happy
-- path probed, not only its guards**; the probe for this file does exactly that.
--
-- ## Why a grant rather than SECURITY DEFINER
--
-- Making the helpers definer would fix the error and silently hand every caller
-- the owner's rights over `user_group_members` — the opposite of the rule this
-- schema is built on. They stay INVOKER and `authenticated` is granted EXECUTE:
-- `user_group_name` is a pure text transform that touches nothing, and
-- `apply_user_group_membership` writes only what `admin_insert_user_group_members`
-- already allows, so a non-administrator calling it directly still meets RLS.

grant execute on function public.user_group_name(text) to authenticated;
grant execute on function public.apply_user_group_membership(uuid[], uuid[]) to authenticated;

-- ---------------------------------------------------------------------------
-- Prove it, or abort
-- ---------------------------------------------------------------------------

do $$
begin
  if not has_function_privilege('authenticated', 'public.user_group_name(text)', 'EXECUTE') then
    raise exception 'authenticated still cannot execute user_group_name';
  end if;
  if not has_function_privilege('authenticated', 'public.apply_user_group_membership(uuid[], uuid[])', 'EXECUTE') then
    raise exception 'authenticated still cannot execute apply_user_group_membership';
  end if;

  -- INVOKER, both of them: the grant is only meaningful because RLS still runs
  -- as the caller. If either ever becomes SECURITY DEFINER this grant turns into
  -- a hole, so the migration says so rather than leaving it to a reviewer.
  if (select bool_or(p.prosecdef) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname in ('user_group_name', 'apply_user_group_membership')) then
    raise exception 'a user-group helper is SECURITY DEFINER; the grant would bypass row-level security';
  end if;
end $$;
