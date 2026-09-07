-- The workflow board: moving a card, and the view behind the lanes (7 Sep 2026)

-- The partial index covering open work learns the new stage. Recreated rather
-- than altered: a partial index predicate cannot be changed in place.
drop index if exists public.workflows_open_idx;
create index workflows_open_idx on public.workflows (group_id, status)
  where status in ('not_started', 'in_progress', 'blocked', 'under_review');

-- ---------------------------------------------------------------------------
-- Moving a workflow between lanes
-- ---------------------------------------------------------------------------
-- The lane IS the status, so a drop is a status change. But two timestamps
-- describe the status and must stay truthful with it:
--
--   started_at    null while not started; set the first time work moves past
--                 that, kept thereafter — except that moving BACK to
--                 not_started clears it, because "not started" with a start
--                 date is a contradiction the check constraints would not catch.
--   completed_at  set on arrival in complete, cleared on leaving it. The table
--                 constraint already refuses a completed_at on any other status,
--                 so without the clearing here, moving a finished workflow back
--                 would be impossible rather than merely wrong.
create or replace function public.set_workflow_status(
  p_id     uuid,
  p_status public.workflow_status
) returns void
language plpgsql
security invoker
set search_path to ''
as $fn$
begin
  if public.current_staff_id() is null then
    raise exception 'Not an active staff member';
  end if;

  update public.workflows
     set status       = p_status,
         started_at   = case
                          when p_status = 'not_started' then null
                          else coalesce(started_at, now())
                        end,
         completed_at = case
                          when p_status = 'complete' then coalesce(completed_at, now())
                          else null
                        end
   where id = p_id;

  if not found then
    raise exception 'No such workflow, or not within your access';
  end if;
end $fn$;

revoke all on function public.set_workflow_status(uuid, public.workflow_status) from public, anon;
grant execute on function public.set_workflow_status(uuid, public.workflow_status) to authenticated;

comment on function public.set_workflow_status is
  'Move a workflow to a status, keeping started_at and completed_at truthful for the new state. Visibility and the right to move are RLS on workflows.';

-- ---------------------------------------------------------------------------
-- The board's view: every workflow with its group and owner named
-- ---------------------------------------------------------------------------
-- security_invoker, so RLS on workflows and client_groups decides what a caller
-- sees — an adviser gets the work for their groups and nobody else's. The
-- owner's name comes from staff_directory, which every active staff member can
-- read, so a card can name its owner even when that owner's staff_users row is
-- not readable to the caller.
create or replace view public.workflow_board
with (security_invoker = true) as
select
  w.id,
  w.group_id,
  g.name          as group_name,
  w.workflow_type,
  w.name,
  w.status,
  w.owner_staff_id,
  sd.full_name    as owner_name,
  w.started_at,
  w.completed_at,
  w.created_at,
  w.updated_at
from public.workflows w
join public.client_groups g on g.id = w.group_id
left join public.staff_directory sd on sd.id = w.owner_staff_id;

comment on view public.workflow_board is
  'Workflows across all groups the caller can see, with group and owner named, for the Kanban board. security_invoker.';

-- Supabase default privileges grant every new object in public to anon.
revoke all on public.workflow_board from anon, public;
grant select on public.workflow_board to authenticated;
