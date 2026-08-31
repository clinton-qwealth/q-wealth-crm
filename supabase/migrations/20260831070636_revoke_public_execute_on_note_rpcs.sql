-- Remove PUBLIC execute from the note RPCs (31 Aug 2026)
--
-- note_rpcs_and_attachment_correction_window did:
--
--     revoke all on function ... from anon;
--     grant execute on function ... to authenticated;
--
-- which is not enough. Postgres grants EXECUTE to PUBLIC by default on every new
-- function, and anon inherits PUBLIC, so both RPCs remained callable by an
-- unauthenticated request holding only the publishable key. This is the same trap
-- already fixed for the trigger functions in revoke_trigger_functions_from_public;
-- these two were written earlier and missed.
--
-- Neither was exploitable: both are SECURITY INVOKER, so create_note_with_subjects
-- fails at `current_staff_id() is null` and file_unmatched_note finds no note under
-- anon's RLS. But an unauthenticated caller should not reach them at all.
--
-- Every other function in the schema was checked and is already clean.

revoke all on function
  public.create_note_with_subjects(text, uuid[], uuid, text, public.note_type, timestamptz)
  from public, anon;

revoke all on function
  public.file_unmatched_note(uuid, uuid[], uuid)
  from public, anon;

grant execute on function
  public.create_note_with_subjects(text, uuid[], uuid, text, public.note_type, timestamptz)
  to authenticated;

grant execute on function
  public.file_unmatched_note(uuid, uuid[], uuid)
  to authenticated;
