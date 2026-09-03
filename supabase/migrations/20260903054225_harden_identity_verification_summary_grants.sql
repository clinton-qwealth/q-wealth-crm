-- The view's write grants too (3 Sep 2026)
--
-- The previous migration revoked anon and public from the summary view but left
-- INSERT, UPDATE and DELETE granted to authenticated by Supabase's default
-- privileges. A join of three relations is not auto-updatable, so Postgres
-- would have refused the write regardless — but the same reasoning applies: a
-- privilege that can never be legitimately used should not be held. Verified by
-- reading the grants back rather than assuming the revoke above had covered it.
revoke insert, update, delete, truncate, references, trigger
  on public.identity_verification_summary from authenticated;
grant select on public.identity_verification_summary to authenticated;
