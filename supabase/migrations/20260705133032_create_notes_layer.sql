-- Enums
create type public.note_type as enum ('file_note', 'meeting_summary', 'phone_call', 'email_record', 'task_note', 'other');
create type public.note_source as enum ('manual', 'integration');
create type public.note_match_status as enum ('matched', 'unmatched');
create type public.attachment_kind as enum ('recording_audio', 'recording_video', 'document', 'other');

-- notes: append-only spine for file notes, meeting summaries, transcripts
create table public.notes (
  id uuid primary key default gen_random_uuid(),
  note_type public.note_type not null default 'file_note',
  title text,
  body text not null,
  transcript text,
  occurred_at timestamptz not null default now(),
  author_staff_id uuid references public.staff_users (id),
  source public.note_source not null default 'manual',
  source_system text,
  external_ref text,
  match_status public.note_match_status not null default 'matched',
  host_staff_id uuid references public.staff_users (id),
  corrects_note_id uuid references public.notes (id),
  created_at timestamptz not null default now(),
  constraint notes_integration_fields check (
    (source = 'manual' and source_system is null and external_ref is null)
    or (source = 'integration' and source_system is not null and external_ref is not null)
  )
);
comment on table public.notes is 'Append-only file notes, meeting summaries and transcripts. Corrections via follow-up note (corrects_note_id). No updates except match_status; no deletes.';

create unique index notes_external_dedupe on public.notes (source_system, external_ref) where source = 'integration';
create index notes_occurred_idx on public.notes (occurred_at desc);
create index notes_unmatched_idx on public.notes (host_staff_id) where match_status = 'unmatched';

-- full-text search over title + body + transcript
alter table public.notes add column search_tsv tsvector
  generated always as (
    to_tsvector('english', coalesce(title, '') || ' ' || coalesce(body, '') || ' ' || coalesce(transcript, ''))
  ) stored;
create index notes_search_idx on public.notes using gin (search_tsv);

-- note_subjects: what a note is about (parties and/or groups, many allowed)
create table public.note_subjects (
  id uuid primary key default gen_random_uuid(),
  note_id uuid not null references public.notes (id) on delete cascade,
  party_id uuid references public.parties (id) on delete cascade,
  group_id uuid references public.client_groups (id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint note_subjects_one_target check (
    (party_id is not null and group_id is null) or (party_id is null and group_id is not null)
  )
);
create unique index note_subjects_party_unique on public.note_subjects (note_id, party_id) where party_id is not null;
create unique index note_subjects_group_unique on public.note_subjects (note_id, group_id) where group_id is not null;
create index note_subjects_party_idx on public.note_subjects (party_id);
create index note_subjects_group_idx on public.note_subjects (group_id);

-- note_attachments: pointers to files in the private note-media Storage bucket
create table public.note_attachments (
  id uuid primary key default gen_random_uuid(),
  note_id uuid not null references public.notes (id) on delete cascade,
  kind public.attachment_kind not null,
  storage_path text not null unique,
  mime_type text,
  duration_seconds integer,
  file_size_bytes bigint,
  created_at timestamptz not null default now()
);
create index note_attachments_note_idx on public.note_attachments (note_id);

-- Append-only enforcement (belt and braces on top of RLS):
-- UPDATE allowed only when nothing but match_status changes; DELETE always blocked.
-- Elevated contexts (direct admin connection / service_role) are exempt for genuine repairs.
create or replace function public.enforce_note_append_only()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if public.is_elevated_context() then
    return coalesce(new, old);
  end if;
  if tg_op = 'DELETE' then
    raise exception 'Notes are append-only: deletes are not permitted. Add a correcting note instead.';
  end if;
  if tg_table_name = 'notes'
     and new.id = old.id
     and new.note_type = old.note_type
     and new.title is not distinct from old.title
     and new.body = old.body
     and new.transcript is not distinct from old.transcript
     and new.occurred_at = old.occurred_at
     and new.author_staff_id is not distinct from old.author_staff_id
     and new.source = old.source
     and new.source_system is not distinct from old.source_system
     and new.external_ref is not distinct from old.external_ref
     and new.host_staff_id is not distinct from old.host_staff_id
     and new.corrects_note_id is not distinct from old.corrects_note_id
     and new.created_at = old.created_at
  then
    return new; -- only match_status changed (filing an unmatched note)
  end if;
  raise exception 'Notes are append-only: only match_status may change. Add a correcting note instead.';
end;
$$;

create trigger trg_notes_append_only
  before update or delete on public.notes
  for each row execute function public.enforce_note_append_only();
create trigger trg_note_subjects_append_only
  before update or delete on public.note_subjects
  for each row execute function public.enforce_note_append_only();
create trigger trg_note_attachments_append_only
  before update or delete on public.note_attachments
  for each row execute function public.enforce_note_append_only();

-- New permission: who may see & file the unmatched integration queue
alter table public.access_profiles add column file_unmatched_notes boolean not null default false;
update public.access_profiles set file_unmatched_notes = true where name in ('Services', 'Admin');
