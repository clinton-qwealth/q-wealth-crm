-- A profile no longer grants verify_identity (20 Sep 2026)
--
-- M2 of two, and the one-way step. M1 added `staff_users.verify_identity`,
-- backfilled it from the profiles, and switched `current_staff_has()` to read
-- it. Nothing in the database has read `access_profiles.verify_identity` since.
-- But the DEPLOYED APP did, on every page load, and dropping a column a live
-- build selects is the 31 August outage: every request answers 400 until the
-- next deploy lands.
--
-- DO NOT APPLY THIS BEFORE THE APP THAT STOPS SELECTING THE COLUMN IS LIVE.
-- The check is not something SQL can make; it is: open the production site,
-- confirm the Staff tab's Access box shows a "Verify identity" row, and only
-- then run this.
--
-- What is lost, deliberately: the profile-level history of who could verify.
-- It is not lost from the record — `access_profiles` is audited, so the 3
-- September grant to Adviser and Services and any later change are in
-- `audit_log` with their payloads. Only the live column goes.

alter table public.access_profiles drop column verify_identity;

comment on table public.access_profiles is
  'The named permission sets a staff member is assigned one of. Carries five flags since 20 Sep 2026: view_all_groups, view_sensitive, manage_groups, manage_staff and file_unmatched_notes. verify_identity is NOT one of them — it moved to staff_users that day and is granted per person by an administrator.';

-- ---------------------------------------------------------------------------
-- Sweep, or abort
-- ---------------------------------------------------------------------------
-- The column being gone is the easy half. The half worth asserting is that
-- nothing still NAMES it: a function rebuilt from a stale copy, or a view that
-- happened to project it, neither of which the drop above would have refused
-- if it were only referenced by string.

do $$
declare
  v_bad text := '';
begin
  if exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'access_profiles' and column_name = 'verify_identity') then
    raise exception 'access_profiles.verify_identity is still there';
  end if;

  -- Only the person's column may be read, and only by the one function.
  select coalesce(string_agg(p.oid::regprocedure::text, '; '), '')
    into v_bad
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.prokind = 'f'
     and p.prosrc ~ 'ap\.verify_identity';
  if v_bad <> '' then
    raise exception 'These still read verify_identity off the profile: %', v_bad;
  end if;

  if (select prosrc from pg_proc where proname = 'current_staff_has' and pronamespace = 'public'::regnamespace)
     not like '%then su.verify_identity%' then
    raise exception 'current_staff_has does not read the person''s flag';
  end if;

  -- And the person's column is still there, with its default.
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'staff_users'
                    and column_name = 'verify_identity' and column_default = 'false') then
    raise exception 'staff_users.verify_identity is missing or has lost its default';
  end if;
end $$;
