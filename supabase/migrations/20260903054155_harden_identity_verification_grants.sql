-- Correcting the grants on identity_verification (3 Sep 2026)
--
-- The previous migration said "there is no insert grant to route around it
-- with". That was WRONG, and worth recording rather than quietly fixing.
--
-- Supabase sets default privileges on schema public granting ALL on new tables
-- to anon and authenticated. So `grant select ... to authenticated` did not
-- describe the table's privileges — it added nothing, and INSERT, UPDATE and
-- DELETE were already granted to both roles, anon included.
--
-- Nothing was actually reachable: row-level security is enabled and the only
-- policy is for SELECT to authenticated, so writes were refused and anon saw
-- no rows. But that left RLS as the single thing standing between a client's
-- verification history and any caller — and the stated design of this database
-- is that the last layer should still hold if the ones above it fail. A grant
-- that is never needed should not exist.
--
-- Applies to this table only. The same default-privilege grants sit on most
-- other tables in this schema and are being reviewed separately.

revoke all on public.identity_verification from anon;
revoke all on public.identity_verification from public;
revoke insert, update, delete, truncate, references, trigger
  on public.identity_verification from authenticated;
grant select on public.identity_verification to authenticated;

-- Deletes are refused for everyone but the owner and elevated contexts. The
-- table is evidence of an identity check; removing a row is not an operation
-- the application should be able to perform at all.

revoke all on public.identity_verification_summary from anon;
revoke all on public.identity_verification_summary from public;
grant select on public.identity_verification_summary to authenticated;

comment on table public.identity_verification is
  'One row per identity-verification attempt: a one-time code sent to a client''s mobile and the outcome of the read-back. Evidence of a client identity check. SELECT is the only privilege granted to authenticated, and the only policy is for SELECT, so every write goes through the SECURITY DEFINER functions that carry the permission and rate-limit checks. The outcome is recordable once, enforced by trigger. No code, hash or expiry is stored; the provider holds those.';
