-- A plan can be written down (23 Sep 2026)
--
-- Clinton: "I want to be able to add a template of tasks that are part of a
-- plan. Some of these tasks will have dependencies on other tasks being
-- completed ... a template / plan builder that administration can use to create
-- these plans and make them available to the general users to deploy into their
-- workflows."
--
-- This file is the AUTHORING half: what an administrator writes. Deploying one
-- into a workflow is the next migration, and nothing here knows about a
-- workflow. That split is deliberate — this file is purely additive and touches
-- no live table, so it can be applied and reverted on its own.
--
-- ---------------------------------------------------------------------------
-- THE WORD IS "WORKFLOW TEMPLATE", NOT "PLAN"
-- ---------------------------------------------------------------------------
-- The product already says it in three places and has since 6 September: the
-- dashed chip on the tasks panel reads "Workflow template name", the empty
-- state says "Tasks will be generated from the workflow template", and
-- workflow_tasks' own header says "tasks will eventually be generated from a
-- workflow template". And "plan" already means a Statement of Advice to an
-- adviser, which is a different thing entirely. Naming this table
-- `plan_templates` would have put two words for one idea in front of the same
-- people on the same screen.
--
-- ---------------------------------------------------------------------------
-- A CYCLE IS UNREPRESENTABLE, SO THERE IS NO CYCLE DETECTOR
-- ---------------------------------------------------------------------------
-- A task may only wait for a task EARLIER in the template's order. Every edge
-- therefore runs from a higher ordinal to a lower one, following edges strictly
-- decreases the ordinal, and a cycle cannot exist. The rule is enforced by a
-- deferred constraint trigger on both sides — adding an edge, and reordering a
-- task out from under one.
--
-- The alternative, and it was designed before it was rejected, is a general
-- `with recursive` reachability check. It would be the first recursive CTE in
-- this schema, it runs a full traversal per edge at commit, and it exists to
-- catch a state this ordering rule makes impossible to write. The coupling it
-- saves is not free either way: the authoring screen needs "prerequisites are
-- above you" regardless, because that is what makes a fifteen-task graph
-- readable as a list instead of a picture.
--
-- ---------------------------------------------------------------------------
-- A PUBLISHED TEMPLATE STAYS EDITABLE, BY DECISION
-- ---------------------------------------------------------------------------
-- Clinton, asked directly, chose "edit freely; future deploys only" over
-- versioning. Deployed tasks are copies and never change, so an edit cannot
-- disturb a running workflow. What is given up, and it should be said plainly
-- rather than discovered: NOTHING RECORDS WHICH SHAPE OF A TEMPLATE A GIVEN
-- WORKFLOW RECEIVED. If "which process did we follow for this client in March"
-- is ever asked, the answer is not in this database. The room left for that is
-- a `supersedes_id` column and a clone-on-publish; it is not built.
--
-- An ARCHIVED template is the exception: it is history, and history is not
-- edited. Restore it first.

-- ---------------------------------------------------------------------------
-- 1. The template
-- ---------------------------------------------------------------------------

create type public.workflow_template_status as enum ('draft', 'published', 'archived');

comment on type public.workflow_template_status is
  'draft — being written, invisible to the deploy picker. published — offered to anyone starting a workflow. archived — kept for the record, no longer offered. Not record_status: the third state gates deployment rather than visibility.';

create table public.workflow_templates (
  id                  uuid primary key default gen_random_uuid(),
  name                text not null,
  description         text,
  -- Advisory, never a refusal. It sorts the picker so an onboarding workflow
  -- offers the onboarding template first; null means "offer it everywhere".
  -- Deliberately not enforced at deploy: a firm will want its "ID collection"
  -- template inside an ad_hoc workflow in week two, and a hard rule would only
  -- be dropped again.
  workflow_type       public.workflow_type,
  status              public.workflow_template_status not null default 'draft',
  published_at        timestamptz,
  archived_at         timestamptz,
  created_by_staff_id uuid references public.staff_users(id),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint workflow_templates_name_not_blank check (length(trim(name)) > 0),
  -- Anything that has ever left draft carries the date it did. It survives
  -- archiving, because "when did this become the firm's process" outlives the
  -- process.
  constraint workflow_templates_published_when_stamped
    check (published_at is not null or status = 'draft'),
  constraint workflow_templates_archived_when_stamped
    check ((archived_at is not null) = (status = 'archived'))
);

-- Partial, unlike user_groups_name_lower_key, and that is the point: an
-- archived template must be allowed to keep its name while its replacement
-- takes it. Wanting the name back is the commonest reason to archive.
create unique index workflow_templates_name_lower_key
  on public.workflow_templates (lower(name)) where status <> 'archived';

create index workflow_templates_published_idx
  on public.workflow_templates (name) where status = 'published';

create trigger trg_workflow_templates_updated_at
  before update on public.workflow_templates
  for each row execute function public.set_updated_at();

comment on table public.workflow_templates is
  'A reusable set of tasks an administrator writes once and anybody deploys into a workflow. Editable while published: deployed tasks are copies, so an edit changes future deployments only and nothing records which shape a running workflow received.';
comment on column public.workflow_templates.workflow_type is
  'Which kind of workflow this is meant for. Sorts the deploy picker; never refuses a deployment. Null means every kind.';

-- ---------------------------------------------------------------------------
-- 2. The roles it names
-- ---------------------------------------------------------------------------
-- A template says "an Adviser does this, a Paraplanner does that"; the person
-- deploying maps each role to a colleague once, instead of reassigning fifteen
-- tasks one at a time.
--
-- A TABLE RATHER THAN A `role text` COLUMN ON THE TASK. This schema closes sets
-- — marital status and user-group names were both migrations whose whole
-- purpose was stopping "Adviser", "adviser" and "Advisor" being three things.
-- Free text would also make the deploy form a `select distinct` over typos, and
-- would make renaming a role a data migration across every task instead of one
-- update. The composite key below is the third reason: it lets a task's role be
-- constrained to its OWN template by a foreign key rather than by a trigger.

