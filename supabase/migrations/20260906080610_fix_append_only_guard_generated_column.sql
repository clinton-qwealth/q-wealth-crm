-- Correction to the append-only guard rewritten earlier today (6 Sep 2026)
--
-- The rewrite compared whole rows as jsonb so that a column added in future
-- would be immutable by default. It refused every update, including the
-- workflow_id change it was written to allow.
--
-- The cause: notes.search_tsv is GENERATED ALWAYS ... STORED, and a generated
-- column is computed AFTER before-triggers run. So NEW.search_tsv is null
-- inside this trigger while OLD.search_tsv holds the stored value, and the two
-- rows never compare equal.
--
-- The old column-by-column version could not hit this, because it simply never
-- mentioned search_tsv. Comparing everything is still the right shape — it is
-- what makes a future column safe by default — so the fix is to exclude the
-- columns a client cannot write at all, and say why.
--
-- Worth recording: this failed immediately and loudly the first time the new
-- path ran. The comparison being too STRICT is the safe direction for an
-- append-only table to be wrong in.
create or replace function public.enforce_note_append_only()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  -- May change.
  --   match_status: filing an unmatched integration note against its subjects.
  --   workflow_id:  attaching a note to a piece of work, or detaching it.
  v_mutable text[] := array['match_status', 'workflow_id'];

  -- Cannot be compared, because they are not yet computed when this runs.
  -- Postgres refuses a direct write to a generated column, so leaving them out
  -- of the comparison opens nothing: there is no statement a client could send
  -- that changes search_tsv other than by changing a column it is derived from,
  -- and those columns ARE compared.
  --
  -- If another generated column is ever added to notes, every update will start
  -- failing until it is named here. That is the failure this trigger should
  -- have.
  v_generated text[] := array['search_tsv'];
begin
  if public.is_elevated_context() then
    return coalesce(new, old);
  end if;

  if tg_op = 'DELETE' then
    raise exception 'Notes are append-only: deletes are not permitted. Add a correcting note instead.';
  end if;

  if tg_table_name = 'notes'
     and (to_jsonb(new) - v_mutable - v_generated)
       = (to_jsonb(old) - v_mutable - v_generated)
  then
    return new;
  end if;

  raise exception
    'Notes are append-only: only % may change. Add a correcting note instead.',
    array_to_string(v_mutable, ' and ');
end;
$$;

revoke all on function public.enforce_note_append_only() from public, anon, authenticated;
