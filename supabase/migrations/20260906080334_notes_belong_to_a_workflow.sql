-- A note can name the workflow it belongs to (6 Sep 2026)

alter table public.notes
  add column if not exists workflow_id uuid references public.workflows(id) on delete set null;

create index if not exists notes_workflow_idx on public.notes (workflow_id)
  where workflow_id is not null;

comment on column public.notes.workflow_id is
  'The workflow this note belongs to, if any. Nullable: most notes are not part of a piece of work, and a note written before a workflow existed can be attached later. ON DELETE SET NULL because losing the link must never lose the note.';

-- ---------------------------------------------------------------------------
-- The append-only guard, inverted
-- ---------------------------------------------------------------------------
-- The previous version listed every column that had to stay UNCHANGED and
-- allowed the update if they all matched. That is the wrong way round for an
-- append-only table: a column added later is not in the list, so it is
-- permitted to change by default. workflow_id would have been mutable the
-- moment it was added, with nothing saying so.
--
-- It now names the columns that MAY change and requires everything else to be
-- identical, compared as jsonb so the check covers columns that do not exist
-- yet. A future column is immutable until somebody deliberately adds it here.
create or replace function public.enforce_note_append_only()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  -- match_status: filing an unmatched integration note against its subjects.
  -- workflow_id:  attaching a note to a piece of work, or detaching it.
  v_mutable text[] := array['match_status', 'workflow_id'];
begin
  if public.is_elevated_context() then
    return coalesce(new, old);
  end if;

  if tg_op = 'DELETE' then
    raise exception 'Notes are append-only: deletes are not permitted. Add a correcting note instead.';
  end if;

  if tg_table_name = 'notes'
     and (to_jsonb(new) - v_mutable) = (to_jsonb(old) - v_mutable)
  then
    return new;
  end if;

  raise exception
    'Notes are append-only: only % may change. Add a correcting note instead.',
    array_to_string(v_mutable, ' and ');
end;
$$;

-- Postgres grants EXECUTE on every new function to PUBLIC as built-in
-- behaviour, and every role inherits from PUBLIC. Changing the schema's default
-- privileges does not suppress it, so this revoke is load-bearing rather than
-- boilerplate. A trigger function is called by the trigger, never by a client.
revoke all on function public.enforce_note_append_only() from public, anon, authenticated;

comment on function public.enforce_note_append_only is
  'Append-only guard for notes and their children. Names the columns that MAY change and freezes everything else, including columns added in future.';
