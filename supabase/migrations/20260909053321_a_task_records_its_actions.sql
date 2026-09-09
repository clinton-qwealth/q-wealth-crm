-- A task's ACTIONS: what was done from the Tools tab, as a record.
--
-- ---- WHY THIS IS NOT A FILE NOTE -----------------------------------------
--
-- `notes` already has a `note_type` of 'email_record', and an email to a
-- client genuinely belongs in that client's file. It is deliberately NOT used
-- here, and the reason is that **nothing is actually sent yet**: the Email
-- tool composes a message and records the attempt, but no message leaves the
-- building. A row in the client's permanent file asserting that the client was
-- emailed, when they were not, is a compliance problem rather than a feature.
--
-- So this table records what a staff member DID on a task, which is true, and
-- the client's file stays untouched until sending is real. When it is, the
-- write path can additionally create the `email_record` note and the two will
-- agree, because the note will describe something that happened.
--
-- ---- WHAT IT IS FOR ------------------------------------------------------
--
-- The task panel's History tab. That tab has said "changes to this task are
-- not recorded yet" since it was built, because `workflow_tasks` carries no
-- audit trigger. This gives it a real source for the half that is an ACTION
-- rather than a field change; the audit trigger, when it is a decision that
-- has been made, supplies the other half.

create table public.workflow_task_actions (
  id             uuid primary key default gen_random_uuid(),
  workflow_id    uuid not null references public.workflows (id) on delete cascade,
  task_id        uuid not null,
  kind           text not null,
  actor_staff_id uuid not null references public.staff_users (id),
  -- The addresses AS THEY STOOD. A record must say where the thing actually
  -- went; resolving the client's email live would silently rewrite history the
  -- day they change it.
  recipient      text,
  sender         text,
  subject        text,
  -- The same document shape a post uses, so one renderer draws both — but a
  -- NARROWER node list, see record_task_action() below.
  body           jsonb,
  body_text      text generated always as (coalesce(public.activity_doc_text(body), '')) stored,
  occurred_at    timestamptz not null default now(),

  -- One value today. A text column with a check rather than an enum, so the
  -- second kind is a one-line migration and not a value that cannot be used in
  -- the transaction that adds it.
  constraint workflow_task_actions_kind_known check (kind in ('email')),
  -- An email has to have gone somewhere.
  constraint workflow_task_actions_email_has_recipient
    check (kind <> 'email' or coalesce(btrim(recipient), '') <> ''),
  -- The denormalised workflow_id cannot disagree with the task's own, the same
  -- way workflow_posts is held honest. workflow_tasks already carries the
  -- unique (id, workflow_id) this needs — added for posts.
  constraint workflow_task_actions_task_fk
    foreign key (task_id, workflow_id) references public.workflow_tasks (id, workflow_id)
);

comment on table public.workflow_task_actions is
  'What a staff member did from a task''s Tools tab — today, composing an email. Append-only: it is a record. recipient/sender/subject/body are what was used AT THE TIME, not a live lookup. Deliberately NOT a `notes` row of type email_record: nothing is actually sent yet, so the client''s file must not claim they were contacted. Behind the task panel''s History tab.';

comment on column public.workflow_task_actions.kind is
  'What was done. ''email'' today; add a value to the check constraint as each Tools action is built.';
comment on column public.workflow_task_actions.body is
  'The message, as a document in the same shape as a post''s body but on a NARROWER node list — no mention, entity, image or attachment, because those name staff, clients or post media and an email body names none of those.';

create index workflow_task_actions_task_idx
  on public.workflow_task_actions (task_id, occurred_at desc, id desc);
create index workflow_task_actions_workflow_idx
  on public.workflow_task_actions (workflow_id, occurred_at desc, id desc);

alter table public.workflow_task_actions enable row level security;

-- Visibility is the workflow's, DERIVED rather than restated — so it cannot
-- drift from the parent's. Same shape as workflow_tasks and workflow_posts.
create policy workflow_task_actions_select on public.workflow_task_actions
  for select to authenticated
  using (exists (select 1 from public.workflows w where w.id = workflow_task_actions.workflow_id));

create policy workflow_task_actions_insert on public.workflow_task_actions
  for insert to authenticated
  with check (
    public.current_staff_id() is not null
    and actor_staff_id = public.current_staff_id()
    and exists (select 1 from public.workflows w where w.id = workflow_task_actions.workflow_id)
  );

-- Append-only, by grant: a record of what happened is not editable. No UPDATE
-- or DELETE privilege and no policy for either, so both are refused before RLS
-- is consulted. Supabase's defaults for `authenticated` are revoked first —
-- the standing cost documented on the Data Model page.
revoke all on public.workflow_task_actions from authenticated;
grant select, insert on public.workflow_task_actions to authenticated;
revoke all on public.workflow_task_actions from anon;

