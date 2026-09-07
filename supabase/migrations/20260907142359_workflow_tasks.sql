-- Tasks under a workflow (7 Sep 2026)
--
-- A task is one thing to be done as part of a workflow: "collect the signed
-- authority", "lodge the claim with the insurer". It is a CHILD of the workflow
-- — it cannot exist without one and goes with it — which is what the foreign
-- key and the policies below say. Tasks will eventually be generated from a
-- workflow template; for now they are added by hand from the workflow's page.
--
-- Named workflow_tasks, not tasks, following client_group_members,
-- insurance_policy_covers and financial_account_valuations: a child table is
-- prefixed with its parent so the dependency reads from the name.

-- How a task is completed. There is one kind today — a checkbox, i.e. a
-- boolean selection: done or not done. Other kinds (a value to enter, a
-- document to attach) are expected once templates exist, and will be added as
-- values. An enum with one value rather than nothing, so the column and its
-- meaning are in place before the second kind arrives.
create type public.task_type as enum ('checkbox');

create type public.task_status as enum ('open', 'done', 'cancelled');

create table public.workflow_tasks (
  id uuid primary key default gen_random_uuid(),
  workflow_id uuid not null references public.workflows(id) on delete cascade,
  task_type public.task_type not null default 'checkbox',
  subject text not null,
  description text,
  comment text,
  -- A calendar day, like workflows.due_at, and for the same reason: a due date
  -- is a day, not a moment, and must never go through new Date() on the way to
  -- a screen. See the Data Model page.
  due_at date,
  status public.task_status not null default 'open',
  assigned_to_staff_id uuid references public.staff_users(id),
  completed_at timestamptz,
  created_by_staff_id uuid references public.staff_users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- The subject is what a person reads in the list. Same rule as a workflow's
  -- name: enforced here, because the form is not the only caller.
  constraint workflow_tasks_subject_not_blank check (length(trim(subject)) > 0),
  -- Only a finished task has a finish time.
  constraint workflow_tasks_completed_when_done
    check (completed_at is null or status = 'done')
);

create index workflow_tasks_workflow_idx on public.workflow_tasks (workflow_id, created_at);
create index workflow_tasks_open_by_assignee_idx on public.workflow_tasks (assigned_to_staff_id)
  where status = 'open';

create trigger trg_workflow_tasks_updated_at
  before update on public.workflow_tasks
  for each row execute function public.set_updated_at();

comment on table public.workflow_tasks is
  'One thing to be done as part of a workflow. A child of workflows: visible exactly when its workflow is. Added by hand today; to be generated from templates.';
comment on column public.workflow_tasks.task_type is
  'How the task is completed. checkbox = a boolean selection, done or not done. The only kind so far.';
comment on column public.workflow_tasks.status is
  'open until done. cancelled for a task that turned out not to apply — a task is cancelled, not erased, like a workflow.';
comment on column public.workflow_tasks.due_at is
  'A calendar date, not a timestamptz. Read it by splitting the string, never through new Date().';
comment on column public.workflow_tasks.comment is
  'What the person doing the task had to say about it. Distinct from description, which is what the task is.';
comment on column public.workflow_tasks.assigned_to_staff_id is
  'Who owns the task. Nullable: a generated task is unassigned until somebody takes it.';

-- ---------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------
-- A task is visible exactly when its workflow is, and for the same people. The
-- subquery against workflows runs under the WORKFLOWS policies for the caller,
-- so these policies add no rule of their own and cannot drift from the parent's:
-- change who can see a workflow and who can see its tasks changes with it.
alter table public.workflow_tasks enable row level security;

create policy workflow_tasks_select on public.workflow_tasks
  for select to authenticated
  using (exists (select 1 from public.workflows w where w.id = workflow_tasks.workflow_id));

create policy workflow_tasks_insert on public.workflow_tasks
  for insert to authenticated
  with check (
    public.is_active_staff()
    and exists (select 1 from public.workflows w where w.id = workflow_tasks.workflow_id)
    and created_by_staff_id = public.current_staff_id()
  );