create table public.workflow_template_roles (
  id          uuid primary key default gen_random_uuid(),
  template_id uuid not null references public.workflow_templates(id) on delete cascade,
  name        text not null,
  created_at  timestamptz not null default now(),
  constraint workflow_template_roles_name_not_blank check (length(trim(name)) > 0),
  -- What workflow_template_tasks' role FK points at, so "this task's role
  -- belongs to this task's template" is structural. Same device as
  -- workflow_tasks_id_workflow_id_key, added 8 Sep for workflow_posts.
  constraint workflow_template_roles_id_template_id_key unique (id, template_id)
);

create unique index workflow_template_roles_name_lower_key
  on public.workflow_template_roles (template_id, lower(name));

comment on table public.workflow_template_roles is
  'A job a template expects somebody to do — Adviser, Paraplanner, Compliance. Belongs to one template; the deployer maps each to a staff member. No ordinal: the list is two to five items, read alphabetically.';

-- ---------------------------------------------------------------------------
-- 3. The tasks, in order
-- ---------------------------------------------------------------------------

create table public.workflow_template_tasks (
  id               uuid primary key default gen_random_uuid(),
  template_id      uuid not null references public.workflow_templates(id) on delete cascade,
  ordinal          integer not null,
  subject          text not null,
  description      text,
  task_type        public.task_type not null default 'checkbox',
  priority         public.workflow_priority not null default 'medium',
  role_id          uuid not null,
  -- "Due this many days after the task or tasks it waits for are settled"; for
  -- a task that waits for nothing, this many days after the deployment's start
  -- date.
  --
  -- ON THE TASK, NOT ON THE EDGE. A task with two prerequisites has one due
  -- date, so it must have one offset — an offset per edge would ask which of
  -- two numbers wins and there is no honest answer.
  due_offset_days  integer not null default 0,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint workflow_template_tasks_subject_not_blank check (length(trim(subject)) > 0),
  constraint workflow_template_tasks_offset_sane
    check (due_offset_days between 0 and 3650),
  constraint workflow_template_tasks_role_fk
    foreign key (role_id, template_id)
    references public.workflow_template_roles (id, template_id),
  -- Both dependency FKs resolve through this, which is what makes an edge
  -- between two templates impossible to WRITE rather than merely refused.
  constraint workflow_template_tasks_id_template_id_key unique (id, template_id),
  -- DEFERRABLE, and it is load-bearing. A reorder is one UPDATE that renumbers
  -- every row, so two tasks share an ordinal in the middle of the statement.
  -- The price, and it must be remembered: POSTGRES CANNOT USE A DEFERRABLE
  -- UNIQUE FOR `ON CONFLICT`. No writer of this table may ever say
  -- `on conflict (template_id, ordinal)`; appending reads max(ordinal) + 1.
  constraint workflow_template_tasks_ordinal_key
    unique (template_id, ordinal) deferrable initially deferred
);

create index workflow_template_tasks_template_idx
  on public.workflow_template_tasks (template_id, ordinal);
create index workflow_template_tasks_role_idx
  on public.workflow_template_tasks (role_id);

create trigger trg_workflow_template_tasks_updated_at
  before update on public.workflow_template_tasks
  for each row execute function public.set_updated_at();

comment on table public.workflow_template_tasks is
  'One step of a template, in the order it is written. Ordinals are 0-based and contiguous, as kb_chunks are. A task may only wait for a task with a lower ordinal, which is what makes a dependency cycle unrepresentable.';
comment on column public.workflow_template_tasks.due_offset_days is
  'Days after the thing this task waits for. For a task that waits for nothing, days after the deployment start date. On the task rather than the edge because a task has one due date however many prerequisites it has.';
comment on constraint workflow_template_tasks_ordinal_key on public.workflow_template_tasks is
  'Deferred so a whole-list renumber can be one statement. Consequence: this constraint cannot serve ON CONFLICT.';

-- ---------------------------------------------------------------------------
-- 4. What waits for what
-- ---------------------------------------------------------------------------

create table public.workflow_template_task_dependencies (
  -- Denormalised, and it cannot disagree with either endpoint because both
  -- foreign keys below travel through it. The device workflow_task_actions uses
  -- for workflow_id.
  template_id        uuid not null,
  task_id            uuid not null,
  depends_on_task_id uuid not null,
  created_at         timestamptz not null default now(),
  primary key (task_id, depends_on_task_id),
  constraint workflow_template_task_dependencies_not_self
    check (task_id <> depends_on_task_id),
  constraint workflow_template_task_dependencies_task_fk
    foreign key (task_id, template_id)
    references public.workflow_template_tasks (id, template_id) on delete cascade,
  constraint workflow_template_task_dependencies_prereq_fk
    foreign key (depends_on_task_id, template_id)
    references public.workflow_template_tasks (id, template_id) on delete cascade
);

-- "Who is waiting for me" — what the editor shows on a row before you move or
-- delete it. The primary key already answers "what am I waiting for".
create index workflow_template_task_dependencies_prereq_idx
  on public.workflow_template_task_dependencies (depends_on_task_id);
create index workflow_template_task_dependencies_template_idx
  on public.workflow_template_task_dependencies (template_id);

comment on table public.workflow_template_task_dependencies is
  'An edge: task_id waits for depends_on_task_id. Both endpoints resolve through one template_id, so an edge cannot span two templates. The prerequisite must have a lower ordinal, enforced by trg_*_order below.';

-- The rule that makes cycles impossible, enforced from both directions: adding
-- an edge that points forwards, and moving a task above something it waits for.
create or replace function public.enforce_template_dependency_order()
returns trigger
language plpgsql
security definer
set search_path to ''
as $fn$
declare
  v_template uuid := coalesce(new.template_id, old.template_id);
  v_task     text;
  v_prereq   text;
begin
  select t.subject, p.subject
    into v_task, v_prereq
    from public.workflow_template_task_dependencies d
    join public.workflow_template_tasks t on t.id = d.task_id
    join public.workflow_template_tasks p on p.id = d.depends_on_task_id
   where d.template_id = v_template
     and p.ordinal >= t.ordinal
   limit 1;

  if v_task is not null then
    raise exception '"%" cannot wait for "%", which comes after it', v_task, v_prereq;
  end if;
  return null;
end $fn$;