/**
 * Record an action taken from a task.
 *
 * The actor is the SESSION, never a parameter — the insert policy refuses any
 * row whose actor is not the caller, so a forged actor is refused even by a
 * direct insert.
 */
create or replace function public.record_task_action(
  p_workflow_id uuid,
  p_task_id     uuid,
  p_kind        text,
  p_recipient   text,
  p_sender      text,
  p_subject     text,
  p_body        jsonb default null
) returns uuid
language plpgsql
security invoker
set search_path = ''
as $fn$
declare
  v_id  uuid;
  v_bad text;
begin
  if public.current_staff_id() is null then
    raise exception 'Not an active staff member';
  end if;
  if p_workflow_id is null or p_task_id is null then
    raise exception 'An action belongs to a task on a workflow';
  end if;
  if p_kind is null or p_kind not in ('email') then
    raise exception 'Not an action this task can record';
  end if;

  -- Read under the caller's own RLS: an action on a task you cannot see is
  -- indistinguishable from one on a task that does not exist.
  if not exists (
       select 1 from public.workflow_tasks t
        where t.id = p_task_id and t.workflow_id = p_workflow_id) then
    raise exception 'No such task on this workflow, or not within your access';
  end if;

  if p_kind = 'email' and coalesce(btrim(p_recipient), '') = '' then
    raise exception 'An email needs a recipient';
  end if;

  if p_body is not null then
    if jsonb_typeof(p_body) <> 'object' or p_body->>'type' <> 'doc' then
      raise exception 'A message must be a document';
    end if;

    -- NARROWER than a post's list. A post may name a colleague, a client, or
    -- bytes it has claimed; an email body may not — a `mention` would resolve
    -- to a staff member's current name inside a message already sent, and an
    -- `image` would claim a workflow_post_media row that belongs to posts.
    select n->>'type' into v_bad
      from jsonb_path_query(p_body, 'strict $.**') as t(n)
     where jsonb_typeof(n) = 'object' and n ? 'type'
       and n->>'type' not in ('doc','paragraph','text','hardBreak',
                              'bulletList','orderedList','listItem',
                              'heading','blockquote','codeBlock','horizontalRule',
                              'bold','italic','strike','code','link','underline')
     limit 1;
    if v_bad is not null then
      raise exception 'A message may not contain "%"', v_bad;
    end if;

    -- One heading size, as a post has.
    perform 1
      from jsonb_path_query(p_body, 'strict $.** ? (@.type == "heading")') as t(n)
     where coalesce(n->'attrs'->>'level', '') <> '1';
    if found then
      raise exception 'A message has one heading size; a heading must be level 1';
    end if;

    perform 1
      from jsonb_path_query(p_body, 'strict $.** ? (@.type == "link")') as t(n)
     where coalesce(n->'attrs'->>'href', '') !~* '^https?://';
    if found then
      raise exception 'A link must start with http:// or https://';
    end if;
  end if;

  insert into public.workflow_task_actions
         (workflow_id, task_id, kind, actor_staff_id, recipient, sender, subject, body)
  values (p_workflow_id, p_task_id, p_kind, public.current_staff_id(),
          btrim(p_recipient), nullif(btrim(p_sender), ''), nullif(btrim(p_subject), ''), p_body)
  returning id into v_id;

  return v_id;
end $fn$;

comment on function public.record_task_action(uuid, uuid, text, text, text, text, jsonb) is
  'Record an action taken from a task''s Tools tab. Today p_kind is ''email'' only. The actor is stamped from the session and never accepted as a parameter. p_body is an optional document on a NARROWER node list than a post''s: no mention, entity, image or attachment. Nothing is sent by this function — it records what a person did.';

revoke all on function public.record_task_action(uuid, uuid, text, text, text, text, jsonb) from public, anon;
grant execute on function public.record_task_action(uuid, uuid, text, text, text, text, jsonb) to authenticated;

-- The actor's NAME comes from staff_directory, not staff_users: identity is
-- readable by every active staff member while the base table is not, so a
-- record can name whoever took the action even after they leave.
create or replace view public.workflow_task_actions_summary
  with (security_invoker = true) as
select a.id, a.workflow_id, a.task_id, a.kind, a.actor_staff_id,
       sd.full_name as actor_name,
       a.recipient, a.sender, a.subject, a.body, a.body_text, a.occurred_at
  from public.workflow_task_actions a
  left join public.staff_directory sd on sd.id = a.actor_staff_id;

revoke all on public.workflow_task_actions_summary from authenticated;
grant select on public.workflow_task_actions_summary to authenticated;
revoke all on public.workflow_task_actions_summary from anon;

comment on view public.workflow_task_actions_summary is
  'A task''s recorded actions with the actor named. security_invoker, so RLS on workflow_task_actions — and through it the workflow''s — decides. Behind the task panel''s History tab.';
