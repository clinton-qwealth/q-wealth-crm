-- A task's fields, patched the same way a workflow's are: key presence in
-- p_patch decides. Absent leaves the column exactly as it is; present-but-empty
-- clears it; present with a value sets it.
--
-- Not four parameters defaulting to null, for the reason update_person taught
-- this schema: null cannot mean both "leave alone" and "clear", and whichever
-- meaning is chosen the other becomes impossible to express. The web app's
-- panel submits only the fields its box carries, and the connector and psql
-- will send subsets of their own.
--
-- `subject` is deliberately NOT writable here. It is the task's name, rendered
-- as the panel's heading rather than as a field in the box, and renaming a task
-- is a different act from correcting its details. `status`, `priority` and
-- `completed_at` each have their own function, so no client can leave a
-- completion stamp on something that is no longer done.
create or replace function public.set_workflow_task_details(
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

  update public.workflow_tasks t
     set description          = case when p_patch ? 'description'
                                       then nullif(btrim(p_patch->>'description'), '')
                                       else t.description
                                  end,
         comment              = case when p_patch ? 'comment'
                                       then nullif(btrim(p_patch->>'comment'), '')
                                       else t.comment
                                  end,
         due_at               = case when p_patch ? 'due_at'
                                       then nullif(btrim(p_patch->>'due_at'), '')::date
                                       else t.due_at
                                  end,
         assigned_to_staff_id = case when p_patch ? 'assigned_to_staff_id'
                                       then nullif(btrim(p_patch->>'assigned_to_staff_id'), '')::uuid
                                       else t.assigned_to_staff_id
                                  end
   where t.id = p_id;

  -- A task is visible exactly when its workflow is, by policies that defer to
  -- the parent's. So "not found" covers both "no such task" and "not yours",
  -- and answers as one thing rather than telling a caller which.
  if not found then
    raise exception 'No such task, or not within your access';
  end if;
end $fn$;

comment on function public.set_workflow_task_details(uuid, jsonb) is
  'Patch a task''s assignee, due date, description and comment. Key presence in p_patch decides: absent leaves the column, present-but-empty clears it. Subject, status and priority are not writable here.';

-- Load-bearing, never boilerplate: Postgres grants EXECUTE on every new
-- function to PUBLIC, and every role inherits from PUBLIC, so revoking from
-- anon alone would leave it callable by anyone.
revoke all on function public.set_workflow_task_details(uuid, jsonb) from public, anon;
grant execute on function public.set_workflow_task_details(uuid, jsonb) to authenticated;
