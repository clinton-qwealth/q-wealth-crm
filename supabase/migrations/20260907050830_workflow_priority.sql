-- Workflow priority (7 Sep 2026)
--
-- Four levels, Jira-shaped: low, medium, high, urgent. Medium is the default
-- because it is the honest one — a workflow nobody has prioritised is not "low",
-- it is unremarkable, and defaulting to low would make genuinely low-priority
-- work indistinguishable from work nobody has looked at.
create type public.workflow_priority as enum ('low', 'medium', 'high', 'urgent');

alter table public.workflows
  add column priority public.workflow_priority not null default 'medium';

comment on column public.workflows.priority is
  'Low, medium, high or urgent. Defaults to medium: unprioritised work is unremarkable, not low.';

-- ---------------------------------------------------------------------------
-- Setting it
-- ---------------------------------------------------------------------------
-- A function rather than a bare UPDATE, for the same reason as every other
-- write: the grant story is then one line, and any rule that arrives later
-- (who may raise something to urgent, say) has one place to live.
create or replace function public.set_workflow_priority(
  p_id       uuid,
  p_priority public.workflow_priority
) returns void
language plpgsql
security invoker
set search_path to ''
as $fn$
begin
  if public.current_staff_id() is null then
    raise exception 'Not an active staff member';
  end if;

  update public.workflows set priority = p_priority where id = p_id;

  if not found then
    raise exception 'No such workflow, or not within your access';
  end if;
end $fn$;

revoke all on function public.set_workflow_priority(uuid, public.workflow_priority) from public, anon;
grant execute on function public.set_workflow_priority(uuid, public.workflow_priority) to authenticated;

-- ---------------------------------------------------------------------------
-- The board learns it
-- ---------------------------------------------------------------------------
-- A view's column can be appended with create-or-replace; only removing or
-- reordering would need a drop. Grants on the view are unchanged by replacing
-- it, and are re-stated anyway so this file is complete on its own.
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
  w.updated_at,
  w.priority
from public.workflows w
join public.client_groups g on g.id = w.group_id
left join public.staff_directory sd on sd.id = w.owner_staff_id;

revoke all on public.workflow_board from anon, public;
grant select on public.workflow_board to authenticated;
