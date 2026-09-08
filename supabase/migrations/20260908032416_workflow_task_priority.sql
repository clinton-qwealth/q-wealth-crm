-- A task carries a priority (8 Sep 2026)
--
-- The SAME enum as a workflow's, deliberately: low / medium / high / urgent
-- mean the same thing about a task as they do about the piece of work it
-- belongs to, and a second enum with the same four values would be two
-- vocabularies to keep in step for no gain. It also means the glyph, its
-- colours and its contrast floor are already decided and already tested.
--
-- Defaults to 'medium', for the reason recorded for workflows: a task nobody
-- has prioritised is unremarkable, not low, and defaulting to the lowest level
-- would make "nobody has looked at this" indistinguishable from "this is
-- genuinely low priority".
alter table public.workflow_tasks
  add column priority public.workflow_priority not null default 'medium';

comment on column public.workflow_tasks.priority is
  'How urgent the task is. Same enum as workflows.priority — the words mean the same thing. Defaults to medium: unprioritised is unremarkable, not low.';

-- Appended, which is the only way create-or-replace can add a view column.
create or replace view public.workflow_tasks_summary
with (security_invoker = true) as
select
  t.id,
  t.workflow_id,
  t.task_type,
  t.subject,
  t.description,
  t.comment,
  t.due_at,
  t.status,
  t.assigned_to_staff_id,
  sd.full_name as assigned_to_name,
  t.completed_at,
  t.created_at,
  t.updated_at,
  t.priority
from public.workflow_tasks t
left join public.staff_directory sd on sd.id = t.assigned_to_staff_id;

-- The convention adopted 7 Sep: a replaced view keeps its grants, but this is
-- the moment the object is touched, so it is the moment to re-assert them.
revoke all on public.workflow_tasks_summary from anon, public;
revoke insert, update, delete, truncate, references, trigger on public.workflow_tasks_summary from authenticated;
grant select on public.workflow_tasks_summary to authenticated;

-- ---------------------------------------------------------------------------
-- The create function gains a priority, and the old signature is DROPPED
-- ---------------------------------------------------------------------------
-- Not left in place alongside the new one. `create or replace` with a different
-- number of parameters creates an OVERLOAD rather than replacing anything, and
-- the lesson from set_preferred_address() is that an overload is worse than a
-- breaking change: every existing five-argument call still resolves, silently,
-- to the version that cannot set a priority. There is one caller, and it is
-- changed in the same commit.
drop function public.create_workflow_task(uuid, text, text, date, uuid);

create function public.create_workflow_task(
  p_workflow_id          uuid,
  p_subject              text,
  p_description          text default null,
  p_due_at               date default null,
  p_assigned_to_staff_id uuid default null,
  p_priority             public.workflow_priority default 'medium'
) returns uuid
language plpgsql
security invoker
set search_path to ''
as $fn$
declare
  v_staff uuid := public.current_staff_id();
  v_id    uuid;
begin
  if v_staff is null then
    raise exception 'Not an active staff member';
  end if;
  if p_workflow_id is null then
    raise exception 'A task belongs to a workflow';
  end if;
  if length(trim(coalesce(p_subject, ''))) = 0 then
    raise exception 'Give the task a subject';
  end if;

  insert into public.workflow_tasks
    (workflow_id, subject, description, due_at, assigned_to_staff_id, priority,
     created_by_staff_id)
  values
    (p_workflow_id, trim(p_subject), nullif(btrim(p_description), ''), p_due_at,
     p_assigned_to_staff_id, coalesce(p_priority, 'medium'), v_staff)
  returning id into v_id;

  return v_id;
end $fn$;

comment on function public.create_workflow_task(uuid, text, text, date, uuid, public.workflow_priority) is
  'Add a task to a workflow. Trims the subject, nullifies a blank description, defaults priority to medium.';

-- Load-bearing, never boilerplate: Postgres grants EXECUTE on every new
-- function to PUBLIC, and every role inherits from PUBLIC.
revoke all on function public.create_workflow_task(uuid, text, text, date, uuid, public.workflow_priority)
  from public, anon;
grant execute on function public.create_workflow_task(uuid, text, text, date, uuid, public.workflow_priority)
  to authenticated;

-- ---------------------------------------------------------------------------
-- Setting a priority after the fact
-- ---------------------------------------------------------------------------
-- Its own function, mirroring set_workflow_priority() for a workflow: the
-- grant story is one line, and any rule that arrives later has one place to
-- live.
create or replace function public.set_workflow_task_priority(
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

  update public.workflow_tasks set priority = p_priority where id = p_id;

  if not found then
    raise exception 'No such task, or not within your access';
  end if;
end $fn$;

revoke all on function public.set_workflow_task_priority(uuid, public.workflow_priority) from public, anon;
grant execute on function public.set_workflow_task_priority(uuid, public.workflow_priority) to authenticated;
