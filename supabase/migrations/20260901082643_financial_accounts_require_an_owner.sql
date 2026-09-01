-- Every financial account must have at least one owner (1 Sep 2026)
--
-- Found in testing: an account with no owners is visible only to whoever created
-- it. The SELECT policy grants access via the creator clause or via an owner the
-- caller can reach, so with no owners the only route is the creator — and once
-- that staff member goes inactive, the account is invisible to the whole firm.
-- An asset record nobody can see is worse than one that was never created.
--
-- create_financial_account() already refuses zero owners, but a direct INSERT
-- bypasses it, so the rule belongs in the database.
--
-- DEFERRABLE INITIALLY DEFERRED is what makes this workable: the account row must
-- exist before its owners can reference it, so the check has to run at COMMIT.
--
-- Deliberately NO elevated-context bypass. Unlike the append-only triggers, this
-- is a data-integrity rule rather than an access rule.

create or replace function public.enforce_account_has_owner()
returns trigger language plpgsql set search_path to ''
as $fn$
begin
  if not exists (select 1 from public.financial_account_owners o where o.account_id = new.id) then
    raise exception 'A financial account must have at least one owner (account %)', new.id;
  end if;
  return null;
end
$fn$;

create or replace function public.enforce_account_owner_remains()
returns trigger language plpgsql set search_path to ''
as $fn$
begin
  if not exists (select 1 from public.financial_accounts a where a.id = old.account_id) then
    return null;
  end if;
  if not exists (select 1 from public.financial_account_owners o where o.account_id = old.account_id) then
    raise exception 'A financial account must keep at least one owner (account %). Add another owner before removing this one, or close the account.', old.account_id;
  end if;
  return null;
end
$fn$;

create constraint trigger trg_financial_accounts_owner_required
  after insert on public.financial_accounts
  deferrable initially deferred
  for each row execute function public.enforce_account_has_owner();

create constraint trigger trg_financial_account_owners_last_owner
  after delete on public.financial_account_owners
  deferrable initially deferred
  for each row execute function public.enforce_account_owner_remains();

revoke all on function public.enforce_account_has_owner() from public, anon, authenticated;
revoke all on function public.enforce_account_owner_remains() from public, anon, authenticated;
