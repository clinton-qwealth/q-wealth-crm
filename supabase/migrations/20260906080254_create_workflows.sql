-- Workflows (6 Sep 2026)
--
-- A workflow is a piece of work a group is being taken through: onboarding,
-- an annual review, a piece of advice being produced. It belongs to the GROUP,
-- not to a party — unlike an account, which is owned by a person and only rolls
-- up to a group. Onboarding is something done for a household, and a household
-- is what is being onboarded.
--
-- Deliberately minimal. There are no steps, no templates, no due dates and no
-- assignment beyond a single owner. Those are the parts of a workflow feature
-- that need designing against how the firm actually works, and inventing them
-- now would commit the schema to guesses. What is here is only what is needed
-- to say "this file note belongs to the annual review" and have that mean
-- something.

create type public.workflow_type as enum (
  'onboarding',
  'annual_review',
  'advice_production',
  'insurance_claim',
  'ad_hoc'
);

create type public.workflow_status as enum (
  'not_started',
  'in_progress',
  'blocked',
  'complete',
  'cancelled'
);

create table public.workflows (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.client_groups(id) on delete cascade,
  workflow_type public.workflow_type not null,
  name text not null,
  status public.workflow_status not null default 'in_progress',
  owner_staff_id uuid references public.staff_users(id),
  started_at timestamptz,
  completed_at timestamptz,
  created_by_staff_id uuid references public.staff_users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- A name is what an adviser reads on the pill, so a blank one is not a
  -- workflow anyone can identify. Same rule as account_number and
  -- policy_number: enforced here, not in the form, because the form is not the
  -- only caller.
  constraint workflows_name_not_blank check (length(trim(name)) > 0),

  -- Only a finished workflow has a finish date.
  constraint workflows_completed_when_complete
    check (completed_at is null or status = 'complete'),
  constraint workflows_completed_after_started
    check (completed_at is null or started_at is null or completed_at >= started_at)
);

create index workflows_group_idx on public.workflows (group_id);
create index workflows_open_idx on public.workflows (group_id, status)
  where status in ('not_started', 'in_progress', 'blocked');

create trigger trg_workflows_updated_at
  before update on public.workflows
  for each row execute function public.set_updated_at();

comment on table public.workflows is
  'A piece of work a client group is being taken through. Minimal by design: no steps, templates or due dates yet. Exists so a note can say which workflow it belongs to.';
comment on column public.workflows.group_id is
  'The group the work is being done for. A workflow belongs to a group directly, unlike an account which is owned by a party and derived to a group.';
comment on column public.workflows.status is
  'Defaults to in_progress: a workflow is created at the moment somebody starts one, so not_started exists for work planned ahead rather than as the initial state.';

-- ---------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------
-- Visibility is the group's visibility, exactly. There is no separate notion of
-- who can see a workflow: if you can see the group, you can see the work being
-- done for it.
alter table public.workflows enable row level security;

create policy workflows_select on public.workflows
  for select to authenticated
  using (public.staff_can_access_group(group_id));

create policy workflows_insert on public.workflows
  for insert to authenticated
  with check (
    public.is_active_staff()
    and public.staff_can_access_group(group_id)
    and created_by_staff_id = public.current_staff_id()
  );

create policy workflows_update on public.workflows
  for update to authenticated
  using (public.staff_can_access_group(group_id))
  with check (public.staff_can_access_group(group_id));

-- No delete policy. A workflow that was started is a fact about what happened;
-- it is cancelled, not erased. Matches the treatment of notes and parties.

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
-- Supabase's default privileges on schema public grant every new table in full
-- to anon, authenticated and service_role. anon must hold nothing, and
-- authenticated must hold only what a policy above can justify — a privilege
-- for a command with no policy can never be used legitimately, so granting it
-- only widens what a future policy would silently enable.
revoke all on public.workflows from anon, public;
grant select, insert, update on public.workflows to authenticated;