comment on function public.enforce_template_dependency_order() is
  'Refuses a template whose dependency points forwards. Deferred, so a whole-list reorder is judged once at commit rather than mid-statement. This rule is the schema''s entire cycle prevention: every edge runs from a higher ordinal to a lower one, so following edges strictly decreases and cannot return.';

create constraint trigger trg_workflow_template_task_dependencies_order
  after insert or update on public.workflow_template_task_dependencies
  deferrable initially deferred
  for each row execute function public.enforce_template_dependency_order();

-- The other direction: an edge that was legal when written, and a reorder that
-- moved the ground out from under it.
create constraint trigger trg_workflow_template_tasks_order
  after update of ordinal on public.workflow_template_tasks
  deferrable initially deferred
  for each row execute function public.enforce_template_dependency_order();

revoke all on function public.enforce_template_dependency_order()
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. Who may read and write
-- ---------------------------------------------------------------------------
-- Every active staff member READS a template — a general user has to see one to
-- deploy it. Only an administrator writes. The three child tables derive the
-- template's visibility with an exists() rather than restating the rule, as
-- workflow_tasks derives its workflow's.

alter table public.workflow_templates                 enable row level security;
alter table public.workflow_template_roles            enable row level security;
alter table public.workflow_template_tasks            enable row level security;
alter table public.workflow_template_task_dependencies enable row level security;

create policy workflow_templates_select on public.workflow_templates
  for select to authenticated using (public.is_active_staff());
create policy workflow_templates_insert on public.workflow_templates
  for insert to authenticated with check (public.current_staff_has('manage_staff'));
create policy workflow_templates_update on public.workflow_templates
  for update to authenticated
  using (public.current_staff_has('manage_staff'))
  with check (public.current_staff_has('manage_staff'));
-- No delete policy and no delete grant: a template is archived, never erased.

create policy workflow_template_roles_select on public.workflow_template_roles
  for select to authenticated
  using (exists (select 1 from public.workflow_templates t
                  where t.id = workflow_template_roles.template_id));
create policy workflow_template_roles_insert on public.workflow_template_roles
  for insert to authenticated
  with check (public.current_staff_has('manage_staff')
              and exists (select 1 from public.workflow_templates t
                           where t.id = template_id));
create policy workflow_template_roles_update on public.workflow_template_roles
  for update to authenticated
  using (public.current_staff_has('manage_staff'))
  with check (public.current_staff_has('manage_staff'));
create policy workflow_template_roles_delete on public.workflow_template_roles
  for delete to authenticated using (public.current_staff_has('manage_staff'));

create policy workflow_template_tasks_select on public.workflow_template_tasks
  for select to authenticated
  using (exists (select 1 from public.workflow_templates t
                  where t.id = workflow_template_tasks.template_id));
create policy workflow_template_tasks_insert on public.workflow_template_tasks
  for insert to authenticated
  with check (public.current_staff_has('manage_staff')
              and exists (select 1 from public.workflow_templates t
                           where t.id = template_id));
create policy workflow_template_tasks_update on public.workflow_template_tasks
  for update to authenticated
  using (public.current_staff_has('manage_staff'))
  with check (public.current_staff_has('manage_staff'));
create policy workflow_template_tasks_delete on public.workflow_template_tasks
  for delete to authenticated using (public.current_staff_has('manage_staff'));

create policy workflow_template_task_dependencies_select on public.workflow_template_task_dependencies
  for select to authenticated
  using (exists (select 1 from public.workflow_templates t
                  where t.id = workflow_template_task_dependencies.template_id));
create policy workflow_template_task_dependencies_insert on public.workflow_template_task_dependencies
  for insert to authenticated
  with check (public.current_staff_has('manage_staff')
              and exists (select 1 from public.workflow_templates t
                           where t.id = template_id));
create policy workflow_template_task_dependencies_delete on public.workflow_template_task_dependencies
  for delete to authenticated using (public.current_staff_has('manage_staff'));
-- No update policy on the edges: an edge exists or it does not.

-- A DELETE POLICY, IN A SCHEMA THAT HAS NEVER HAD ONE — argued, not slipped in.
-- The rule against deleting exists because operational records must not vanish.
-- A template's own tasks and roles are not records of anything that happened;
-- they are a form an administrator is still filling in, and a deployed task is
-- a COPY that a delete here cannot touch (its template_task_id is `on delete
-- set null`). The alternative, a removed_at flag, would make the ordinal
-- sequence, the dependency graph and the publish gate all filter it for ever.

revoke all on public.workflow_templates from public, anon, authenticated;
grant select, insert, update on public.workflow_templates to authenticated;

revoke all on public.workflow_template_roles from public, anon, authenticated;
grant select, insert, update, delete on public.workflow_template_roles to authenticated;

revoke all on public.workflow_template_tasks from public, anon, authenticated;
grant select, insert, update, delete on public.workflow_template_tasks to authenticated;

revoke all on public.workflow_template_task_dependencies from public, anon, authenticated;
grant select, insert, delete on public.workflow_template_task_dependencies to authenticated;

-- ---------------------------------------------------------------------------
-- 6. The audit trail
-- ---------------------------------------------------------------------------
-- All four are audited. This is administrator-authored configuration that
-- silently changes what every future workflow does — the class user_groups and
-- user_group_members are in, and the reason that class is audited. The children
-- are keyed by template_id rather than their own primary key so the trail reads
-- "Annual review" and not a uuid nobody can name.

create trigger trg_workflow_templates_audit
  after insert or update or delete on public.workflow_templates
  for each row execute function public.record_audit('id', '');
create trigger trg_workflow_template_roles_audit
  after insert or update or delete on public.workflow_template_roles
  for each row execute function public.record_audit('template_id', '');
create trigger trg_workflow_template_tasks_audit
  after insert or update or delete on public.workflow_template_tasks
  for each row execute function public.record_audit('template_id', '');
create trigger trg_workflow_template_task_dependencies_audit
  after insert or update or delete on public.workflow_template_task_dependencies
  for each row execute function public.record_audit('template_id', '');

