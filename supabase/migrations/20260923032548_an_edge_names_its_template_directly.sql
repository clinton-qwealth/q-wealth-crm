-- An edge names its template directly (23 Sep 2026)
--
-- `workflow_template_task_dependencies.template_id` already carries the
-- template, and both composite foreign keys travel through it — which is what
-- makes an edge between two templates unwritable. What it did NOT have was a
-- foreign key of its own to `workflow_templates`, because the composite pair
-- implied one.
--
-- PostgREST reads relationships from foreign keys. Without a direct one it
-- cannot embed the edges under the template they belong to, so the editor would
-- have had to fetch them in a second query — and the editor route is held to
-- ONE round trip, like every other page here. A second query to recover a
-- relationship the data already has is the wrong trade.
--
-- This adds nothing the schema did not already guarantee: a row whose
-- template_id did not match its endpoints was already impossible. It makes the
-- guarantee visible to a tool that reads catalogues rather than intentions.

alter table public.workflow_template_task_dependencies
  add constraint workflow_template_task_dependencies_template_fk
  foreign key (template_id) references public.workflow_templates (id) on delete cascade;

comment on constraint workflow_template_task_dependencies_template_fk
  on public.workflow_template_task_dependencies is
  'Redundant against the two composite keys, and deliberately so: it is what lets PostgREST embed a template''s edges in the same read as its tasks.';

do $$
begin
  if not exists (select 1 from pg_constraint
                  where conname = 'workflow_template_task_dependencies_template_fk') then
    raise exception 'The edges cannot be read in the same query as the template';
  end if;
  -- The composite keys are the ones carrying the real guarantee; a later hand
  -- that drops them because "the template_id is already constrained" would be
  -- removing the rule that an edge cannot span two templates.
  if not exists (select 1 from pg_constraint where conname = 'workflow_template_task_dependencies_task_fk')
     or not exists (select 1 from pg_constraint where conname = 'workflow_template_task_dependencies_prereq_fk') then
    raise exception 'The composite keys are gone, so an edge could span two templates';
  end if;
end $$;
