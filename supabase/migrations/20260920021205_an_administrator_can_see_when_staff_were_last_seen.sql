-- An administrator can see when a staff member was last seen (20 Sep 2026)
--
-- Clinton asked for a last-active date and time on the staff records. Supabase
-- already knows: GoTrue stamps `auth.users.last_sign_in_at` and keeps a row per
-- live session. Nothing in this schema could read either, because **PostgREST
-- does not serve the `auth` schema** — that is the whole reason this function
-- exists rather than a column on a view.
--
-- ## What "last seen" means here, precisely
--
-- The most recent evidence that the person was using the CRM:
--
--   greatest(last_sign_in_at, the newest session's updated_at)
--
-- A session's `updated_at` moves every time its access token is refreshed, so
-- somebody working through the day keeps moving it long after they last typed
-- a password. `last_sign_in_at` alone would have read as this morning for
-- somebody who had been in the CRM all afternoon — which is what makes it the
-- wrong answer on its own, and why it is only half of this.
--
-- `greatest()` ignores nulls in Postgres, so a person with no session falls back
-- to their sign-in, and one who has never signed in is null rather than a date.
--
-- **`updated_at` and NOT `refreshed_at`, deliberately.** `auth.sessions` carries
-- both, and they move together — but `refreshed_at` is `timestamp WITHOUT time
-- zone` holding UTC, so comparing it to `now()` silently reads it as local time
-- and lands ten hours out in Sydney. `updated_at` is `timestamptz` and needs no
-- such care. Checked against the live table before this was written.
--
-- ## And what it does not mean
--
-- A session row survives until its refresh token expires or the person signs
-- out, so `has_live_session` means "holds a session that has not been given up",
-- not "is looking at the screen right now". The Staff tab labels it **Signed
-- in**, which is what it actually says.
--
-- ## Why a function and not a view
--
-- A view that reads `auth.users` would have to be SECURITY DEFINER, which
-- Supabase's linter flags at ERROR level permanently — the exact state
-- migration 20260831114103 exists to escape. A definer FUNCTION is the
-- established shape here: `request_staff_access()` reads `auth.users` the same
-- way. The permission check is inside it, so a non-administrator gets **zero
-- rows** rather than a refusal, matching how every other staff read behaves.

create or replace function public.staff_last_seen()
returns table (
  staff_id         uuid,
  last_seen_at     timestamptz,
  last_sign_in_at  timestamptz,
  has_live_session boolean
)
language sql
stable
security definer
set search_path to ''
as $fn$
  select su.id,
         greatest(u.last_sign_in_at, s.newest_session),
         u.last_sign_in_at,
         coalesce(s.live, false)
    from public.staff_users su
    join auth.users u on u.id = su.auth_user_id
    left join lateral (
      select max(x.updated_at) as newest_session,
             -- `not_after` bounds a time-boxed session; null means unbounded.
             bool_or(x.not_after is null or x.not_after > now()) as live
        from auth.sessions x
       where x.user_id = u.id
    ) s on true
   -- Fail-closed, and inside the function because it runs as its owner: without
   -- this line every signed-in person could read every colleague's sign-in time.
   where public.current_staff_has('manage_staff');
$fn$;

comment on function public.staff_last_seen() is
  'When each staff member was last seen: the later of their last sign-in and their newest session''s refresh, plus whether they still hold a session. Reads auth.users and auth.sessions, which PostgREST does not serve, so it runs as its owner — and returns nothing at all to a caller without manage_staff. Behind the Staff tab''s Last seen column. Added 20 Sep 2026.';

revoke all on function public.staff_last_seen() from public, anon;
grant execute on function public.staff_last_seen() to authenticated;

-- ---------------------------------------------------------------------------
-- Prove it, or abort
-- ---------------------------------------------------------------------------

do $$
declare
  v_rows int;
begin
  if to_regprocedure('public.staff_last_seen()') is null then
    raise exception 'staff_last_seen was not created';
  end if;

  -- As the owner, is_elevated_context() is true, so current_staff_has() returns
  -- true and every staff row comes back. That proves the join reaches auth.users
  -- at all — the thing a plain view could not do.
  select count(*) into v_rows from public.staff_last_seen();
  if v_rows <> (select count(*) from public.staff_users su join auth.users u on u.id = su.auth_user_id) then
    raise exception 'staff_last_seen returned % rows, expected one per staff member with an auth account', v_rows;
  end if;

  if exists (
    select 1 from information_schema.role_routine_grants
     where routine_schema = 'public' and routine_name = 'staff_last_seen' and grantee in ('anon', 'PUBLIC')
  ) then
    raise exception 'anon or PUBLIC may execute staff_last_seen';
  end if;
end $$;
