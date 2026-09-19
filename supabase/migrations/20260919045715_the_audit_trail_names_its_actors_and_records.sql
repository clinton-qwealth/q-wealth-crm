-- The audit trail names its actors and its records (19 Sep 2026)
--
-- The Administration page gets an Audit trail tab, and this is what it reads.
-- `audit_log` has been written since 26 August by `record_audit()` and read by
-- nobody: no view, no function, no screen. Its rows carry a staff id and a
-- record id, and a screen needs a name and a label.
--
-- ONE VIEW, `audit_entries`, security_invoker over `audit_log`, so the table's
-- own policy — `admin_read_audit_log using (current_staff_has('admin'))` —
-- decides who sees anything. A non-administrator gets zero rows, not an error,
-- and the page above it refuses them before it asks.
--
-- THE ACTOR'S NAME comes from `staff_directory`, as every other summary view
-- takes it (`workflow_task_actions_summary` is the template): identity is
-- readable by every active staff member, includes former staff on purpose,
-- and is the sanctioned name source. NOT a PostgREST embed on `staff_users` —
-- that works for administrators today only because their policy happens to
-- admit them, and a later tightening would blank every name silently.
--
-- THE RECORD'S LABEL is recovered from the trail itself, not joined from the
-- live tables. `record_audit()` keeps the WHOLE row on insert and delete but
-- NARROWS an update to its changed keys, so an update usually carries no
-- label of its own. The view therefore takes the label from this row's payload
-- when it has one, else from the latest EARLIER row on the same record (or its
-- parent, for join tables) that did. That is the name AT THE TIME — a renamed
-- account reads under its old name for the rows before the rename, which is
-- what an audit trail should say — and it survives deletion, because the
-- delete row itself carries the whole record. Rows in the SAME instant may
-- label each other: a record and its join rows are created in one transaction
-- and share one `now()`, and which trigger fired first is not a fact anybody
-- should have to know. Joining twenty-five live tables
-- was considered and refused: it gives the current name, nothing for a deleted
-- record, re-evaluates each table's RLS per row, and defeats the newest-first
-- index scan. The honest limit: an update to a record created before 31 August
-- shows a short id.
--
-- `db_user` is deliberately absent. Inside a SECURITY DEFINER trigger
-- `current_user` is the owner, so every row reads `postgres`; a column that is
-- always the same word is noise.
--
-- The composite index is for the page's cursor: newest first, fifty at a time,
-- keyed on (occurred_at, id) so two rows in the same instant stay stable.

-- ---------------------------------------------------------------------------
-- 1. What a row was called, from the payload the trigger kept
-- ---------------------------------------------------------------------------
-- One key per table, chosen from the live schema on 19 Sep 2026: organisations
-- carry legal_name, note attachments carry no filename (kind is the best
-- there is), a valuation is named by its date.

create or replace function public.audit_record_label(p_table text, p_data jsonb)
returns text
language sql
immutable
set search_path to ''
as $fn$
  select nullif(btrim(case p_table
    when 'parties'                      then p_data->>'display_name'
    when 'persons'                      then concat_ws(' ', p_data->>'first_name', p_data->>'last_name')
    when 'organisations'                then p_data->>'legal_name'
    when 'client_groups'                then p_data->>'name'
    when 'teams'                        then p_data->>'name'
    when 'access_profiles'              then p_data->>'name'
    when 'staff_users'                  then p_data->>'full_name'
    when 'contact_points'               then p_data->>'value'
    when 'party_roles'                  then p_data->>'role'
    when 'party_relationships'          then p_data->>'relationship_type'
    when 'client_group_members'         then p_data->>'member_role'
    when 'client_group_access'          then p_data->>'access_level'
    when 'notes'                        then p_data->>'title'
    when 'financial_accounts'           then p_data->>'label'
    when 'assets_liabilities'           then p_data->>'label'
    when 'insurance_policies'           then p_data->>'label'
    when 'financial_account_valuations' then p_data->>'as_at'
    when 'note_attachments'             then p_data->>'kind'
    when 'workflow_post_media'          then p_data->>'original_name'
    else coalesce(p_data->>'label', p_data->>'name', p_data->>'display_name', p_data->>'title')
  end), '')
