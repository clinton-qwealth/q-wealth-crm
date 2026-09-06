-- Write paths for workflows and the note-to-workflow link (6 Sep 2026)

-- ---------------------------------------------------------------------------
-- Starting a workflow
-- ---------------------------------------------------------------------------
create or replace function public.create_workflow(
  p_group_id      uuid,
  p_workflow_type public.workflow_type,
  p_name          text,
  p_status        public.workflow_status default 'in_progress',
  p_owner_staff_id uuid default null
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
  if p_group_id is null then
    raise exception 'A workflow belongs to a client group';
  end if;
  if length(trim(coalesce(p_name, ''))) = 0 then
    raise exception 'Give the workflow a name';
  end if;

  insert into public.workflows
    (group_id, workflow_type, name, status, owner_staff_id, created_by_staff_id, started_at)
  values
    (p_group_id, p_workflow_type, trim(p_name), p_status,
     coalesce(p_owner_staff_id, v_staff), v_staff,
     -- Planned work has no start date until it starts. Anything else is
     -- under way the moment it is created.
     case when p_status = 'not_started' then null else now() end)
  returning id into v_id;

  return v_id;
end $fn$;

revoke all on function public.create_workflow(uuid, public.workflow_type, text, public.workflow_status, uuid)
  from public, anon;
grant execute on function public.create_workflow(uuid, public.workflow_type, text, public.workflow_status, uuid)
  to authenticated;

-- ---------------------------------------------------------------------------
-- Attaching a note to a workflow, or detaching it
-- ---------------------------------------------------------------------------
create or replace function public.set_note_workflow(
  p_note_id     uuid,
  p_workflow_id uuid
) returns void
language plpgsql
security invoker
set search_path to ''
as $fn$
declare
  v_group uuid;
begin
  if public.current_staff_id() is null then
    raise exception 'Not an active staff member';
  end if;

  if p_workflow_id is not null then
    -- Read the workflow through RLS, so a workflow the caller cannot see does
    -- not exist as far as this function is concerned.
    select w.group_id into v_group
      from public.workflows w where w.id = p_workflow_id;
    if v_group is null then
      raise exception 'No such workflow, or not within your access';
    end if;

    -- A note and the work it belongs to must concern the same group. Without
    -- this, one household's file note could be filed under another household's
    -- annual review — which reads as a fact about the wrong client and would
    -- not look wrong on either screen.
    if not exists (
      select 1
        from public.note_subjects ns
       where ns.note_id = p_note_id
         and (
           ns.group_id = v_group
           or exists (
             select 1 from public.client_group_members m
              where m.group_id = v_group
                and m.party_id = ns.party_id
                and m.end_date is null
           )
         )
    ) then
      raise exception 'That note is not about the workflow''s client group';
    end if;
  end if;

  update public.notes set workflow_id = p_workflow_id where id = p_note_id;
  if not found then
    raise exception 'No such note, or not within your access';
  end if;
end $fn$;

revoke all on function public.set_note_workflow(uuid, uuid) from public, anon;
grant execute on function public.set_note_workflow(uuid, uuid) to authenticated;

comment on function public.set_note_workflow is
  'Attach a note to a workflow, or pass null to detach. Both must concern the same client group. The only column of a note that may change besides match_status.';

-- ---------------------------------------------------------------------------
-- Note creation gains the workflow
-- ---------------------------------------------------------------------------
-- Dropped and recreated rather than replaced: a seventh parameter makes a new
-- signature, so create-or-replace would leave two overloads behind and
-- PostgREST refuses an ambiguous call. Every caller names its arguments, so
-- adding a defaulted parameter at the end changes nothing for them.
drop function if exists public.create_note_with_subjects(text, uuid[], uuid, text, public.note_type, timestamptz);

create or replace function public.create_note_with_subjects(
  p_body        text,
  p_party_ids   uuid[] default null,
  p_group_id    uuid default null,
  p_title       text default null,
  p_note_type   public.note_type default 'file_note',
  p_occurred_at timestamptz default null,
  p_workflow_id uuid default null
) returns uuid
language plpgsql
security invoker
set search_path to ''
as $fn$
declare
  v_note  uuid;
  v_staff uuid := public.current_staff_id();
  v_party uuid;
begin
  if v_staff is null then
    raise exception 'Not an active staff member';
  end if;
  if (p_party_ids is null or cardinality(p_party_ids) = 0) and p_group_id is null then
    raise exception 'A note must be about someone: provide party_ids and/or group_id';
  end if;
  if length(trim(coalesce(p_body, ''))) = 0 then
    raise exception 'A note needs something in it';
  end if;

  insert into public.notes (body, title, note_type, occurred_at, author_staff_id, source)
  values (p_body, p_title, p_note_type, coalesce(p_occurred_at, now()), v_staff, 'manual')
  returning id into v_note;

  if p_party_ids is not null then
    foreach v_party in array p_party_ids loop
      insert into public.note_subjects (note_id, party_id) values (v_note, v_party);
    end loop;
  end if;
  if p_group_id is not null then
    insert into public.note_subjects (note_id, group_id) values (v_note, p_group_id);
  end if;

  -- Set through the same function the pill uses, so the same-group rule is
  -- enforced once. The subjects above are already inserted, which is what that
  -- rule reads.
  if p_workflow_id is not null then
    perform public.set_note_workflow(v_note, p_workflow_id);
  end if;

  return v_note;
end $fn$;

revoke all on function public.create_note_with_subjects(text, uuid[], uuid, text, public.note_type, timestamptz, uuid)
  from public, anon;
grant execute on function public.create_note_with_subjects(text, uuid[], uuid, text, public.note_type, timestamptz, uuid)
  to authenticated;
