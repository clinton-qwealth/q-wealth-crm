-- Removing the blanket public-role grants across the schema (3 Sep 2026)
--
-- Found while hardening identity_verification. Supabase configures DEFAULT
-- PRIVILEGES on schema public for role postgres:
--
--   tables    -> arwdDxtm (everything) to anon, authenticated, service_role
--   sequences -> rwU                   to anon, authenticated, service_role
--   functions -> X (execute)           to anon, authenticated, service_role
--
-- So every table a migration creates is immediately granted in full to the
-- ANONYMOUS role, and every function is immediately executable by it. Twenty-two
-- of twenty-seven tables were in that state, including parties, persons,
-- contact_points, notes and staff_users.
--
-- NO DATA WAS EXPOSED. Row-level security is enabled on every one of those
-- tables and refused the access; an anonymous read returned an empty set rather
-- than rows, which is what the live probing recorded on the Web App page found.
-- But it left RLS as the SINGLE control standing between client data and an
-- anonymous caller, and the stated design of this database is that the last
-- layer holds even when the ones above it fail. It is also why every migration
-- adding a function has had to remember `revoke ... from public, anon` — the
-- grant it is undoing was applied automatically a moment earlier.
--
-- Three parts: the cause, then existing objects, then aligning what the
-- authenticated role holds with what each table's policies actually declare.
--
-- Deliberately NOT changed: the default privileges for `authenticated`. That
-- role is a real signed-in staff member and RLS is a genuine gate for it, and
-- revoking its defaults would mean every future table is invisible until
-- granted — a workflow change worth deciding separately rather than smuggling
-- into a security fix.

-- ---------------------------------------------------------------------------
-- 1. The cause
-- ---------------------------------------------------------------------------
alter default privileges in schema public revoke all on tables from anon;
alter default privileges in schema public revoke all on sequences from anon;
alter default privileges in schema public revoke execute on functions from anon;

-- ---------------------------------------------------------------------------
-- 2. Every existing table and view: anon and PUBLIC get nothing
-- ---------------------------------------------------------------------------
-- Done as a loop rather than 36 statements so that nothing currently in the
-- schema can be missed by an oversight in a hand-written list.
do $harden$
declare
  r record;
begin
  for r in
    select c.relname
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r', 'v')
    order by c.relname
  loop
    execute format('revoke all on public.%I from anon', r.relname);
    execute format('revoke all on public.%I from public', r.relname);
  end loop;
end $harden$;

-- ---------------------------------------------------------------------------
-- 3. authenticated: exactly what each table's policies declare, and no more
-- ---------------------------------------------------------------------------
-- The policy set is the declared intent for a table. Where a table has no
-- policy for a command, holding the privilege for it is meaningless — the
-- statement would be refused anyway — so the privilege is withdrawn. Listed
-- explicitly, one table per pair of lines, so this is reviewable.

revoke all on public.access_profiles from authenticated;
grant select, insert, update, delete on public.access_profiles to authenticated;

-- SELECT-only: the audit trail is written by record_audit(), which is SECURITY
-- DEFINER and so inserts as the owner. Nothing needs to write it as a caller.
revoke all on public.audit_log from authenticated;
grant select on public.audit_log to authenticated;

revoke all on public.client_group_access from authenticated;
grant select, insert, update, delete on public.client_group_access to authenticated;

revoke all on public.client_group_members from authenticated;
grant select, insert, update, delete on public.client_group_members to authenticated;

revoke all on public.client_groups from authenticated;
grant select, insert, update, delete on public.client_groups to authenticated;

revoke all on public.contact_points from authenticated;
grant select, insert, update, delete on public.contact_points to authenticated;

revoke all on public.financial_account_owners from authenticated;
grant select, insert, update, delete on public.financial_account_owners to authenticated;

revoke all on public.financial_account_valuations from authenticated;
grant select, insert, update, delete on public.financial_account_valuations to authenticated;

revoke all on public.financial_accounts from authenticated;
grant select, insert, update, delete on public.financial_accounts to authenticated;

-- Already correct; restated so this migration is a complete statement of the
-- schema's grants rather than a partial one.
revoke all on public.identity_verification from authenticated;
grant select on public.identity_verification to authenticated;

revoke all on public.insurance_policies from authenticated;
grant select, insert, update, delete on public.insurance_policies to authenticated;

revoke all on public.insurance_policy_covers from authenticated;
grant select, insert, update, delete on public.insurance_policy_covers to authenticated;

revoke all on public.insurance_policy_parties from authenticated;
grant select, insert, update, delete on public.insurance_policy_parties to authenticated;

-- No UPDATE policy: an attachment is replaced, not edited.
revoke all on public.note_attachments from authenticated;
grant select, insert, delete on public.note_attachments to authenticated;

-- Append-only.
revoke all on public.note_subjects from authenticated;
grant select, insert on public.note_subjects to authenticated;

-- Append-only apart from the correction window, which is an UPDATE policy.
revoke all on public.notes from authenticated;
grant select, insert, update on public.notes to authenticated;

revoke all on public.organisations from authenticated;
grant select, insert, update, delete on public.organisations to authenticated;

revoke all on public.parties from authenticated;
grant select, insert, update, delete on public.parties to authenticated;

revoke all on public.party_relationships from authenticated;
grant select, insert, update, delete on public.party_relationships to authenticated;

revoke all on public.party_roles from authenticated;
grant select, insert, update, delete on public.party_roles to authenticated;

-- NOTHING. This table holds encrypted tax file numbers and similar. It has RLS
-- enabled with no policies at all, so every statement against it is already
-- refused; the only way in is reveal_sensitive_field and set_sensitive_field,
-- which are SECURITY DEFINER. A privilege here can never be legitimately used.
revoke all on public.party_sensitive_data from authenticated;

revoke all on public.persons from authenticated;
grant select, insert, update, delete on public.persons to authenticated;

-- SELECT-only: written by the SECURITY DEFINER reveal function as the owner.
-- An audit log that its subject can insert into is not an audit log.
revoke all on public.sensitive_access_log from authenticated;
grant select on public.sensitive_access_log to authenticated;

revoke all on public.staff_access_assignments from authenticated;
grant select, insert, update, delete on public.staff_access_assignments to authenticated;

revoke all on public.staff_users from authenticated;
grant select, insert, update, delete on public.staff_users to authenticated;

revoke all on public.team_members from authenticated;
grant select, insert, update, delete on public.team_members to authenticated;

revoke all on public.teams from authenticated;
grant select, insert, update, delete on public.teams to authenticated;

-- Views are read-only projections over the tables above. None should ever be
-- written through, and several are not auto-updatable anyway.
revoke all on public.business_entities from authenticated;
grant select on public.business_entities to authenticated;
revoke all on public.clients from authenticated;
grant select on public.clients to authenticated;
revoke all on public.financial_account_latest_valuation from authenticated;
grant select on public.financial_account_latest_valuation to authenticated;
revoke all on public.financial_account_value_trend from authenticated;
grant select on public.financial_account_value_trend to authenticated;
revoke all on public.financial_accounts_summary from authenticated;
grant select on public.financial_accounts_summary to authenticated;
revoke all on public.group_summary from authenticated;
grant select on public.group_summary to authenticated;
revoke all on public.households from authenticated;
grant select on public.households to authenticated;
revoke all on public.identity_verification_summary from authenticated;
grant select on public.identity_verification_summary to authenticated;
revoke all on public.insurance_policies_summary from authenticated;
grant select on public.insurance_policies_summary to authenticated;
revoke all on public.staff_directory from authenticated;
grant select on public.staff_directory to authenticated;