$fn$;

comment on function public.audit_record_label(text, jsonb) is
  'The name a row would be known by, read from an audit payload: display_name for a party, label for an account, full_name for a staff member, and so on. Null when the payload has no such key — an UPDATE is narrowed to its changed columns, so that is common. Added 19 Sep 2026 for audit_entries.';

-- ---------------------------------------------------------------------------
-- 2. For a join row, the record worth naming is the parent it was keyed by
-- ---------------------------------------------------------------------------
-- `record_audit('account_id', …)` and friends store the PARENT id on these
-- tables, by design: an owner row is only ever read as part of its account.

create or replace function public.audit_label_table(p_table text)
returns text
language sql
immutable
set search_path to ''
as $fn$
  select case p_table
    when 'persons'                  then 'parties'
    when 'organisations'            then 'parties'
    when 'financial_account_owners' then 'financial_accounts'
    when 'insurance_policy_parties' then 'insurance_policies'
    when 'asset_liability_owners'   then 'assets_liabilities'
    when 'staff_access_assignments' then 'staff_users'
    else p_table
  end
$fn$;

comment on function public.audit_label_table(text) is
  'The table whose rows carry a label for this audited table: itself, or the parent an owner/party/assignment row was keyed by. Added 19 Sep 2026 for audit_entries.';

-- ---------------------------------------------------------------------------
-- 3. The view
-- ---------------------------------------------------------------------------

create or replace view public.audit_entries
with (security_invoker = true) as
select a.id,
       a.occurred_at,
       a.table_name,
       a.record_id,
       a.action,
       a.changed_fields,
       a.old_data,
       a.new_data,
       a.actor_staff_id,
       a.actor_context,
       sd.full_name as actor_name,
       coalesce(
         public.audit_record_label(a.table_name, coalesce(a.new_data, a.old_data)),
         (select public.audit_record_label(b.table_name, coalesce(b.new_data, b.old_data))
            from public.audit_log b
           where b.table_name = public.audit_label_table(a.table_name)
             and b.record_id = a.record_id
             -- `<=` on the instant ALONE, not on (instant, id). Rows written in one
             -- transaction share an instant, and when a policy and its parties are
             -- created together the party rows can carry LOWER ids than the
             -- policy's own row — so a tiebreak on id hid the parent's label from
             -- them. Found on the branch: four party inserts unlabelled, their
             -- deletes labelled. "Earlier or the same transaction" is the rule.
             and b.occurred_at <= a.occurred_at
             and public.audit_record_label(b.table_name, coalesce(b.new_data, b.old_data)) is not null
           order by b.occurred_at desc, b.id desc
           limit 1)
       ) as record_label
  from public.audit_log a
  left join public.staff_directory sd on sd.id = a.actor_staff_id;

comment on view public.audit_entries is
  'audit_log with the actor named from staff_directory and the record labelled from the trail itself — this row''s payload, else the latest earlier row on the same record or its parent that carried a name. security_invoker: admin_read_audit_log on audit_log decides. Newest-first pages read this with a (occurred_at, id) cursor. Added 19 Sep 2026 for the Administration page.';

create index if not exists audit_log_occurred_id_idx
  on public.audit_log (occurred_at desc, id desc);

-- ---------------------------------------------------------------------------
-- 4. Grants
-- ---------------------------------------------------------------------------
-- The view's own grant is select; the table's RLS is the boundary. The two
-- functions are executed by the view as the invoker, so authenticated needs
-- them; anon and public do not.

revoke all on public.audit_entries from public, anon, authenticated;
grant select on public.audit_entries to authenticated;

revoke all on function public.audit_record_label(text, jsonb) from public, anon;
revoke all on function public.audit_label_table(text) from public, anon;
grant execute on function public.audit_record_label(text, jsonb) to authenticated;
grant execute on function public.audit_label_table(text) to authenticated;
