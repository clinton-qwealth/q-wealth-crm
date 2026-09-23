-- A plan can be deployed into a workflow (23 Sep 2026)
--
-- The other half of the template feature: a general user picks a published
-- template, says who fills each role and when the plan starts, and real
-- workflow_tasks appear carrying the template's dependencies.
--
-- NO manage_staff HERE. Administrators write templates; anybody who can see a
-- workflow deploys one into it. Every function below is SECURITY INVOKER and
-- the existing workflow_tasks insert policy — active staff, a visible workflow,
-- created_by_staff_id = current_staff_id() — is what decides.
--
-- ---------------------------------------------------------------------------
-- A BUG THIS FEATURE WOULD OTHERWISE HAVE WALKED INTO
-- ---------------------------------------------------------------------------
-- lib/workflows.ts orders tasks `due_at asc nulls last, created_at asc`, and
-- its comment says the tie-break exists so that "tasks sharing a due date —
-- which template-generated tasks will — keep the order they were made in".
--
-- THEY WOULD NOT. now() is the TRANSACTION timestamp, so every task the deploy
-- statement below inserts carries the identical created_at and the tie-break is
-- a no-op. Add to that the decision that a dependent task has no due date until
-- its prerequisite is done, and a ten-task plan would have rendered in whatever
-- order the heap returned.
--
-- Hence `plan_position`, copied onto the task at deploy. Deriving it through a
-- join back to the template was the alternative; copying wins on this schema's
-- own "as it stood" principle, and it means editing a template can never
-- silently reshuffle a workflow deployed from it last month.

-- ---------------------------------------------------------------------------
-- 1. What a real task waits for
-- ---------------------------------------------------------------------------

create table public.workflow_task_dependencies (
  -- Denormalised so both foreign keys can travel through it: a dependency
  -- between two DIFFERENT workflows has no parent row to point at. The unique
  -- key it uses, workflow_tasks (id, workflow_id), has existed since 8 Sep.
  workflow_id         uuid not null,
  task_id             uuid not null,
  depends_on_task_id  uuid not null,
  deployment_id       uuid,
  created_by_staff_id uuid references public.staff_users(id),
  created_at          timestamptz not null default now(),
  primary key (task_id, depends_on_task_id),
  constraint workflow_task_dependencies_not_self check (task_id <> depends_on_task_id),
  constraint workflow_task_dependencies_task_fk
    foreign key (task_id, workflow_id)
    references public.workflow_tasks (id, workflow_id) on delete cascade,
  constraint workflow_task_dependencies_prereq_fk
    foreign key (depends_on_task_id, workflow_id)
    references public.workflow_tasks (id, workflow_id) on delete cascade
);

-- "Who is waiting for me" — what the propagation below reads. The primary key
-- already answers "what am I waiting for", which is the blocked test.
create index workflow_task_dependencies_prereq_idx
  on public.workflow_task_dependencies (depends_on_task_id);
create index workflow_task_dependencies_workflow_idx
  on public.workflow_task_dependencies (workflow_id);

comment on table public.workflow_task_dependencies is
  'A real task waits for another real task in the same workflow. Copied from the template at deploy. No cycle check: the graph is a copy of an acyclic template graph, and nothing else writes here. A manual "add a dependency" screen would need one.';

-- ---------------------------------------------------------------------------
-- 2. The record of a deployment
-- ---------------------------------------------------------------------------

create table public.workflow_template_deployments (
  id                   uuid primary key default gen_random_uuid(),
  template_id          uuid not null references public.workflow_templates(id),
  workflow_id          uuid not null references public.workflows(id) on delete cascade,
  -- The template's name AS IT STOOD. Same reason workflow_task_actions keeps
  -- the recipient rather than resolving it live: renaming or archiving a
  -- template must not rewrite what this workflow was built from — and since a
  -- published template stays editable, that is not a remote possibility.
  template_name        text not null,
  start_date           date not null,
  task_count           integer not null check (task_count > 0),
  deployed_by_staff_id uuid not null references public.staff_users(id),
  deployed_at          timestamptz not null default now(),
  -- One template lands in one workflow once. Two DIFFERENT templates may
  -- coexist; plan_position keeps them in sequence rather than interleaved.
  constraint workflow_template_deployments_once unique (workflow_id, template_id)
);

