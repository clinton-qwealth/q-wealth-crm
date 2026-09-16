-- A policy keeps its owner and its life insured (16 Sep 2026)
--
-- Written BEFORE the write path that would expose the gap, not after.
--
-- `insurance_policies` has been guarded since 2 September by
-- `trg_insurance_policies_parties_required` — which fires `after insert on
-- insurance_policies` and nothing else. `insurance_policy_parties` itself has
-- NO TRIGGERS AT ALL: no guard, no audit. Confirmed against pg_trigger on
-- production, not inferred.
--
-- So `delete from insurance_policy_parties` has always been free to leave a
-- policy with no owner, or no life insured, or no parties whatever. It has
-- never mattered for one reason: no write path has ever removed a party row.
-- `create_insurance_policy()` only inserts. The account-detail drawer's
-- `update_insurance_policy_patch()` is the first thing in this system that can
-- take a party off a policy, and it lands two migrations from now.
--
-- The asymmetry is the tell. `financial_account_owners` carries BOTH a deferred
-- last-owner guard AND an audit trigger. Its insurance counterpart carries
-- neither, because accounts were built first and the second table was written
-- from the first's shape rather than from its rules.
--
-- Three things, then, all of them closing gaps rather than adding features:
--   1. the delete-side guard, mirroring enforce_account_owner_remains;
--   2. audit triggers on the two insurance tables an adviser can now edit;
--   3. the not-blank check on financial_accounts.label, which insurance_policies
--      has had since the day it was created and accounts never did.

-- ---------------------------------------------------------------------------
-- 1. A party may leave a policy; the last of its kind may not
-- ---------------------------------------------------------------------------

create or replace function public.enforce_policy_parties_remain()
returns trigger
language plpgsql
set search_path to ''
as $fn$
begin
  -- The policy itself may have been deleted, cascading its parties away. There
  -- is nothing left to protect in that case — the same first guard
  -- enforce_account_owner_remains carries, and for the same reason.
  if not exists (select 1 from public.insurance_policies p where p.id = old.policy_id) then
    return null;
  end if;

  if not exists (
    select 1 from public.insurance_policy_parties pp
     where pp.policy_id = old.policy_id and pp.role = 'owner'
  ) then
    raise exception 'An insurance policy must keep at least one owner (policy %). Name another owner before removing this one.', old.policy_id;
  end if;

  if not exists (
    select 1 from public.insurance_policy_parties pp
     where pp.policy_id = old.policy_id and pp.role = 'life_insured'
  ) then
    raise exception 'An insurance policy must keep at least one life insured (policy %). Name another before removing this one.', old.policy_id;
  end if;

  return null;
end $fn$;

comment on function public.enforce_policy_parties_remain() is
  'Refuses a delete that would leave a policy with no owner or no life insured. DEFERRED, because the patch function removes departing parties and inserts arriving ones in one transaction and the state between them is legitimately empty. Added 16 Sep 2026: the insert side has been guarded since July, the delete side never was, because nothing could delete.';

-- DEFERRABLE INITIALLY DEFERRED, so the check runs at COMMIT and sees the final
-- state. An IMMEDIATE trigger here would refuse the ordinary case — swapping one
-- owner for another — because it would fire between the delete and the insert.
create constraint trigger trg_insurance_policy_parties_last_role
  after delete on public.insurance_policy_parties
  deferrable initially deferred
  for each row execute function public.enforce_policy_parties_remain();

revoke all on function public.enforce_policy_parties_remain() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. The audit trail reaches the two insurance tables a person can now edit
-- ---------------------------------------------------------------------------

-- Neither table has ever been audited. That was defensible while the only write
-- path was a create — the row's own created_at said when, and nothing could
-- change afterwards. From two migrations hence an adviser can rename a policy
-- and move its parties around, which is exactly a who-changed-what event, and
-- the accounts side has recorded the same events since 1 September.
--
-- NOT insurance_policy_covers. Nothing in this change writes a cover, and
-- whether to audit amounts that are transcribed from a schedule is its own
-- decision with its own volume argument. An unused trigger is a claim the
-- trail covers something it does not.
create trigger trg_insurance_policies_audit
  after insert or update or delete on public.insurance_policies
  for each row execute function public.record_audit('id', '');

-- The record id is the POLICY, not the composite key: a party row is only ever
-- read as part of its policy, and audit_log.record_id is a single uuid. The
-- same call financial_account_owners makes with account_id.
create trigger trg_insurance_policy_parties_audit
  after insert or update or delete on public.insurance_policy_parties
  for each row execute function public.record_audit('policy_id', '');

-- ---------------------------------------------------------------------------
-- 3. An account's name may not be blank
-- ---------------------------------------------------------------------------

-- `insurance_policies.label` has carried insurance_policies_label_not_blank
-- since 2 September; `financial_accounts.label` is `not null` and nothing more,
-- so a single space has always been a legal account name.
-- `create_financial_account()` guards it, which is why production holds none —
-- checked before writing this, zero rows — but a guard in one function is not a
-- rule, and the patch function about to be written would need its own copy.
alter table public.financial_accounts
  add constraint financial_accounts_label_not_blank check (length(trim(label)) > 0);