create policy workflow_tasks_update on public.workflow_tasks
  for update to authenticated
  using (exists (select 1 from public.workflows w where w.id = workflow_tasks.workflow_id))
  with check (exists (select 1 from public.workflows w where w.id = workflow_tasks.workflow_id));

-- No delete policy. A task that did not apply is cancelled, not erased —
-- the same treatment as a workflow.

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
-- Supabase's default privileges hand every new table in full to anon,
-- authenticated and service_role. anon holds nothing; authenticated holds only
-- what a policy above justifies. The revoke on authenticated is the convention
-- adopted on 7 Sep after two views were found still carrying the defaults.
revoke all on public.workflow_tasks from anon, public;
revoke delete, truncate, references, trigger on public.workflow_tasks from authenticated;
grant select, insert, update on public.workflow_tasks to authenticated;

-- The parent was created on 6 Sep, after the 3 Sep privilege audit, and was
-- found on 7 Sep still holding DELETE, REFERENCES, TRIGGER and TRUNCATE for
-- authenticated with no policy behind any of them. The only table in the
-- schema out of line; tightened here with its child.
revoke delete, truncate, references, trigger on public.workflows from authenticated;

-- ---------------------------------------------------------------------------
-- The list the page reads
-- ---------------------------------------------------------------------------
-- The assignee's name comes from staff_directory, which every active staff
-- member can read, so a task can name its owner even when that owner's
-- staff_users row is not readable to the caller — the same reason the board
-- view does it this way.
create view public.workflow_tasks_summary
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
  t.updated_at
from public.workflow_tasks t
left join public.staff_directory sd on sd.id = t.assigned_to_staff_id;

comment on view public.workflow_tasks_summary is
  'A workflow''s tasks with the assignee named. security_invoker: RLS on workflow_tasks — and through it on workflows — decides.';

revoke all on public.workflow_tasks_summary from anon, public;
revoke insert, update, delete, truncate, references, trigger on public.workflow_tasks_summary from authenticated;
grant select on public.workflow_tasks_summary to authenticated;

-- ---------------------------------------------------------------------------
-- Write paths
-- ---------------------------------------------------------------------------
-- Functions rather than bare inserts, as everywhere else here: the grant story
-- is one line, and any rule that arrives later has one place to live.

create or replace function public.create_workflow_task(
  p_workflow_id          uuid,
  p_subject              text,
  p_description          text default null,
  p_due_at               date default null,
  p_assigned_to_staff_id uuid default null
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
    (workflow_id, subject, description, due_at, assigned_to_staff_id, created_by_staff_id)
  values
    (p_workflow_id, trim(p_subject), nullif(btrim(p_description), ''), p_due_at,
     p_assigned_to_staff_id, v_staff)
  returning id into v_id;

  return v_id;
end $fn$;

revoke all on function public.create_workflow_task(uuid, text, text, date, uuid) from public, anon;
grant execute on function public.create_workflow_task(uuid, text, text, date, uuid) to authenticated;

-- Ticking the box. completed_at is set by the function that sets the status,
-- never by the caller — the rule set_workflow_status() established.
create or replace function public.set_workflow_task_status(
  p_id     uuid,
  p_status public.task_status
) returns void
language plpgsql
security invoker
set search_path to ''
as $fn$
begin
  if public.current_staff_id() is null then
    raise exception 'Not an active staff member';
  end if;

  update public.workflow_tasks
     set status       = p_status,
         completed_at = case
                          when p_status = 'done' then coalesce(completed_at, now())
                          else null
                        end
   where id = p_id;

  if not found then
    raise exception 'No such task, or not within your access';
  end if;
end $fn$;

revoke all on function public.set_workflow_task_status(uuid, public.task_status) from public, anon;
grant execute on function public.set_workflow_task_status(uuid, public.task_status) to authenticated;