create index workflow_template_deployments_workflow_idx
  on public.workflow_template_deployments (workflow_id, deployed_at desc);
create index workflow_template_deployments_template_idx
  on public.workflow_template_deployments (template_id, deployed_at desc);

comment on table public.workflow_template_deployments is
  'One deployment of a template into a workflow: which template, under what name at the time, from what start date, by whom. NOT AUDITED — an immutable record written by a user action and append-only by grant, like workflow_task_actions.';

create table public.workflow_template_deployment_roles (
  deployment_id uuid not null references public.workflow_template_deployments(id) on delete cascade,
  -- The name as it stood. Never null, and the key, so the record reads without
  -- the template still existing.
  role_name     text not null,
  role_id       uuid references public.workflow_template_roles(id) on delete set null,
  staff_id      uuid not null references public.staff_users(id),
  primary key (deployment_id, role_name)
);

comment on table public.workflow_template_deployment_roles is
  'Who each of a template''s roles became, at the moment of deployment. Keyed by the role NAME as it stood so the record outlives a rename or a removal; role_id is for joining while it lasts.';

alter table public.workflow_task_dependencies            enable row level security;
alter table public.workflow_template_deployments         enable row level security;
alter table public.workflow_template_deployment_roles    enable row level security;

-- All three derive the workflow's visibility, as workflow_tasks does.
create policy workflow_task_dependencies_select on public.workflow_task_dependencies
  for select to authenticated
  using (exists (select 1 from public.workflows w where w.id = workflow_task_dependencies.workflow_id));
create policy workflow_task_dependencies_insert on public.workflow_task_dependencies
  for insert to authenticated
  with check (public.is_active_staff()
              and exists (select 1 from public.workflows w where w.id = workflow_id));
-- No update policy: an edge exists or it does not. No delete policy either, and
-- that is a real gap stated rather than hidden — a wrongly deployed dependency
-- is permanent. The supported way to unblock is to CANCEL the prerequisite,
-- which the propagation below treats as settled. A delete here would be an
-- invitation to "unstick" tasks by removing their edges, which would quietly
-- undo the recorded-override property this whole design rests on.

create policy workflow_template_deployments_select on public.workflow_template_deployments
  for select to authenticated
  using (exists (select 1 from public.workflows w where w.id = workflow_template_deployments.workflow_id));
create policy workflow_template_deployments_insert on public.workflow_template_deployments
  for insert to authenticated
  with check (public.is_active_staff()
              and exists (select 1 from public.workflows w where w.id = workflow_id)
              and deployed_by_staff_id = public.current_staff_id());

create policy workflow_template_deployment_roles_select on public.workflow_template_deployment_roles
  for select to authenticated
  using (exists (select 1 from public.workflow_template_deployments d
                  where d.id = workflow_template_deployment_roles.deployment_id));
create policy workflow_template_deployment_roles_insert on public.workflow_template_deployment_roles
  for insert to authenticated
  with check (exists (select 1 from public.workflow_template_deployments d
                       where d.id = deployment_id));

revoke all on public.workflow_task_dependencies from public, anon, authenticated;
grant select, insert on public.workflow_task_dependencies to authenticated;

revoke all on public.workflow_template_deployments from public, anon, authenticated;
grant select, insert on public.workflow_template_deployments to authenticated;

revoke all on public.workflow_template_deployment_roles from public, anon, authenticated;
grant select, insert on public.workflow_template_deployment_roles to authenticated;

-- ---------------------------------------------------------------------------
-- 3. What a deployed task remembers
-- ---------------------------------------------------------------------------

alter table public.workflow_tasks
  add column template_task_id uuid references public.workflow_template_tasks(id) on delete set null,
  add column plan_position    integer,
  add column due_offset_days  integer
    constraint workflow_tasks_offset_sane
      check (due_offset_days is null or due_offset_days between 0 and 3650);

create index workflow_tasks_template_task_idx
  on public.workflow_tasks (template_task_id) where template_task_id is not null;
create index workflow_tasks_plan_position_idx
  on public.workflow_tasks (workflow_id, plan_position) where plan_position is not null;

