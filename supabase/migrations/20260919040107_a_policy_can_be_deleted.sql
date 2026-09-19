-- A policy can be deleted (19 Sep 2026)
--
-- The insurance-policy drawer gets the account drawer's Delete button, and
-- this is its function — `delete_financial_account()` of the same morning,
-- with one thing missing on purpose.
--
-- NO PROVIDER RULE, BECAUSE NO FEED MAINTAINS A POLICY. An account's provider
-- is a feed that rewrites the account every night and would re-queue a deleted
-- number as unmatched forever, which is why accounts carry a BEFORE DELETE
-- trigger. A policy's provider_party_id is the insurer, set by hand when the
-- policy was entered, and nothing in `ingest` knows a policy exists (no column
-- outside `public` names one — checked). So the rule that would refuse a
-- policy delete does not exist, and this migration does not invent one.
--
-- WHY A HARD DELETE IS CLEAN HERE TOO. All three children cascade: parties,
-- covers, and since this morning the policy's posts. The deferred guard on
-- parties, `enforce_policy_parties_remain`, returns early when the parent is
-- gone — it says so in its own comment, and names the account guard as its
-- model — so the cascade reaches COMMIT. Nothing else references a policy.
--
-- THE AUDIT RECORD IS THE ONE THAT ALREADY EXISTS. `trg_insurance_policies_audit`
-- fires on delete with the whole old row and who did it, and the parties are
-- audited under their own trigger. Covers are unaudited by design, as
-- allocations are on an account, and posts are unaudited on every path.
--
-- Access is the existing RLS rule — `policies_delete using
-- (staff_can_access_policy(id))` — which is "anyone who can see it", the same
-- answer Clinton gave for accounts. The function stays `security invoker`.

create or replace function public.delete_insurance_policy(p_policy_id uuid)
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

  -- Through RLS, so a policy outside the caller's access is a sentence rather
  -- than a zero-row DELETE reported as success.
  if not exists (select 1 from public.insurance_policies p where p.id = p_policy_id) then
    raise exception 'No such policy, or not one you have access to';
  end if;

  delete from public.insurance_policies p where p.id = p_policy_id;

  get diagnostics v_rows = row_count;
  if v_rows = 0 then
    raise exception 'You do not have permission to delete this policy';
  end if;
end $fn$;

comment on function public.delete_insurance_policy(uuid) is
  'Hard-deletes a policy the caller can access, cascading to its parties, covers and activity posts. No provider rule: no feed maintains a policy. The record is the AFTER DELETE row trg_insurance_policies_audit already writes, with the whole old row and who did it. The word the user types to confirm is an arming gate in the UI and is not sent here. Added 19 Sep 2026.';

revoke all on function public.delete_insurance_policy(uuid) from public, anon;
grant execute on function public.delete_insurance_policy(uuid) to authenticated;
