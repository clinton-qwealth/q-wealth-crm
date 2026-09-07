-- Write path for the workflow detail page's field box: owner, due date and
-- description. Until now nothing in the web app could set any of the three.
--
-- A JSONB patch where KEY PRESENCE decides, exactly like update_person_patch():
--   absent key            -> leave the column alone
--   present but empty     -> clear it
--   present with a value  -> set it
--
-- Not three plain parameters defaulting to null, and the reason is the lesson
-- update_person already taught: with null meaning "leave alone" there is no way
-- left to say "clear this", and with null meaning "clear" a caller that sends
-- one field silently wipes the other two. The web app's form happens to submit
-- all three every time, but this function is also reachable from the connector
-- and from psql, and those callers will not.
--
-- A description of nothing but spaces is not a description, so blank input
-- clears rather than storing whitespace.
create or replace function public.set_workflow_details(
  p_id    uuid,
  p_patch jsonb
) returns void
language plpgsql
security invoker
set search_path to ''
as $fn$
begin
  if public.current_staff_id() is null then
    raise exception 'Not an active staff member';
  end if;

  update public.workflows w
     set description    = case when p_patch ? 'description'
                                 then nullif(btrim(p_patch->>'description'), '')
                                 else w.description
                            end,
         due_at         = case when p_patch ? 'due_at'
                                 then nullif(btrim(p_patch->>'due_at'), '')::date
                                 else w.due_at
                            end,
         owner_staff_id = case when p_patch ? 'owner_staff_id'
                                 then nullif(btrim(p_patch->>'owner_staff_id'), '')::uuid
                                 else w.owner_staff_id
                            end
   where w.id = p_id;

  -- RLS decides whether the row was visible and writable at all, so "not found"
  -- covers both "no such workflow" and "not yours" — and says so as one answer.
  if not found then
    raise exception 'No such workflow, or not within your access';
  end if;
end $fn$;

comment on function public.set_workflow_details(uuid, jsonb) is
  'Patch a workflow''s owner, due date and description. Key presence in p_patch decides: absent leaves the column, present-but-empty clears it.';

-- Load-bearing, never boilerplate: Postgres grants EXECUTE on every new
-- function to PUBLIC, and every role inherits from PUBLIC, so revoking from
-- anon alone would leave it callable by anyone.
revoke all on function public.set_workflow_details(uuid, jsonb) from public, anon;
grant execute on function public.set_workflow_details(uuid, jsonb) to authenticated;