comment on column public.workflow_tasks.template_task_id is
  'The template task this came from. Provenance, and the join the deploy statement uses to wire the dependency edges. `on delete set null`: removing a step from a draft template must never break an operational row.';
comment on column public.workflow_tasks.plan_position is
  'Where this task sits in the workflow''s plan, across every template deployed into it. Copied at deploy, never derived — see this migration''s header for the created_at trap it exists to avoid. Null for a task somebody typed in by hand, which sorts after the plan.';
comment on column public.workflow_tasks.due_offset_days is
  'Days after this task''s prerequisites settle, from the template. NULL means the task is not under the rule at all: either it was made by hand, or somebody has since typed a due date, which takes it out.';

-- The column list is appended to, never reordered: create or replace view
-- refuses anything else.
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
  public.staff_display_name(sd.first_name, sd.last_name) as assigned_to_name,
  t.completed_at,
  t.created_at,
  t.updated_at,
  t.priority,
  t.template_task_id,
  t.plan_position,
  t.due_offset_days,
  -- The edges, aggregated here so a screen reads them in the SAME round trip as
  -- the tasks. A separate loader for them is what would break the workflow
  -- page's single-wave depth test.
  coalesce(dep.depends_on, '{}'::uuid[])  as depends_on,
  coalesce(dep.blocked_by, '{}'::text[])  as blocked_by,
  coalesce(array_length(dep.blocked_by, 1), 0) > 0 as is_blocked,
  exists (select 1 from public.workflow_task_actions a
           where a.task_id = t.id and a.kind = 'completed_while_blocked') as completed_while_blocked
from public.workflow_tasks t
left join public.staff_directory sd on sd.id = t.assigned_to_staff_id
left join lateral (
  select array_agg(p.id order by p.plan_position nulls last, p.created_at)                    as depends_on,
         array_agg(p.subject order by p.plan_position nulls last, p.created_at)
           filter (where p.status = 'open')                                                    as blocked_by
    from public.workflow_task_dependencies e
    join public.workflow_tasks p on p.id = e.depends_on_task_id
   where e.task_id = t.id
) dep on true;

comment on view public.workflow_tasks_summary is
  'A workflow''s tasks with the assignee named, their place in the plan, and what they are waiting for. security_invoker: RLS on workflow_tasks — and through it on workflows — decides. blocked_by names only the prerequisites still OPEN, so an empty array means ready.';

revoke all on public.workflow_tasks_summary from anon, public;
revoke insert, update, delete, truncate, references, trigger on public.workflow_tasks_summary from authenticated;
grant select on public.workflow_tasks_summary to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Deploying
-- ---------------------------------------------------------------------------

create or replace function public.deploy_workflow_template(
  p_template_id uuid,
  p_workflow_id uuid,
  p_start_date  date  default null,
  -- {"<role id>": "<staff id>", ...}. A jsonb map rather than two parallel
  -- uuid[] arrays: the arrays can differ in length and their pairing is
  -- positional and invisible at the call site.
  p_role_staff  jsonb default '{}'::jsonb
) returns uuid
language plpgsql
security invoker
set search_path to ''
as $fn$
declare
  v_staff      uuid := public.current_staff_id();
  v_status     public.workflow_template_status;
  v_name       text;
  v_tasks      integer;
  v_start      date;
  v_base       integer;
  v_deployment uuid;
  v_missing    text;
  v_unknown    text;
  v_inactive   uuid;