-- Restated whole, as the house does. Three arms added at the end; nothing else
-- differs. workflow_templates and workflow_template_roles need no arm in
-- audit_record_label — both carry `name`, which the else branch already finds.
create or replace function public.audit_label_table(p_table text)
returns text
language sql
immutable
set search_path to ''
as $fn$
  select case p_table
    when 'persons'                             then 'parties'
    when 'organisations'                       then 'parties'
    when 'financial_account_owners'            then 'financial_accounts'
    when 'insurance_policy_parties'            then 'insurance_policies'
    when 'asset_liability_owners'              then 'assets_liabilities'
    when 'staff_access_assignments'            then 'staff_users'
    when 'staff_private_details'               then 'staff_users'
    when 'user_group_members'                  then 'user_groups'
    when 'client_group_user_groups'            then 'client_groups'
    when 'workflow_template_roles'             then 'workflow_templates'
    when 'workflow_template_tasks'             then 'workflow_templates'
    when 'workflow_template_task_dependencies' then 'workflow_templates'
    else p_table
  end
$fn$;

comment on function public.audit_label_table(text) is
  'The table whose rows carry a label for this audited table: itself, or the parent an owner/party/assignment/template-child row was keyed by. Added 19 Sep 2026 for audit_entries; workflow template children added 23 Sep 2026.';

-- One arm added: a template task is named by its subject, not a name or title.
create or replace function public.audit_record_label(p_table text, p_data jsonb)
returns text
language sql
immutable
set search_path to ''
as $fn$
  select nullif(btrim(case p_table
    when 'parties'                      then p_data->>'display_name'
    when 'persons'                      then concat_ws(' ', p_data->>'first_name', p_data->>'last_name')
    when 'organisations'                then p_data->>'legal_name'
    when 'client_groups'                then p_data->>'name'
    when 'user_groups'                  then p_data->>'name'
    when 'access_profiles'              then p_data->>'name'
    -- Payloads written before 19 Sep 2026 carry full_name; those written after
    -- carry the two parts. Both must resolve, forever.
    when 'staff_users'                  then coalesce(p_data->>'full_name',
                                                      concat_ws(' ', p_data->>'first_name', p_data->>'last_name'))
    when 'contact_points'               then p_data->>'value'
    when 'party_roles'                  then p_data->>'role'
    when 'party_relationships'          then p_data->>'relationship_type'
    when 'client_group_members'         then p_data->>'member_role'
    when 'client_group_access'          then p_data->>'access_level'
    when 'notes'                        then p_data->>'title'
    when 'financial_accounts'           then p_data->>'label'
    when 'assets_liabilities'           then p_data->>'label'
    when 'insurance_policies'           then p_data->>'label'
    when 'financial_account_valuations' then p_data->>'as_at'
    when 'note_attachments'             then p_data->>'kind'
    when 'workflow_post_media'          then p_data->>'original_name'
    when 'workflow_template_tasks'      then p_data->>'subject'
    else coalesce(p_data->>'label', p_data->>'name', p_data->>'display_name', p_data->>'title')
  end), '')
$fn$;

comment on function public.audit_record_label(text, jsonb) is
  'The human name of an audited row, from its payload. Added 19 Sep 2026; workflow_template_tasks added 23 Sep 2026.';

