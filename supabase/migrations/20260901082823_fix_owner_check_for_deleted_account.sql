-- Fix: the owner requirement fired on accounts deleted in the same transaction
-- (1 Sep 2026)
--
-- enforce_account_has_owner() is a DEFERRED constraint trigger, so its check runs
-- at COMMIT. If an account was created and then deleted within the same
-- transaction, the queued check still ran, found no owners for a row that no
-- longer existed, and aborted the transaction.
--
-- Realistic path: a create wizard the user cancels, or a correction that removes
-- a mis-entered account before committing. The owner-removal trigger already had
-- this guard; the insert trigger was missing it.

create or replace function public.enforce_account_has_owner()
returns trigger language plpgsql set search_path to ''
as $fn$
begin
  -- Created and removed inside the same transaction: nothing left to protect.
  if not exists (select 1 from public.financial_accounts a where a.id = new.id) then
    return null;
  end if;

  if not exists (select 1 from public.financial_account_owners o where o.account_id = new.id) then
    raise exception 'A financial account must have at least one owner (account %)', new.id;
  end if;
  return null;
end
$fn$;

revoke all on function public.enforce_account_has_owner() from public, anon, authenticated;