begin
  if v_staff is null then
    raise exception 'Not an active staff member';
  end if;

  select t.status, t.name into v_status, v_name
    from public.workflow_templates t where t.id = p_template_id;
  if v_status is null then
    raise exception 'No such template';
  end if;
  if v_status <> 'published' then
    raise exception 'Only a published template can be deployed';
  end if;

  -- Read under the caller's own policies, so this covers "does not exist" and
  -- "not yours" as one answer.
  if not exists (select 1 from public.workflows w where w.id = p_workflow_id) then
    raise exception 'No such workflow, or not within your access';
  end if;

  select count(*) into v_tasks
    from public.workflow_template_tasks where template_id = p_template_id;
  if v_tasks = 0 then
    raise exception 'This template has no tasks';
  end if;

  -- Every role a TASK USES needs a person. A role nobody uses is authoring
  -- debris and is not asked for.
  select r.name into v_missing
    from public.workflow_template_roles r
   where r.template_id = p_template_id
     and exists (select 1 from public.workflow_template_tasks t where t.role_id = r.id)
     and nullif(btrim(coalesce(p_role_staff->>r.id::text, '')), '') is null
   limit 1;
  if v_missing is not null then
    raise exception 'Every role needs a person: % has none', v_missing;
  end if;

  select k into v_unknown
    from jsonb_object_keys(p_role_staff) k
   where not exists (select 1 from public.workflow_template_roles r
                      where r.template_id = p_template_id and r.id::text = k)
   limit 1;
  if v_unknown is not null then
    raise exception 'That template has no such role';
  end if;

  -- staff_directory, NOT staff_users: the base table is not readable by a
  -- general user, so validating against it would find no rows and pass
  -- everything, which is the opposite of a check.
  select value::uuid into v_inactive
    from jsonb_each_text(p_role_staff)
   where not exists (select 1 from public.staff_directory sd
                      where sd.id = value::uuid and sd.status = 'active')
   limit 1;
  if v_inactive is not null then
    raise exception 'One of those people is not an active staff member';
  end if;

  -- Sydney, not the session's UTC: a plan started "today" at 9am Sydney is
  -- still yesterday in UTC, and every root task would be dated a day early.
  v_start := coalesce(p_start_date, (now() at time zone 'Australia/Sydney')::date);

  -- A second template deployed later continues the sequence rather than
  -- interleaving from zero.
  select coalesce(max(plan_position), -1) + 1 into v_base
    from public.workflow_tasks where workflow_id = p_workflow_id;

  insert into public.workflow_template_deployments
    (template_id, workflow_id, template_name, start_date, task_count, deployed_by_staff_id)
  values (p_template_id, p_workflow_id, v_name, v_start, v_tasks, v_staff)
  returning id into v_deployment;

  insert into public.workflow_template_deployment_roles (deployment_id, role_name, role_id, staff_id)
  select v_deployment, r.name, r.id, (p_role_staff->>r.id::text)::uuid
    from public.workflow_template_roles r
   where r.template_id = p_template_id
     and nullif(btrim(coalesce(p_role_staff->>r.id::text, '')), '') is not null;

  -- THE ID MAP, AND WHY THERE IS NO LOOP. The tasks are inserted with their
  -- template_task_id, and RETURNING hands back the real generated id beside it;
  -- the edge insert then joins that result to itself twice. `created` is a
  -- data-modifying CTE referenced twice, so both joins see the same rows. No
  -- temp table, no loop, and no assumption about the order anything came back in.
  with created as (
    insert into public.workflow_tasks
      (workflow_id, subject, description, status, priority, task_type,
       due_at, assigned_to_staff_id, created_by_staff_id,
       template_task_id, plan_position, due_offset_days)
    select
      p_workflow_id,
      tt.subject,
      tt.description,
      'open'::public.task_status,
      tt.priority,
      tt.task_type,
      -- ONLY a task that waits for nothing gets a date now. Everything else
      -- gets one when the thing it waits for is done. A full waterfall from the
      -- start date is what this looks like it should do and is not what was asked for.
      case when not exists (select 1 from public.workflow_template_task_dependencies d
                             where d.task_id = tt.id)
           then v_start + tt.due_offset_days end,
      (p_role_staff->>tt.role_id::text)::uuid,
      v_staff,
      tt.id,
      v_base + tt.ordinal,
      tt.due_offset_days
    from public.workflow_template_tasks tt
    where tt.template_id = p_template_id
    returning id, template_task_id
  )
  insert into public.workflow_task_dependencies
    (workflow_id, task_id, depends_on_task_id, deployment_id, created_by_staff_id)
  select p_workflow_id, c.id, p.id, v_deployment, v_staff
    from public.workflow_template_task_dependencies d
    join created c on c.template_task_id = d.task_id
    join created p on p.template_task_id = d.depends_on_task_id
   where d.template_id = p_template_id;

  return v_deployment;
exception when unique_violation then
  raise exception 'This template has already been deployed into this workflow';
