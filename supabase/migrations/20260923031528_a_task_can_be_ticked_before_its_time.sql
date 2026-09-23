-- A task can be ticked before its time (23 Sep 2026)
--
-- Clinton, choosing between three ways a dependency could behave: "show blocked,
-- allow override" — a task whose prerequisites are not done is visibly blocked,
-- a person may complete it anyway, and the override is RECORDED so it is
-- visible later.
--
-- This file is the record half, and it is deliberately its own migration
-- because it lands BEFORE the trigger that writes it. The next migration's
-- status trigger inserts a row of this kind; without the constraint below
-- already widened, every blocked completion would fail on a check violation.
--
-- ---------------------------------------------------------------------------
-- THE TABLE ANTICIPATED THIS EXACTLY
-- ---------------------------------------------------------------------------
-- workflow_task_actions was written on 9 September with `kind text` and a check
-- constraint rather than an enum, and said why in its own header: "One value
-- today. A text column with a check rather than an enum, so the second kind is
-- a one-line migration and not a value that cannot be used in the transaction
-- that adds it."
--
-- This is that second kind. Nothing else needed inventing: the table already
-- stamps an actor from the session, is append-only by grant, names its actor
-- through staff_directory so the record survives the person leaving, and its
-- History tab already renders it. A separate override table would have
-- duplicated every one of those decisions.

alter table public.workflow_task_actions
  drop constraint workflow_task_actions_kind_known;

alter table public.workflow_task_actions
  add constraint workflow_task_actions_kind_known
  check (kind in ('email', 'completed_while_blocked'));

-- "Every override this quarter" is a firm-wide question, and both existing
-- indexes lead with a task or a workflow, so without this it is a sequential
-- scan. Partial, because email will be the overwhelming majority of the table.
create index workflow_task_actions_override_idx
  on public.workflow_task_actions (occurred_at desc, id desc)
  where kind = 'completed_while_blocked';

comment on column public.workflow_task_actions.kind is
  'What was done. ''email'' — a message composed from the Tools tab. ''completed_while_blocked'' — the task was ticked while a prerequisite was still open, written by the status trigger in the SAME TRANSACTION as the completion, which is what makes a blocked completion impossible without its record. Add a value to the check constraint as each new action is built.';

-- record_task_action() is deliberately NOT widened to accept the new kind. Its
-- `if p_kind not in ('email')` guard stays. The override row is written by the
-- trigger beside the status change; letting a client pass this kind would
-- afford the opposite — a record with no completion, and a completion path that
-- could forget the record.

do $$
begin
  if (select pg_get_constraintdef(oid) from pg_constraint
       where conname = 'workflow_task_actions_kind_known') not like '%completed_while_blocked%'
     or (select pg_get_constraintdef(oid) from pg_constraint
          where conname = 'workflow_task_actions_kind_known') not like '%email%' then
    raise exception 'workflow_task_actions must accept both the email and the override kind';
  end if;

  -- The email rule was written as `kind <> 'email' or ...` on 9 Sep, so a
  -- second kind needs no change to it. If that ever stops being true, an
  -- override row would be refused for having no recipient.
  if (select pg_get_constraintdef(oid) from pg_constraint
       where conname = 'workflow_task_actions_email_has_recipient') not like '%kind <> ''email''%' then
    raise exception 'The email recipient rule now applies to every kind, which would refuse an override';
  end if;

  -- The client-facing writer must still refuse the new kind.
  if (select prosrc from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = 'record_task_action') like '%completed_while_blocked%' then
    raise exception 'record_task_action accepts the override kind; a client could then record one with no completion';
  end if;
end $$;
