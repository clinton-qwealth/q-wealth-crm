-- An account can be deleted, unless a feed maintains it (19 Sep 2026)
--
-- The account drawer gains a Delete button, and this is the database's half of
-- it: one function the app calls, and one rule on the table that binds every
-- other path too.
--
-- WHY A HARD DELETE. Every child of an account already knows what to do when
-- the parent goes: owners, valuations, allocations and posts are ON DELETE
-- CASCADE, and a policy held inside the account keeps itself and drops the link
-- (held_in_account_id is ON DELETE SET NULL, and that table is audited, so the
-- unlink is recorded). The deferred owner guard `enforce_account_owner_remains`
-- returns early when the parent no longer exists, which is precisely what lets
-- the cascade reach COMMIT. Nothing in `ingest` holds an account id at rest. A
-- hard delete is therefore referentially clean today, and this migration adds
-- no cascade of its own.
--
-- WHY FED ACCOUNTS ARE REFUSED. `ingest.promote_hub24` and `promote_netwealth`
-- find the CRM account by (provider_party_id, account_number) on every run.
-- Delete the account and the next run does not error and does not recreate it:
-- every landing row for that number flips to `unmatched` with promoted_at
-- reset, and is retried EVERY RUN, FOREVER, until somebody recreates an account
-- with the same number — at which point the whole history back-fills and the
-- label is re-seeded from the provider's string. A fed account is the
-- provider's to close, and `ingest.close_if_active()` is how that reaches here.
--
-- WHY THE REFUSAL IS A TRIGGER AND NOT A CHECK INSIDE THE FUNCTION. Deletes are
-- already permitted by RLS — `accounts_delete for delete to authenticated using
-- (staff_can_access_account(id))` has existed since 1 September, with the table
-- privilege granted — so a PostgREST DELETE, the MCP and psql can all remove an
-- account without ever calling the function below. Clinton chose to keep that
-- access rule ("anyone who can see the account"). So the one rule that is NEW,
-- the provider rule, goes on the table, where all of those paths meet, and the
-- function stays `security invoker` like every other write RPC here.
--
-- NO ELEVATED BYPASS ON THE TRIGGER, DELIBERATELY. `is_elevated_context()` is
-- not consulted: a psql session as postgres is refused too. A fed account that
-- genuinely must go is a migration that disables this trigger, deletes, and
-- re-enables it — the same posture `audit_log`'s append-only trigger takes.
--
-- THE AUDIT RECORD IS THE ONE THAT ALREADY EXISTS. `trg_financial_accounts_audit`
-- fires AFTER DELETE and `record_audit()` stores the WHOLE old row as old_data
-- — label, number, provider, status, who created it — with actor_staff_id,
-- actor_auth_user_id and actor_context. The cascaded owners are audited under
-- the account's id (`record_audit('account_id', '')`), so the owner set is
-- reconstructible; hand-entered valuations are audited on delete; the policy
-- unlink is audited as an update. Only the posts go unrecorded, and posts are
-- unrecorded on every path, by that table's own design. A second writer into
-- audit_log was considered and refused: the table's comment says record_audit()
-- is its only writer, and keeping that true is worth more than a summary row.
--
-- An account with no provider can hold no `source = 'integration'` valuation —
-- the promoters match on provider_party_id — so the "feed valuations are
-- excluded from audit" rule never applies to an account this can delete.

-- ---------------------------------------------------------------------------
-- 1. The guard, on the table, so it binds every path
-- ---------------------------------------------------------------------------

create or replace function public.refuse_delete_of_fed_account()
returns trigger
language plpgsql
set search_path to ''
as $fn$
declare
  v_provider text;
begin
  if old.provider_party_id is null then
    return old;
  end if;
  select p.display_name into v_provider
    from public.parties p
   where p.id = old.provider_party_id;
  raise exception
    'This account is maintained by the % feed, so it cannot be deleted here. Close it at the provider instead.',
    coalesce(v_provider, 'provider');
end $fn$;

comment on function public.refuse_delete_of_fed_account() is
  'BEFORE DELETE guard on financial_accounts: refuses any account with a provider_party_id, naming the provider. A fed account is closed by its provider (ingest.close_if_active), never deleted here — deleting it would leave its landing rows re-queued as unmatched on every run. No elevated-context bypass; disable the trigger in a migration if one must ever go. Added 19 Sep 2026.';

create trigger trg_financial_accounts_refuse_fed_delete
  before delete on public.financial_accounts
  for each row execute function public.refuse_delete_of_fed_account();

comment on trigger trg_financial_accounts_refuse_fed_delete on public.financial_accounts is
  'The provider rule for deletes, on the table so a PostgREST DELETE, the MCP, psql and delete_financial_account() all get one sentence from one place. Deliberately no is_elevated_context() bypass.';

-- Trigger functions are run by the system on the table owner''s behalf; no role
-- needs EXECUTE, and none gets it.
revoke all on function public.refuse_delete_of_fed_account() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. The one write path the app uses
-- ---------------------------------------------------------------------------

create or replace function public.delete_financial_account(p_account_id uuid)
returns void
language plpgsql
security invoker
set search_path to ''
as $fn$
declare
  v_rows int;
begin
  if public.current_staff_id() is null then
    raise exception 'Not an active staff member';
  end if;

  -- This read goes through RLS, so an account outside the caller's access
  -- matches nothing and is refused with a sentence — rather than a zero-row
  -- DELETE reported as success, which is the 11 September lesson.
  if not exists (select 1 from public.financial_accounts a where a.id = p_account_id) then
    raise exception 'No such account, or not one you have access to';
  end if;

  -- The provider rule is NOT repeated here: the BEFORE DELETE trigger raises
  -- it, and one sentence in one place is the point of putting it on the table.
  delete from public.financial_accounts a where a.id = p_account_id;

  get diagnostics v_rows = row_count;
  if v_rows = 0 then
    raise exception 'You do not have permission to delete this account';
  end if;
end $fn$;

comment on function public.delete_financial_account(uuid) is
  'Hard-deletes an account the caller can access, cascading to its owners, valuations, allocations and activity posts; a policy held inside it is kept and unlinked. Refused by trg_financial_accounts_refuse_fed_delete for any account with a provider. The record is the AFTER DELETE row trg_financial_accounts_audit already writes, with the whole old row and who did it. The word the user types to confirm is an arming gate in the UI and is not sent here. Added 19 Sep 2026.';

-- Load-bearing, not boilerplate: revoking from anon alone is not enough.
revoke all on function public.delete_financial_account(uuid) from public, anon;
grant execute on function public.delete_financial_account(uuid) to authenticated;