end $fn$;

comment on function public.deploy_workflow_template(uuid, uuid, date, jsonb) is
  'Creates a workflow''s tasks from a published template, assigning each role''s tasks to the person named in p_role_staff and dating only the tasks that wait for nothing. SECURITY INVOKER: no manage_staff, the workflow''s own insert policy decides. Returns the deployment id.';

revoke all on function public.deploy_workflow_template(uuid, uuid, date, jsonb) from public, anon;
grant execute on function public.deploy_workflow_template(uuid, uuid, date, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. What happens when a task's status changes
-- ---------------------------------------------------------------------------
-- A TRIGGER, NOT set_workflow_task_status(). workflow_tasks grants UPDATE to
-- authenticated and its policy admits anyone who can see the workflow, so a
-- direct PostgREST write of `status` is a supported path today and satisfies
-- every constraint. Putting this in the RPC would mean the due date silently
-- fails to appear the first time anybody writes status any other way — a bulk
-- complete, a data fix, the MCP connector. The house rule says it plainly: the
-- policy says WHO, the trigger says WHAT.
--
-- It cannot recurse: it fires on `update of status` and writes only due_at.

create or replace function public.on_workflow_task_status_changed()
returns trigger
language plpgsql
security definer
set search_path to ''
as $fn$
declare
  v_actor    uuid := public.current_staff_id();
  v_blocking text[];
begin
  -- TWO PEOPLE, ONE TASK, AND A DATE THAT NEVER ARRIVES. Under READ COMMITTED,
  -- two transactions completing two prerequisites of the same task each see the
  -- other's as still open, so neither satisfies the "all settled" test and the
  -- dependent gets no due date — ever, silently, and only when the firm is
  -- busy. The lock is per WORKFLOW, so it serialises the handful of people
  -- looking at one piece of work and nobody else.
  perform pg_catalog.pg_advisory_xact_lock(
            pg_catalog.hashtextextended(new.workflow_id::text, 0));

  -- 1. The override record, in the same transaction as the completion, which is
  --    what makes a blocked completion impossible WITHOUT its record.
  if new.status = 'done' and old.status <> 'done' then
    select array_agg(p.subject order by p.plan_position nulls last, p.subject)
      into v_blocking
      from public.workflow_task_dependencies e
      join public.workflow_tasks p on p.id = e.depends_on_task_id
     where e.task_id = new.id and p.status = 'open';

    if v_blocking is not null then
      -- actor_staff_id is NOT NULL on workflow_task_actions. A completion from
      -- an elevated context — the dashboard, a data fix, service_role — has
      -- nobody to name, and an unguarded insert would fail THE COMPLETION
      -- ITSELF on a null violation from a trigger nobody expected.
      if v_actor is not null then
        insert into public.workflow_task_actions
               (workflow_id, task_id, kind, actor_staff_id, subject, body)
        values (new.workflow_id, new.id, 'completed_while_blocked', v_actor,
                'Completed before its prerequisites',
                jsonb_build_object(
                  'type', 'doc',
                  'content', jsonb_build_array(jsonb_build_object(
                    'type', 'paragraph',
                    'content', jsonb_build_array(jsonb_build_object(
                      'type', 'text',
                      'text', 'Still open at the time: ' ||
                              array_to_string(v_blocking, '; ')))))));
      elsif not public.is_elevated_context() then
        raise exception 'Not an active staff member';
      end if;
    end if;
  end if;

  -- 2. Forward: anything waiting on this task whose prerequisites are now ALL
  --    settled gets (the last settlement) + its own offset.
  --
  --    SETTLED MEANS DONE OR CANCELLED. A cancelled prerequisite must not hold
  --    its dependents hostage for ever; that is the commonest way a checklist
  --    quietly dies.
  --
  --    The cast is Australia/Sydney, not a bare ::date. PostgREST runs in UTC,
  --    so a task ticked at 9am Sydney is 23:00 the previous day and every
  --    propagated due date would land a day early, every day, unnoticed.
  if new.status in ('done', 'cancelled') and old.status = 'open' then
    update public.workflow_tasks d
       set due_at = (
             select max((coalesce(p.completed_at, p.updated_at) at time zone 'Australia/Sydney')::date)
               from public.workflow_task_dependencies e2
               join public.workflow_tasks p on p.id = e2.depends_on_task_id
              where e2.task_id = d.id
           ) + d.due_offset_days
     where d.status = 'open'
       and d.due_at is null
       and d.due_offset_days is not null
       and exists (select 1 from public.workflow_task_dependencies e
                    where e.task_id = d.id and e.depends_on_task_id = new.id)
       and not exists (select 1 from public.workflow_task_dependencies e
                         join public.workflow_tasks p on p.id = e.depends_on_task_id
                        where e.task_id = d.id and p.status = 'open');
  end if;

  -- 3. Reopening clears the date on DIRECT dependents only, and that is not a
  --    shortcut. A task further down the chain only ever received a date
  --    because its OWN prerequisites were all settled, and reopening this one
  --    changed none of those; clearing transitively would blank dates that are
  --    still correct.
  if new.status = 'open' and old.status in ('done', 'cancelled') then
    update public.workflow_tasks d
       set due_at = null
     where d.status = 'open'
       and d.due_offset_days is not null
       and exists (select 1 from public.workflow_task_dependencies e
                    where e.task_id = d.id and e.depends_on_task_id = new.id);
  end if;

  return null;
end $fn$;

comment on function public.on_workflow_task_status_changed() is
  'Records a blocked completion and moves due dates along the plan. SECURITY DEFINER, which widens nothing: both dependency foreign keys resolve through one workflow_id, so every row this can reach is in the workflow the caller just wrote to.';

create trigger trg_workflow_tasks_status_changed
  after update of status on public.workflow_tasks
  for each row
  when (old.status is distinct from new.status)
  execute function public.on_workflow_task_status_changed();

revoke all on function public.on_workflow_task_status_changed() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 6. A typed due date takes a task out of the rule
-- ---------------------------------------------------------------------------
-- Restated whole, as the house does. One arm differs: writing due_at by hand
-- clears due_offset_days, so the propagation above stops moving it. Clearing
-- the date does NOT put the task back under the rule — the offset is gone, and
-- guessing it back from the template would be guessing.

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
         -- A due date somebody typed is not a due date this schema may move.
         due_offset_days      = case when p_patch ? 'due_at'
                                       and nullif(btrim(p_patch->>'due_at'), '') is not null
                                       then null
                                       else t.due_offset_days
                                  end,
         assigned_to_staff_id = case when p_patch ? 'assigned_to_staff_id'
                                       then nullif(btrim(p_patch->>'assigned_to_staff_id'), '')::uuid
                                       else t.assigned_to_staff_id
                                  end
   where t.id = p_id;

  if not found then
    raise exception 'No such task, or not within your access';
  end if;
end $fn$;

comment on function public.set_workflow_task_details(uuid, jsonb) is
  'Patch a task''s assignee, due date, description and comment. Key presence in p_patch decides: absent leaves the column, present-but-empty clears it. Subject, status and priority are not writable here. Typing a due date takes the task out of the template''s offset rule.';

revoke all on function public.set_workflow_task_details(uuid, jsonb) from public, anon;
grant execute on function public.set_workflow_task_details(uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- 7. Prove it, or abort
-- ---------------------------------------------------------------------------
-- STRUCTURE ONLY, deliberately. A behavioural fixture here would need a
-- client_group and a workflow to hang the tasks off, and both are audited — so
-- proving the propagation would leave "__probe__ household created, then
-- deleted" on the Administration screen the firm actually reads. The behaviour
-- is proved instead by a rolled-back `do` block run against this database
-- immediately after, which is how the knowledge-base migration was probed.
do $$
begin
  -- Both endpoints of an edge travel through one workflow_id, so a dependency
  -- between two workflows has no parent row to point at. Without these the
  -- foreign keys were not created and that guarantee is gone.
  if not exists (select 1 from pg_constraint where conname = 'workflow_task_dependencies_task_fk')
     or not exists (select 1 from pg_constraint where conname = 'workflow_task_dependencies_prereq_fk') then
    raise exception 'A dependency could span two workflows';
  end if;

  -- The trigger, and its WHEN clause: without the clause it fires on every
  -- update of every task and takes an advisory lock for nothing.
  if not exists (select 1 from pg_trigger
                  where tgname = 'trg_workflow_tasks_status_changed' and not tgisinternal) then
    raise exception 'A task status change propagates nothing';
  end if;
  if (select pg_get_triggerdef(oid) from pg_trigger where tgname = 'trg_workflow_tasks_status_changed')
       not like '%old.status IS DISTINCT FROM new.status%' then
    raise exception 'The propagation trigger has lost its WHEN clause and now fires on every update';
  end if;

  -- The three things a deployed task remembers.
  if (select count(*) from information_schema.columns
       where table_schema = 'public' and table_name = 'workflow_tasks'
         and column_name in ('template_task_id', 'plan_position', 'due_offset_days')) <> 3 then
    raise exception 'A deployed task cannot remember where it came from or where it sits';
  end if;

  -- The view carries the edges, which is what keeps the workflow page at one
  -- round trip. A separate loader for them is the change this asserts against.
  if (select count(*) from information_schema.columns
       where table_schema = 'public' and table_name = 'workflow_tasks_summary'
         and column_name in ('depends_on', 'blocked_by', 'is_blocked', 'plan_position',
                             'completed_while_blocked')) <> 5 then
    raise exception 'workflow_tasks_summary does not carry the plan, so a screen would need a second query';
  end if;

  -- Privilege.
  if has_table_privilege('anon', 'public.workflow_task_dependencies', 'select')
     or has_table_privilege('anon', 'public.workflow_template_deployments', 'select') then
    raise exception 'anon must hold nothing here';
  end if;
  if has_table_privilege('authenticated', 'public.workflow_template_deployments', 'update')
     or has_table_privilege('authenticated', 'public.workflow_template_deployments', 'delete')
     or has_table_privilege('authenticated', 'public.workflow_task_dependencies', 'update')
     or has_table_privilege('authenticated', 'public.workflow_task_dependencies', 'delete') then
    raise exception 'A deployment and its edges are a record: no update and no delete';
  end if;
  if exists (select 1 from pg_policies where schemaname = 'public'
              and tablename in ('workflow_task_dependencies', 'workflow_template_deployments',
                                'workflow_template_deployment_roles')
              and cmd in ('UPDATE', 'DELETE', 'ALL')) then
    raise exception 'No update or delete policy belongs on a deployment record';
  end if;

  -- Deploying is SECURITY INVOKER: a general user deploys, and RLS decides.
  if (select prosecdef from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = 'deploy_workflow_template') then
    raise exception 'deploy_workflow_template is SECURITY DEFINER; it would bypass row-level security';
  end if;
  if not has_function_privilege('authenticated',
        'public.deploy_workflow_template(uuid, uuid, date, jsonb)', 'EXECUTE') then
    raise exception 'A general user cannot deploy a template';
  end if;

  -- These three are the ones a later edit is most likely to drop, and each is
  -- silent when it goes: an early due date every day, a hostage checklist, and
  -- a completion that fails from a data fix.
  if (select prosrc from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = 'on_workflow_task_status_changed')
       not like '%Australia/Sydney%' then
    raise exception 'The propagation casts in UTC, so every due date lands a day early';
  end if;
  if (select prosrc from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = 'on_workflow_task_status_changed')
       not like '%pg_advisory_xact_lock%' then
    raise exception 'Two people settling two prerequisites at once would leave the dependent with no date';
  end if;
  if (select prosrc from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = 'on_workflow_task_status_changed')
       not like '%is_elevated_context%' then
    raise exception 'A blocked completion from an elevated context would fail on a null actor';
  end if;

  -- Typing a due date must take the task out of the offset rule, or the
  -- propagation would move a date somebody set by hand.
  if (select prosrc from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = 'set_workflow_task_details')
       not like '%due_offset_days%' then
    raise exception 'A hand-typed due date would still be moved by the plan';
  end if;

  -- The deploy tables are NOT audited: immutable records, append-only by grant.
  if exists (select 1 from pg_trigger
              where tgname in ('trg_workflow_template_deployments_audit',
                               'trg_workflow_task_dependencies_audit')) then
    raise exception 'An operational table gained an audit trigger it was not meant to have';
  end if;
end $$;