revoke all on function public.audit_label_table(text) from public, anon;
grant execute on function public.audit_label_table(text) to authenticated;
revoke all on function public.audit_record_label(text, jsonb) from public, anon;
grant execute on function public.audit_record_label(text, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- 7. Writing a template
-- ---------------------------------------------------------------------------
-- All SECURITY INVOKER: RLS is the enforcement point, and a definer function
-- here would bypass the very policies above. Each re-checks manage_staff up
-- front anyway, so the answer is a sentence rather than a silent no-op — the
-- friendlier of two identical answers.

create or replace function public.workflow_template_is_editable(p_template_id uuid)
returns boolean
language sql
stable
security invoker
set search_path to ''
as $fn$
  select exists (select 1 from public.workflow_templates t
                  where t.id = p_template_id and t.status <> 'archived')
$fn$;

comment on function public.workflow_template_is_editable(uuid) is
  'Whether a template may still be changed. A published template may: deployed tasks are copies, so an edit reaches future deployments only. An archived one may not — it is history, and history is restored before it is rewritten.';

-- Granted to authenticated, not left to PUBLIC. Every write function below is
-- SECURITY INVOKER and calls this, so without the grant they would each fail on
-- the HAPPY PATH ONLY — which is exactly how user_group_name shipped broken on
-- 20 September and had to be fixed the same day.
revoke all on function public.workflow_template_is_editable(uuid) from public, anon;
grant execute on function public.workflow_template_is_editable(uuid) to authenticated;

create or replace function public.create_workflow_template(
  p_name          text,
  p_description   text default null,
  p_workflow_type public.workflow_type default null
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
  if not public.current_staff_has('manage_staff') then
    raise exception 'Only an administrator can write a workflow template';
  end if;
  if length(trim(coalesce(p_name, ''))) = 0 then
    raise exception 'Give the template a name';
  end if;

  insert into public.workflow_templates (name, description, workflow_type, created_by_staff_id)
  values (trim(p_name), nullif(btrim(p_description), ''), p_workflow_type, v_staff)
  returning id into v_id;

  return v_id;
end $fn$;

revoke all on function public.create_workflow_template(text, text, public.workflow_type) from public, anon;
grant execute on function public.create_workflow_template(text, text, public.workflow_type) to authenticated;

create or replace function public.update_workflow_template_patch(
  p_template_id uuid,
  p_patch       jsonb
) returns void
language plpgsql
security invoker
set search_path to ''
as $fn$
declare
  v_key text;
begin
  if public.current_staff_id() is null then
    raise exception 'Not an active staff member';
  end if;
  if not public.current_staff_has('manage_staff') then
    raise exception 'Only an administrator can change a workflow template';
  end if;
  if not public.workflow_template_is_editable(p_template_id) then
    raise exception 'An archived template cannot be changed. Restore it first';
  end if;

  -- Key presence is the meaning: a form carrying only a name leaves the rest
  -- alone. An unknown key is refused rather than ignored, so a typo in a caller
  -- is a sentence and not a silent no-op.
  for v_key in select jsonb_object_keys(p_patch) loop
    if v_key not in ('name', 'description', 'workflow_type') then
      raise exception 'A template has no % to set', v_key;
    end if;
  end loop;

  if p_patch ? 'name' and length(trim(coalesce(p_patch->>'name', ''))) = 0 then
    raise exception 'Give the template a name';
  end if;

  update public.workflow_templates t
     set name          = case when p_patch ? 'name' then trim(p_patch->>'name') else t.name end,
         description   = case when p_patch ? 'description'
                              then nullif(btrim(p_patch->>'description'), '') else t.description end,
         workflow_type = case when p_patch ? 'workflow_type'
                              then (nullif(p_patch->>'workflow_type', ''))::public.workflow_type
                              else t.workflow_type end
   where t.id = p_template_id;

  if not found then
    raise exception 'No such template';
  end if;
end $fn$;

revoke all on function public.update_workflow_template_patch(uuid, jsonb) from public, anon;
grant execute on function public.update_workflow_template_patch(uuid, jsonb) to authenticated;

-- Publishing is the only transition with a gate, and the gate is a list of
-- sentences rather than a boolean: the screen disables its own button using the
-- same list, so a refusal here means the two disagreed.
create or replace function public.set_workflow_template_status(
  p_template_id uuid,
  p_status      public.workflow_template_status
) returns void
language plpgsql
security invoker
set search_path to ''
as $fn$
declare
  v_tasks   integer;
  v_orphan  text;
begin
  if public.current_staff_id() is null then
    raise exception 'Not an active staff member';
  end if;
  if not public.current_staff_has('manage_staff') then
    raise exception 'Only an administrator can publish or archive a workflow template';
  end if;

  if p_status = 'published' then
    select count(*) into v_tasks
      from public.workflow_template_tasks where template_id = p_template_id;
    if v_tasks = 0 then
      raise exception 'A template needs at least one task before it can be published';
    end if;

    -- A role nobody uses is a question the deployer answers for nothing.
    select r.name into v_orphan
      from public.workflow_template_roles r
     where r.template_id = p_template_id
       and not exists (select 1 from public.workflow_template_tasks t where t.role_id = r.id)
     limit 1;
    if v_orphan is not null then
      raise exception 'No task is done by the % role. Remove the role or use it', v_orphan;
    end if;
  end if;

  update public.workflow_templates t
     set status       = p_status,
         published_at = case when p_status = 'published' then coalesce(t.published_at, now())
                             else t.published_at end,
         archived_at  = case when p_status = 'archived' then coalesce(t.archived_at, now()) end
   where t.id = p_template_id;

  if not found then
    raise exception 'No such template';
  end if;
end $fn$;

revoke all on function public.set_workflow_template_status(uuid, public.workflow_template_status) from public, anon;
grant execute on function public.set_workflow_template_status(uuid, public.workflow_template_status) to authenticated;

-- ---------------------------------------------------------------------------
-- 8. Roles
-- ---------------------------------------------------------------------------

create or replace function public.create_workflow_template_role(
  p_template_id uuid,
  p_name        text
) returns uuid
language plpgsql
security invoker
set search_path to ''
as $fn$
declare
  v_id uuid;
begin
  if public.current_staff_id() is null then
    raise exception 'Not an active staff member';
  end if;
  if not public.current_staff_has('manage_staff') then
    raise exception 'Only an administrator can change a workflow template';
  end if;
  if not public.workflow_template_is_editable(p_template_id) then
    raise exception 'An archived template cannot be changed. Restore it first';
  end if;
  if length(trim(coalesce(p_name, ''))) = 0 then
    raise exception 'Give the role a name';
  end if;

  insert into public.workflow_template_roles (template_id, name)
  values (p_template_id, trim(p_name))
  returning id into v_id;

  return v_id;
exception when unique_violation then
  raise exception 'This template already has a % role', trim(p_name);
end $fn$;

revoke all on function public.create_workflow_template_role(uuid, text) from public, anon;
grant execute on function public.create_workflow_template_role(uuid, text) to authenticated;

-- Renaming is allowed even once deployments exist: a deployment froze the role
-- name it used in workflow_template_deployment_roles, so the old record still
-- reads correctly.
create or replace function public.rename_workflow_template_role(
  p_role_id uuid,
  p_name    text
) returns void
language plpgsql
security invoker
set search_path to ''
as $fn$
declare
  v_template uuid;
begin
  if public.current_staff_id() is null then
    raise exception 'Not an active staff member';
  end if;
  if not public.current_staff_has('manage_staff') then
    raise exception 'Only an administrator can change a workflow template';
  end if;
  if length(trim(coalesce(p_name, ''))) = 0 then
    raise exception 'Give the role a name';
  end if;

  select template_id into v_template from public.workflow_template_roles where id = p_role_id;
  if v_template is null then
    raise exception 'No such role';
  end if;
  if not public.workflow_template_is_editable(v_template) then
    raise exception 'An archived template cannot be changed. Restore it first';
  end if;

  update public.workflow_template_roles set name = trim(p_name) where id = p_role_id;
exception when unique_violation then
  raise exception 'This template already has a % role', trim(p_name);
end $fn$;

revoke all on function public.rename_workflow_template_role(uuid, text) from public, anon;
grant execute on function public.rename_workflow_template_role(uuid, text) to authenticated;

create or replace function public.remove_workflow_template_role(p_role_id uuid)
returns void
language plpgsql
security invoker
set search_path to ''
as $fn$
declare
  v_template uuid;
  v_used     integer;
begin
  if public.current_staff_id() is null then
    raise exception 'Not an active staff member';
  end if;
  if not public.current_staff_has('manage_staff') then
    raise exception 'Only an administrator can change a workflow template';
  end if;

  select template_id into v_template from public.workflow_template_roles where id = p_role_id;
  if v_template is null then
    raise exception 'No such role';
  end if;
  if not public.workflow_template_is_editable(v_template) then
    raise exception 'An archived template cannot be changed. Restore it first';
  end if;

  -- Refused with a count rather than cascaded. A role in use is a question for
  -- the author, not something to answer on their behalf by emptying fifteen
  -- tasks of their owner.
  select count(*) into v_used from public.workflow_template_tasks where role_id = p_role_id;
  if v_used > 0 then
    raise exception 'That role is on % tasks. Change those first', v_used;
  end if;

  delete from public.workflow_template_roles where id = p_role_id;
end $fn$;

revoke all on function public.remove_workflow_template_role(uuid) from public, anon;
grant execute on function public.remove_workflow_template_role(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 9. Tasks
-- ---------------------------------------------------------------------------

-- Always appended last. "Insert at position" was the alternative and makes the
-- author choose a number before they have written the task; append-then-move is
-- one decision at a time. It also means every existing task is a legal
-- prerequisite at the moment of writing, so the picker needs no filtering.
create or replace function public.add_workflow_template_task(
  p_template_id     uuid,
  p_subject         text,
  p_role_id         uuid,
  p_due_offset_days integer default 0,
  p_description     text default null,
  p_priority        public.workflow_priority default 'medium'
) returns uuid
language plpgsql
security invoker
set search_path to ''
as $fn$
declare
  v_id      uuid;
  v_ordinal integer;
begin
  if public.current_staff_id() is null then
    raise exception 'Not an active staff member';
  end if;
  if not public.current_staff_has('manage_staff') then
    raise exception 'Only an administrator can change a workflow template';
  end if;
  if not public.workflow_template_is_editable(p_template_id) then
    raise exception 'An archived template cannot be changed. Restore it first';
  end if;
  if length(trim(coalesce(p_subject, ''))) = 0 then
    raise exception 'Give the task a subject';
  end if;
  if p_role_id is null then
    raise exception 'Say who does this task';
  end if;

  -- max + 1, never ON CONFLICT: the ordinal constraint is deferrable and
  -- Postgres will not use a deferrable unique for conflict resolution.
  select coalesce(max(ordinal) + 1, 0) into v_ordinal
    from public.workflow_template_tasks where template_id = p_template_id;

  insert into public.workflow_template_tasks
    (template_id, ordinal, subject, description, role_id, due_offset_days, priority)
  values
    (p_template_id, v_ordinal, trim(p_subject), nullif(btrim(p_description), ''),
     p_role_id, coalesce(p_due_offset_days, 0), p_priority)
  returning id into v_id;

  return v_id;
end $fn$;

revoke all on function public.add_workflow_template_task(uuid, text, uuid, integer, text, public.workflow_priority) from public, anon;
grant execute on function public.add_workflow_template_task(uuid, text, uuid, integer, text, public.workflow_priority) to authenticated;

create or replace function public.update_workflow_template_task_patch(
  p_task_id uuid,
  p_patch   jsonb
) returns void
language plpgsql
security invoker
set search_path to ''
as $fn$
declare
  v_template uuid;
  v_key      text;
begin
  if public.current_staff_id() is null then
    raise exception 'Not an active staff member';
  end if;
  if not public.current_staff_has('manage_staff') then
    raise exception 'Only an administrator can change a workflow template';
  end if;

  select template_id into v_template from public.workflow_template_tasks where id = p_task_id;
  if v_template is null then
    raise exception 'No such task';
  end if;
  if not public.workflow_template_is_editable(v_template) then
    raise exception 'An archived template cannot be changed. Restore it first';
  end if;

  for v_key in select jsonb_object_keys(p_patch) loop
    if v_key not in ('subject', 'description', 'priority', 'role_id', 'due_offset_days') then
      raise exception 'A template task has no % to set', v_key;
    end if;
  end loop;

  if p_patch ? 'subject' and length(trim(coalesce(p_patch->>'subject', ''))) = 0 then
    raise exception 'Give the task a subject';
  end if;
  if p_patch ? 'role_id' and nullif(btrim(p_patch->>'role_id'), '') is null then
    raise exception 'Say who does this task';
  end if;

  update public.workflow_template_tasks t
     set subject         = case when p_patch ? 'subject' then trim(p_patch->>'subject') else t.subject end,
         description     = case when p_patch ? 'description'
                                then nullif(btrim(p_patch->>'description'), '') else t.description end,
         priority        = case when p_patch ? 'priority'
                                then (p_patch->>'priority')::public.workflow_priority else t.priority end,
         role_id         = case when p_patch ? 'role_id'
                                then (p_patch->>'role_id')::uuid else t.role_id end,
         due_offset_days = case when p_patch ? 'due_offset_days'
                                then coalesce((nullif(btrim(p_patch->>'due_offset_days'), ''))::integer, 0)
                                else t.due_offset_days end
   where t.id = p_task_id;
end $fn$;

revoke all on function public.update_workflow_template_task_patch(uuid, jsonb) from public, anon;
grant execute on function public.update_workflow_template_task_patch(uuid, jsonb) to authenticated;

-- Deleting closes the gap, so ordinals stay contiguous from zero. The edges go
-- with it by cascade; a task that other tasks wait for is refused, because
-- silently dropping their prerequisite is data loss discovered at deploy time.
create or replace function public.remove_workflow_template_task(p_task_id uuid)
returns void
language plpgsql
security invoker
set search_path to ''
as $fn$
declare
  v_template uuid;
  v_ordinal  integer;
  v_waiting  integer;
begin
  if public.current_staff_id() is null then
    raise exception 'Not an active staff member';
  end if;
  if not public.current_staff_has('manage_staff') then
    raise exception 'Only an administrator can change a workflow template';
  end if;

  select template_id, ordinal into v_template, v_ordinal
    from public.workflow_template_tasks where id = p_task_id;
  if v_template is null then
    raise exception 'No such task';
  end if;
  if not public.workflow_template_is_editable(v_template) then
    raise exception 'An archived template cannot be changed. Restore it first';
  end if;

  select count(*) into v_waiting
    from public.workflow_template_task_dependencies where depends_on_task_id = p_task_id;
  if v_waiting > 0 then
    raise exception '% tasks wait for this one. Change those first', v_waiting;
  end if;

  delete from public.workflow_template_tasks where id = p_task_id;

  update public.workflow_template_tasks
     set ordinal = ordinal - 1
   where template_id = v_template and ordinal > v_ordinal;
end $fn$;

revoke all on function public.remove_workflow_template_task(uuid) from public, anon;
grant execute on function public.remove_workflow_template_task(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 10. Order, and what waits for what
-- ---------------------------------------------------------------------------

-- The whole list, renumbered in ONE statement. That is what the deferred unique
-- above is for. The alternatives were: shift every ordinal negative and
-- renumber back, which writes two audit rows per task per reorder — half of
-- them noise on a screen the firm actually reads; or no constraint at all,
-- which lets a duplicate ordinal render as a nondeterministic order that nobody
-- reports as a bug because it looks like a preference.
create or replace function public.reorder_workflow_template_tasks(
  p_template_id uuid,
  p_task_ids    uuid[]
) returns integer
language plpgsql
security invoker
set search_path to ''
as $fn$
declare
  v_moved integer;
begin
  if public.current_staff_id() is null then
    raise exception 'Not an active staff member';
  end if;
  if not public.current_staff_has('manage_staff') then
    raise exception 'Only an administrator can change a workflow template';
  end if;
  if not public.workflow_template_is_editable(p_template_id) then
    raise exception 'An archived template cannot be changed. Restore it first';
  end if;

  -- Every task, exactly once. A partial list would leave a gap or a duplicate
  -- and the deferred constraint would refuse at COMMIT with a message about an
  -- index rather than a sentence anybody can act on.
  if (select count(*) from public.workflow_template_tasks where template_id = p_template_id)
     <> (select count(distinct id) from unnest(p_task_ids) as id)
     or exists (select 1 from unnest(p_task_ids) as id
                 where id not in (select tt.id from public.workflow_template_tasks tt
                                   where tt.template_id = p_template_id))
  then
    raise exception 'The new order must list every task on this template exactly once';
  end if;

  -- `is distinct from` so a task that did not move writes no audit row:
  -- record_audit() returns early when nothing changed.
  update public.workflow_template_tasks t
     set ordinal = o.ord - 1
    from unnest(p_task_ids) with ordinality as o(id, ord)
   where t.id = o.id
     and t.template_id = p_template_id
     and t.ordinal is distinct from (o.ord - 1);

  get diagnostics v_moved = row_count;
  return v_moved;
end $fn$;

revoke all on function public.reorder_workflow_template_tasks(uuid, uuid[]) from public, anon;
grant execute on function public.reorder_workflow_template_tasks(uuid, uuid[]) to authenticated;

-- A task's whole prerequisite set, replaced. The screen sends a checkbox set,
-- so "nothing ticked" has to mean "waits for nothing" rather than "leave alone"
-- — which is what the hidden sentinel in CheckboxSet exists to distinguish.
create or replace function public.set_workflow_template_dependencies(
  p_task_id             uuid,
  p_depends_on_task_ids uuid[]
) returns integer
language plpgsql
security invoker
set search_path to ''
as $fn$
declare
  v_template uuid;
  v_ordinal  integer;
  v_bad      text;
  v_added    integer;
begin
  if public.current_staff_id() is null then
    raise exception 'Not an active staff member';
  end if;
  if not public.current_staff_has('manage_staff') then
    raise exception 'Only an administrator can change a workflow template';
  end if;

  select template_id, ordinal into v_template, v_ordinal
    from public.workflow_template_tasks where id = p_task_id;
  if v_template is null then
    raise exception 'No such task';
  end if;
  if not public.workflow_template_is_editable(v_template) then
    raise exception 'An archived template cannot be changed. Restore it first';
  end if;

  -- The trigger enforces this too, and would refuse the whole transaction at
  -- commit. Checking here as well is what turns "constraint violated" into a
  -- sentence naming the two tasks, at the moment of the click.
  select p.subject into v_bad
    from public.workflow_template_tasks p
   where p.id = any (p_depends_on_task_ids)
     and (p.template_id <> v_template or p.ordinal >= v_ordinal)
   limit 1;
  if v_bad is not null then
    raise exception 'A task can only wait for something above it, and "%" is not', v_bad;
  end if;

  delete from public.workflow_template_task_dependencies where task_id = p_task_id;

  insert into public.workflow_template_task_dependencies (template_id, task_id, depends_on_task_id)
  select v_template, p_task_id, x
    from unnest(coalesce(p_depends_on_task_ids, '{}'::uuid[])) as x
   where x <> p_task_id;

  get diagnostics v_added = row_count;
  return v_added;
end $fn$;

revoke all on function public.set_workflow_template_dependencies(uuid, uuid[]) from public, anon;
grant execute on function public.set_workflow_template_dependencies(uuid, uuid[]) to authenticated;

-- ---------------------------------------------------------------------------
-- 11. Prove it, or abort
-- ---------------------------------------------------------------------------
-- THE RPCs ABOVE CANNOT BE CALLED FROM HERE. current_staff_id() has no elevated
-- bypass — unlike current_staff_has, which answers true for postgres — so
-- auth.uid() being null during a migration means every write function raises on
-- its first line. This block therefore exercises the STRUCTURE by direct SQL as
-- the owner, which is also what lets it see past RLS. Anybody "fixing" that by
-- weakening the guard has misread this comment.
--
-- The fixture leaves a handful of audit_log rows behind. That is correct and
-- harmless: it is what an insert and a delete of a template look like.
do $$
declare
  v_template uuid;
  v_role     uuid;
  v_a uuid; v_b uuid; v_c uuid;
  v_caught   boolean := false;
begin
  -- Structure: without these composite keys the foreign keys below were not
  -- created either, and an edge could quietly span two templates.
  if not exists (select 1 from pg_constraint where conname = 'workflow_template_tasks_id_template_id_key')
     or not exists (select 1 from pg_constraint where conname = 'workflow_template_roles_id_template_id_key')
     or not exists (select 1 from pg_constraint where conname = 'workflow_template_tasks_role_fk')
     or not exists (select 1 from pg_constraint where conname = 'workflow_template_task_dependencies_task_fk')
     or not exists (select 1 from pg_constraint where conname = 'workflow_template_task_dependencies_prereq_fk') then
    raise exception 'A template task could take a role, or a dependency, from another template';
  end if;

  -- Deferrable, or a reorder breaks in production the first time two tasks swap.
  if not exists (select 1 from pg_constraint
                  where conname = 'workflow_template_tasks_ordinal_key'
                    and condeferrable and condeferred) then
    raise exception 'The template task ordinal must be deferrable initially deferred';
  end if;

  -- Both order triggers, and both deferred: an immediate one would refuse a
  -- legitimate whole-list renumber mid-statement.
  if (select count(*) from pg_trigger
       where tgname in ('trg_workflow_template_task_dependencies_order', 'trg_workflow_template_tasks_order')
         and tgdeferrable and tginitdeferred) <> 2 then
    raise exception 'The dependency order rule is missing or is not deferred';
  end if;

  -- Audit: real calls, not a grep of the source.
  if (select count(*) from pg_trigger
       where tgname in ('trg_workflow_templates_audit', 'trg_workflow_template_roles_audit',
                        'trg_workflow_template_tasks_audit',
                        'trg_workflow_template_task_dependencies_audit')) <> 4 then
    raise exception 'A workflow template table is not audited';
  end if;
  if public.audit_label_table('workflow_template_tasks') <> 'workflow_templates'
     or public.audit_record_label('workflow_template_tasks', '{"subject":"Collect the authority"}'::jsonb)
        <> 'Collect the authority'
     or public.audit_record_label('workflow_templates', '{"name":"Annual review"}'::jsonb) <> 'Annual review' then
    raise exception 'The audit trail cannot name a workflow template';
  end if;

  -- Privilege.
  if has_table_privilege('anon', 'public.workflow_templates', 'select')
     or has_table_privilege('anon', 'public.workflow_template_tasks', 'select') then
    raise exception 'anon must hold nothing here';
  end if;
  if has_table_privilege('authenticated', 'public.workflow_templates', 'delete') then
    raise exception 'A template is archived, never deleted';
  end if;
  if exists (select 1 from pg_policies
              where schemaname = 'public' and tablename = 'workflow_templates' and cmd = 'DELETE') then
    raise exception 'No delete policy belongs on workflow_templates';
  end if;

  -- Every write path is SECURITY INVOKER, so RLS is still the enforcement
  -- point. A definer function here would turn its own execute grant into a hole.
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
              where n.nspname = 'public' and p.prosecdef
                and p.proname in ('create_workflow_template', 'update_workflow_template_patch',
                                  'set_workflow_template_status', 'create_workflow_template_role',
                                  'rename_workflow_template_role', 'remove_workflow_template_role',
                                  'add_workflow_template_task', 'update_workflow_template_task_patch',
                                  'remove_workflow_template_task', 'reorder_workflow_template_tasks',
                                  'set_workflow_template_dependencies', 'workflow_template_is_editable')) then
    raise exception 'A workflow template write path is SECURITY DEFINER; it would bypass row-level security';
  end if;
  -- ...and the helper every one of them calls is executable BY THE CALLER.
  -- This is the user_group_name bug, which shipped on 20 Sep and failed only on
  -- the happy path.
  if not has_function_privilege('authenticated', 'public.workflow_template_is_editable(uuid)', 'EXECUTE') then
    raise exception 'A caller cannot execute the helper its own write path calls';
  end if;

  -- Behaviour, on a fixture this block builds and removes.
  insert into public.workflow_templates (name, status) values ('__probe__', 'draft') returning id into v_template;
  insert into public.workflow_template_roles (template_id, name)
       values (v_template, 'Adviser') returning id into v_role;
  insert into public.workflow_template_tasks (template_id, ordinal, subject, role_id, due_offset_days)
       values (v_template, 0, 'A', v_role, 0) returning id into v_a;
  insert into public.workflow_template_tasks (template_id, ordinal, subject, role_id, due_offset_days)
       values (v_template, 1, 'B', v_role, 3) returning id into v_b;
  insert into public.workflow_template_tasks (template_id, ordinal, subject, role_id, due_offset_days)
       values (v_template, 2, 'C', v_role, 5) returning id into v_c;
  insert into public.workflow_template_task_dependencies (template_id, task_id, depends_on_task_id)
       values (v_template, v_b, v_a), (v_template, v_c, v_b);

  -- A forwards edge is refused. C already comes after A, so A waiting for C
  -- points forwards — and this is also the cycle that cannot be written.
  --
  -- `set constraints all immediate` is what makes this testable AT ALL. The
  -- trigger is DEFERRED, so it does not fire when the row is inserted; it fires
  -- at COMMIT, which is outside this subtransaction and therefore outside the
  -- exception handler. Without the line below, v_caught stays false and the
  -- probe reports a writable cycle that is in fact refused — which is exactly
  -- what happened on the first run of this migration. Making the constraint
  -- immediate inside the block pulls the check forward to where it can be
  -- caught; the rollback puts it back to deferred.
  begin
    insert into public.workflow_template_task_dependencies (template_id, task_id, depends_on_task_id)
         values (v_template, v_a, v_c);
    set constraints all immediate;
  exception when others then
    v_caught := true;
  end;
  if not v_caught then
    raise exception 'A task was allowed to wait for something below it, so a cycle is writable';
  end if;

  -- A swap under the deferred unique: two rows share an ordinal mid-statement,
  -- which a non-deferrable constraint would refuse. B and A have no edge
  -- between them any more, so the order rule is satisfied either way.
  delete from public.workflow_template_task_dependencies where task_id = v_b;
  update public.workflow_template_tasks
     set ordinal = case id when v_a then 1 when v_b then 0 end
   where id in (v_a, v_b);
  -- Again pulled forward, so a failure is attributed to the swap rather than
  -- arriving at the end of the migration with nothing to point at.
  set constraints all immediate;
  if (select ordinal from public.workflow_template_tasks where id = v_a) <> 1 then
    raise exception 'Two tasks cannot swap places, so a reorder is impossible';
  end if;

  delete from public.workflow_templates where id = v_template;
  if exists (select 1 from public.workflow_template_tasks where template_id = v_template)
     or exists (select 1 from public.workflow_template_task_dependencies where template_id = v_template) then
    raise exception 'A deleted template left its tasks or edges behind';
  end if;
end $$;
