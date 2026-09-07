-- Both views created since the 3 September privilege audit — group_notes_summary
-- (6 Sep) and workflow_board (7 Sep) — carry the full default-privilege set for
-- `authenticated`: DELETE, INSERT, REFERENCES, TRIGGER, TRUNCATE and UPDATE as
-- well as SELECT. The other ten views in the schema hold SELECT alone.
--
-- No data was ever exposed by this. Both are security_invoker views, so a write
-- attempted through one is still evaluated against the base table's RLS, and
-- notes are append-only by trigger regardless. But a privilege for a command no
-- policy allows can never be legitimately used, and the standard set on 3
-- September was that `authenticated` holds only what a policy justifies.
--
-- The cause is the decision recorded on 3 September to LEAVE Supabase's default
-- privileges for `authenticated` in place (revoking them makes every future
-- object invisible until granted). That decision stands, and this is its cost:
-- every object created since inherits writes it should not have, so tightening
-- has to be part of the migration that creates one. Both these views are read
-- from and never written through — checked in lib/ before revoking.
revoke insert, update, delete, truncate, references, trigger
  on public.workflow_board from authenticated;

revoke insert, update, delete, truncate, references, trigger
  on public.group_notes_summary from authenticated;

-- Re-asserted rather than assumed: these are the only privileges either view
-- should hold, for the only role that should hold any.
grant select on public.workflow_board to authenticated;
grant select on public.group_notes_summary to authenticated;

revoke all on public.workflow_board from anon, public;
revoke all on public.group_notes_summary from anon, public;
