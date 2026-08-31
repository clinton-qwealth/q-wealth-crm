-- Atomic note writes, and a correction window for attachments (31 Aug 2026)
--
-- 1. add_note and file_note_to_client each performed two separate statements from
--    the MCP server, so a failure between them left a half-written record. Both
--    are now single functions: one statement, one transaction, all or nothing.
--    SECURITY INVOKER deliberately - RLS must still evaluate as the caller.
--
-- 2. note_attachments had no INSERT policy at all, so nothing could attach
--    anything except the integration webhook (which runs elevated and bypasses
--    RLS). Staff may now attach, and may remove their own attachment within a
--    24-hour correction window. The window length is an implementation choice:
--    notes have no draft/final state to hang "before finalising" on.

create or replace function public.create_note_with_subjects(
  p_body        text,
  p_party_ids   uuid[]            default null,
  p_group_id    uuid              default null,
  p_title       text              default null,
  p_note_type   public.note_type  default 'file_note',
  p_occurred_at timestamptz       default null
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

  return v_note;
end
$fn$;

comment on function public.create_note_with_subjects is
  'Creates a file note and files it against its subjects in one transaction. SECURITY INVOKER: every RLS policy still applies to the caller.';

create or replace function public.file_unmatched_note(
  p_note_id   uuid,
  p_party_ids uuid[] default null,
  p_group_id  uuid   default null
) returns uuid
language plpgsql
security invoker
set search_path to ''
as $fn$
declare
  v_status public.note_match_status;
  v_party  uuid;
begin
  if (p_party_ids is null or cardinality(p_party_ids) = 0) and p_group_id is null then
    raise exception 'A note must be filed against someone: provide party_ids and/or group_id';
  end if;

  select match_status into v_status from public.notes where id = p_note_id;
  if not found then
    raise exception 'Note not found, or not within your visibility';
  end if;
  if v_status <> 'unmatched' then
    raise exception 'That note is already filed. Notes are append-only - add a follow-up note instead.';
  end if;

  -- Subjects before the status flip: while unmatched, access comes from being
  -- the meeting host or holding file_unmatched_notes; once matched it derives
  -- from the subjects. Flipping first would drop the caller's own access.
  if p_party_ids is not null then
    foreach v_party in array p_party_ids loop
      insert into public.note_subjects (note_id, party_id) values (p_note_id, v_party);
    end loop;
  end if;
  if p_group_id is not null then
    insert into public.note_subjects (note_id, group_id) values (p_note_id, p_group_id);
  end if;

  update public.notes set match_status = 'matched' where id = p_note_id;

  return p_note_id;
end
$fn$;

comment on function public.file_unmatched_note is
  'Files an unmatched integration note against its subjects and marks it matched, in one transaction. SECURITY INVOKER.';

revoke all on function public.create_note_with_subjects(text, uuid[], uuid, text, public.note_type, timestamptz) from anon;
revoke all on function public.file_unmatched_note(uuid, uuid[], uuid) from anon;
grant execute on function public.create_note_with_subjects(text, uuid[], uuid, text, public.note_type, timestamptz) to authenticated;
grant execute on function public.file_unmatched_note(uuid, uuid[], uuid) to authenticated;

alter table public.note_attachments
  add column if not exists uploaded_by_staff_id uuid references public.staff_users(id);

comment on column public.note_attachments.uploaded_by_staff_id is
  'Staff member who attached this. Null for integration uploads (webhook, elevated context). Only this person may remove it, and only within the correction window.';

drop trigger if exists trg_note_attachments_append_only on public.note_attachments;

create or replace function public.enforce_attachment_mutability()
returns trigger
language plpgsql
set search_path to ''
as $fn$
begin
  if public.is_elevated_context() then
    return coalesce(new, old);
  end if;

  if tg_op = 'UPDATE' then
    raise exception 'Attachments cannot be modified in place. Remove and re-add within the correction window, or add a follow-up note.';
  end if;

  if tg_op = 'DELETE' then
    if old.uploaded_by_staff_id is distinct from public.current_staff_id() then
      raise exception 'Only the staff member who added an attachment may remove it.';
    end if;
    if old.created_at <= now() - interval '24 hours' then
      raise exception 'The 24-hour correction window for this attachment has closed. Add a follow-up note instead.';
    end if;
    return old;
  end if;

  return new;
end
$fn$;

create trigger trg_note_attachments_mutability
  before update or delete on public.note_attachments
  for each row execute function public.enforce_attachment_mutability();

create policy note_attachments_insert on public.note_attachments
  for insert to authenticated
  with check (
    public.staff_can_access_note(note_id)
    and uploaded_by_staff_id = public.current_staff_id()
  );

create policy note_attachments_delete on public.note_attachments
  for delete to authenticated
  using (
    uploaded_by_staff_id = public.current_staff_id()
    and created_at > now() - interval '24 hours'
  );
