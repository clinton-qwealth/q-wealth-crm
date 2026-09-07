-- A description and a due date on a workflow.
--
-- Both nullable and additive: the seven existing rows keep working untouched,
-- and neither is required to start a piece of work.
--
-- due_at is a DATE, not a timestamptz, and that is deliberate. A due date is a
-- calendar date — "the 30th of September" — not an instant, so on the way to a
-- screen it must never go through `new Date()`: that parses it as UTC midnight
-- and renders the previous day anywhere west of Greenwich. created_at is the
-- opposite, a real instant, and must be converted to the reader's timezone.
-- Both halves of that pair live in lib/note-date.ts so neither can be reached
-- for without seeing the other.
alter table public.workflows
  add column description text,
  add column due_at date;

comment on column public.workflows.description is
  'Free text: what this piece of work is. Nullable — work can start without one.';

comment on column public.workflows.due_at is
  'The calendar date the work is due. A date, not a timestamptz: it is a day, not a moment.';

-- The view gains the two new columns for the detail page. Appended at the end,
-- which is the only place create-or-replace allows a new column.
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
  w.priority,
  w.due_at,
  w.description
from public.workflows w
join public.client_groups g on g.id = w.group_id
left join public.staff_directory sd on sd.id = w.owner_staff_id;

-- Not optional and not boilerplate. A replaced view keeps its grants, but this
-- is the moment the schema is touched, so it is the moment to re-assert that
-- anon and PUBLIC hold nothing on it.
revoke all on public.workflow_board from anon, public;
grant select on public.workflow_board to authenticated;
