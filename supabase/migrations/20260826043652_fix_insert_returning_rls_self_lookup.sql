-- Fix INSERT ... RETURNING under RLS (26 Aug 2026)
--
-- notes_select and scoped_read_client_groups delegated entirely to a
-- security-definer helper that re-reads the same table by id. On
-- INSERT ... RETURNING, Postgres applies the SELECT policy to the new row, but
-- the helper's own lookup cannot see a row inserted by the statement currently
-- executing, so it returned false and the insert was rejected.
--
-- Effect: any client using supabase-js .insert(...).select(...) - which is how
-- the MCP server's add_note obtains the new note id - failed for every staff
-- member. Creating a client group as its owning adviser failed the same way.
--
-- Both helpers already grant access on a row-local condition (you authored the
-- note / you own the group). Hoisting that condition into the policy makes it
-- evaluable directly against the new row, with no lookup. This is an
-- equivalence, not a widening: any row matching the hoisted clause was already
-- granted by the helper.

drop policy if exists notes_select on public.notes;
create policy notes_select on public.notes
  for select to authenticated
  using (
    author_staff_id = public.current_staff_id()
    or public.staff_can_access_note(id)
  );

drop policy if exists scoped_read_client_groups on public.client_groups;
create policy scoped_read_client_groups on public.client_groups
  for select to authenticated
  using (
    owner_staff_id = public.current_staff_id()
    or public.staff_can_access_group(id)
  );
