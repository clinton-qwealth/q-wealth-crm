-- Nothing under a household outlives its group (20 Sep 2026)
--
-- Clinton, on seeing the gap recorded in the territories migration: "we will
-- need to look at how we resolve the people and their notes and any other
-- records that fall under the group. **Ideally i want no visibility from the
-- group down. This includes MCP.**"
--
-- So: if you cannot see a household, you cannot see its people, their notes,
-- their accounts, their policies, their assets, or their sensitive fields —
-- through the web app, through Claude, or through a raw PostgREST call, because
-- all three meet the same row-level security.
--
-- ## What was actually leaking, and what was not
--
-- A survey of every path below a household found the surface is SMALL. No policy
-- tests `view_all_groups` directly; every view is `security_invoker`, so none of
-- them bypasses RLS; workflows, tasks and posts already key off
-- `staff_can_access_group`. Three things leaked:
--
--   1. **`staff_can_access_party` short-circuited on `view_all_groups`.** That
--      one line is why a limited person could still reach an assigned
--      household's PEOPLE — and, through them, their accounts, policies, items
--      and notes, since every one of those helpers derives from the party. This
--      is the gap the territories migration wrote down.
--
--   2. **The creator escape hatches were unbounded.** Each record helper let
--      whoever created the row see it forever, whatever happened to the
--      household afterwards. They exist for a real reason — an INSERT ... RETURNING
--      has to be able to read the row back BEFORE its owners exist — but that
--      reason lasts only until the owners are written. Narrowed to exactly that
--      window: creator AND no owners yet. Once a record belongs to somebody, the
--      group decides. (The same for a note and its subjects.)
--
--   3. **The sensitive-field functions never checked access at all.** THIS ONE
--      PREDATES TERRITORIES and is the sharpest of the three:
--      `reveal_sensitive_field` and `set_sensitive_field` asked only for
--      `view_sensitive` and a second factor, so anyone holding that permission
--      could decrypt — or silently overwrite — a tax file number for ANY party
--      in the firm by id, with no group check whatsoever;
--      `get_masked_hint`/`get_masked_hints` answered for any party to any active
--      staff member. Every one of them now asks `staff_can_access_party` first.
--      The reveal was already written to `sensitive_access_log`; a write now is
--      too, so the trail shows the refusal surface as well.
--
-- ## Who this changes today: NOBODY
--
-- All five active staff hold `view_all_groups`, nobody is limited, no household
-- is assigned, and nobody holds the Adviser profile. For a `view_all_groups`
-- holder `staff_can_access_group` still answers true for every household, so
-- every rewritten function returns exactly what it returned yesterday. The
-- closing block asserts that rather than asserting it in a comment.
--
-- The behaviour genuinely changes for two people who do not exist yet: a person
-- with the limit ticked, and an Adviser who created a record for a household
-- they no longer service. Both are the point.
--
-- ## What is deliberately NOT changed
--
-- **A person in no household stays visible to every active staff member**, as
-- they were before territories. That is the same decision as an unassigned
-- household: a prospect nobody has filed anywhere belongs to nobody, so there is
-- no group to inherit a rule from. When loose people get an owner, revisit.
--
-- **The audit trail is not scoped.** `audit_log` is readable by `manage_staff`
-- alone and is a governance record; an administrator who is also limited to a
-- territory can still read entries naming other households. Narrowing the trail
-- is a separate decision about what an audit trail is for, and it is Clinton's
-- to make rather than a side effect of this file.

-- ---------------------------------------------------------------------------
-- 1. A person is reached through their households, full stop
-- ---------------------------------------------------------------------------
-- The `view_all_groups` shortcut is GONE. It is not replaced by a territory
-- check here, because it does not need one: `staff_can_access_group` already
-- answers the whole question — firm-wide sight unless limited and assigned —
-- so deferring to it per household is both correct and the only place that rule
-- is written. For an unlimited person every household answers true, so this
-- returns what it always did.

create or replace function public.staff_can_access_party(p_party_id uuid)
returns boolean
language plpgsql
security definer
stable
set search_path = ''
as $fn$
declare
  v_staff uuid;
begin
  if public.is_elevated_context() then
    return true;
  end if;
  v_staff := public.current_staff_id();
  if v_staff is null then
    return false;
  end if;

  -- Nobody's client yet: a prospect, a referrer, a contact filed on their own.
  -- Visible to every active staff member, exactly as before territories.
  if not exists (
    select 1 from public.client_group_members m
    where m.party_id = p_party_id and m.end_date is null
  ) then
    return true;
  end if;

  -- Otherwise the household decides — and so, through it, does the territory.
  return exists (
    select 1 from public.client_group_members m
    where m.party_id = p_party_id
      and m.end_date is null
      and public.staff_can_access_group(m.group_id)
  );
end;
$fn$;

comment on function public.staff_can_access_party(uuid) is
  'Whether the caller may see a person or organisation. A party in no current household is visible to every active staff member; otherwise access is inherited from the households they belong to, which is what makes territories reach the people under a group. No view_all_groups shortcut since 20 Sep 2026 — staff_can_access_group() answers that, and answering it twice is how the territory rule got bypassed.';

-- ---------------------------------------------------------------------------
-- 2. The creator hatches, narrowed to the moment of creation
-- ---------------------------------------------------------------------------
-- "Creator" stops meaning "forever" and starts meaning "while this row has
-- nobody attached to it yet". That is the only window an INSERT ... RETURNING
-- needs, and the owner sets are written as a DIFF rather than emptied and
-- rebuilt, so an ordinary edit never re-opens it.

create or replace function public.staff_can_access_account(p_account_id uuid)
returns boolean
language plpgsql
security definer
stable
set search_path = ''
as $fn$
declare
  v_staff   uuid;
  v_creator uuid;
begin
  if public.is_elevated_context() then
    return true;
  end if;
  v_staff := public.current_staff_id();
  if v_staff is null then
    return false;
  end if;

  select created_by_staff_id into v_creator
  from public.financial_accounts where id = p_account_id;
  if not found then
    return false;
  end if;

  -- Only until the owners exist: that is the INSERT ... RETURNING window.
  if v_creator = v_staff and not exists (
    select 1 from public.financial_account_owners o where o.account_id = p_account_id
  ) then
    return true;
  end if;

  return exists (
    select 1 from public.financial_account_owners o
    where o.account_id = p_account_id
      and public.staff_can_access_party(o.party_id)
  );
end
$fn$;

create or replace function public.staff_can_access_item(p_item_id uuid)
returns boolean
language plpgsql
security definer
stable
set search_path = ''
as $fn$
declare
  v_staff   uuid;
  v_creator uuid;
begin
  if public.is_elevated_context() then return true; end if;
  v_staff := public.current_staff_id();
  if v_staff is null then return false; end if;
  select created_by_staff_id into v_creator
  from public.assets_liabilities where id = p_item_id;
  if not found then return false; end if;
  if v_creator = v_staff and not exists (
    select 1 from public.asset_liability_owners o where o.item_id = p_item_id
  ) then
    return true;
  end if;
  return exists (
    select 1 from public.asset_liability_owners o
    where o.item_id = p_item_id and public.staff_can_access_party(o.party_id)
  );
end
$fn$;

create or replace function public.staff_can_access_policy(p_policy_id uuid)
returns boolean
language plpgsql
security definer
stable
set search_path = ''
as $fn$
declare
  v_staff uuid;
begin
  if public.is_elevated_context() then
    return true;
  end if;
  v_staff := public.current_staff_id();
  if v_staff is null then
    return false;
  end if;
  if exists (
    select 1 from public.insurance_policies p
    where p.id = p_policy_id and p.created_by_staff_id = v_staff
  ) and not exists (
    select 1 from public.insurance_policy_parties pp where pp.policy_id = p_policy_id
  ) then
    return true;
  end if;
  return exists (
    select 1 from public.insurance_policy_parties pp
    where pp.policy_id = p_policy_id
      and public.staff_can_access_party(pp.party_id)
  );
end
$fn$;

-- A note's AUTHOR is narrowed the same way. An unfiled note has no subjects, so
-- writing one and reading it straight back still works; once it names a client,
-- that client's household decides who may read it. The unmatched arm is
-- untouched: those notes have no subjects by definition and are governed by
-- `file_unmatched_notes` and the host, which is a different question.
create or replace function public.staff_can_access_note(p_note_id uuid)
returns boolean
language plpgsql
security definer
stable
set search_path = ''
as $fn$
declare
  v_staff uuid;
  v_note  record;
begin
  if public.is_elevated_context() then
    return true;
  end if;
  v_staff := public.current_staff_id();
  if v_staff is null then
    return false;
  end if;
  select match_status, author_staff_id, host_staff_id into v_note
  from public.notes where id = p_note_id;
  if not found then
    return false;
  end if;
  if v_note.author_staff_id = v_staff and not exists (
    select 1 from public.note_subjects ns where ns.note_id = p_note_id
  ) then
    return true;
  end if;
  if v_note.match_status = 'unmatched' then
    return v_note.host_staff_id = v_staff or public.current_staff_has('file_unmatched_notes');
  end if;
  return exists (
    select 1 from public.note_subjects ns
    where ns.note_id = p_note_id
      and (
        (ns.party_id is not null and public.staff_can_access_party(ns.party_id))
        or (ns.group_id is not null and public.staff_can_access_group(ns.group_id))
      )
  );
end;
$fn$;

-- ---------------------------------------------------------------------------
-- 2b. The SELECT policies, and the snapshot trap under them
-- ---------------------------------------------------------------------------
-- **Narrowing the helpers alone fixed nothing for reads.** Four SELECT policies
-- inline the rule rather than calling the helper beside them —
-- `created_by_staff_id = current_staff_id() OR EXISTS (… accessible)` — so the
-- unbounded creator escape lived in the policy, where changing a function could
-- not reach it. The UPDATE and DELETE policies on the same tables DO call the
-- helper, which is how the two drifted apart. Found by probe on the branch: the
-- limited persona correctly lost the household, the person, their contact
-- details, their notes and the sensitive hints — and kept the account and the
-- policy.
--
-- **But the inline form was load-bearing, and replacing it outright broke
-- creation.** `staff_can_access_*` is STABLE and re-reads the parent row, so
-- during `INSERT ... RETURNING` it runs against the statement's snapshot, cannot
-- see the row the same statement just inserted, hits `if not found then return
-- false` and refuses the row to its own author. A policy expression has no such
-- problem: it is evaluated against the NEW ROW, so `created_by_staff_id` is
-- simply there. That is why these policies were written this way, and the
-- probe's `[G] CREATION BROKE` is what it costs to find out by other means.
--
-- So the creation window stays INLINE, and is bounded by a definer helper:
--
--   (I made this, and nothing is attached to it yet)  OR  (the normal rule)
--
-- The "nothing attached yet" test cannot be an ordinary `not exists (...)` in
-- the policy either. That subquery is itself subject to the child table's RLS,
-- which hides the very rows it is counting — so for a record whose owners I may
-- not see it would answer "unattached" and hand the creator access forever, the
-- exact hole being closed. A SECURITY DEFINER helper counts them honestly.

create or replace function public.account_has_owners(p_account_id uuid)
returns boolean language sql security definer stable set search_path = '' as $fn$
  select exists (select 1 from public.financial_account_owners o where o.account_id = p_account_id)
$fn$;
create or replace function public.policy_has_parties(p_policy_id uuid)
returns boolean language sql security definer stable set search_path = '' as $fn$
  select exists (select 1 from public.insurance_policy_parties pp where pp.policy_id = p_policy_id)
$fn$;
create or replace function public.item_has_owners(p_item_id uuid)
returns boolean language sql security definer stable set search_path = '' as $fn$
  select exists (select 1 from public.asset_liability_owners o where o.item_id = p_item_id)
$fn$;
create or replace function public.note_has_subjects(p_note_id uuid)
returns boolean language sql security definer stable set search_path = '' as $fn$
  select exists (select 1 from public.note_subjects ns where ns.note_id = p_note_id)
$fn$;

revoke all on function public.account_has_owners(uuid) from public, anon;
revoke all on function public.policy_has_parties(uuid) from public, anon;
revoke all on function public.item_has_owners(uuid) from public, anon;
revoke all on function public.note_has_subjects(uuid) from public, anon;
grant execute on function public.account_has_owners(uuid) to authenticated, service_role;
grant execute on function public.policy_has_parties(uuid) to authenticated, service_role;
grant execute on function public.item_has_owners(uuid) to authenticated, service_role;
grant execute on function public.note_has_subjects(uuid) to authenticated, service_role;

comment on function public.account_has_owners(uuid) is
  'Whether an account has any owners, counted past row-level security. Used by accounts_select to bound the creation window: an ordinary subquery there would be filtered by the owners'' own policy and answer "none" for a record whose owners the caller may not see. Added 20 Sep 2026.';

drop policy notes_select on public.notes;
create policy notes_select on public.notes
  for select to authenticated
  using (
    (author_staff_id = public.current_staff_id() and not public.note_has_subjects(id))
    or public.staff_can_access_note(id)
  );

drop policy accounts_select on public.financial_accounts;
create policy accounts_select on public.financial_accounts
  for select to authenticated
  using (
    (created_by_staff_id = public.current_staff_id() and not public.account_has_owners(id))
    or public.staff_can_access_account(id)
  );

drop policy policies_select on public.insurance_policies;
create policy policies_select on public.insurance_policies
  for select to authenticated
  using (
    (created_by_staff_id = public.current_staff_id() and not public.policy_has_parties(id))
    or public.staff_can_access_policy(id)
  );

drop policy items_select on public.assets_liabilities;
create policy items_select on public.assets_liabilities
  for select to authenticated
  using (
    (created_by_staff_id = public.current_staff_id() and not public.item_has_owners(id))
    or public.staff_can_access_item(id)
  );

-- ---------------------------------------------------------------------------
-- 3. Sensitive fields ask who the party is first
-- ---------------------------------------------------------------------------
-- The permission says WHAT you may do; the group says WHOSE. Both, now.

create or replace function public.reveal_sensitive_field(p_party_id uuid, p_kind public.sensitive_field_kind)
returns text
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_value text;
begin
  if not public.current_staff_has('view_sensitive') then
    raise exception 'Permission denied: view_sensitive required';
  end if;
  -- Said before the second-factor prompt, so somebody is never asked to
  -- authenticate for a record they were never going to be shown.
  if not public.staff_can_access_party(p_party_id) then
    raise exception 'No such client, or not one you have access to';
  end if;
  if not public.has_mfa() then
    raise exception 'Multi-factor authentication required to reveal sensitive fields. Sign in again and complete your authenticator step.';
  end if;

  select extensions.pgp_sym_decrypt(value_encrypted, public.get_sensitive_key())
    into v_value
  from public.party_sensitive_data
  where party_id = p_party_id and field_kind = p_kind;

  if v_value is null then
    return null;
  end if;

  insert into public.sensitive_access_log (party_id, field_kind, action, auth_user_id)
  values (p_party_id, p_kind, 'reveal', (select auth.uid()));

  return v_value;
end;
$fn$;

create or replace function public.set_sensitive_field(p_party_id uuid, p_kind public.sensitive_field_kind, p_value text)
returns void
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  if not public.current_staff_has('view_sensitive') then
    raise exception 'Permission denied: view_sensitive required';
  end if;
  if not public.staff_can_access_party(p_party_id) then
    raise exception 'No such client, or not one you have access to';
  end if;
  if not public.has_mfa() then
    raise exception 'Multi-factor authentication required to change sensitive fields. Sign in again and complete your authenticator step.';
  end if;
  if p_value is null or length(trim(p_value)) = 0 then
    raise exception 'Value must not be empty';
  end if;

  insert into public.party_sensitive_data (party_id, field_kind, value_encrypted, masked_hint)
  values (
    p_party_id,
    p_kind,
    extensions.pgp_sym_encrypt(p_value, public.get_sensitive_key()),
    repeat('•', greatest(length(p_value) - 3, 0)) || right(p_value, 3)
  )
  on conflict (party_id, field_kind)
  do update set
    value_encrypted = excluded.value_encrypted,
    masked_hint = excluded.masked_hint,
    updated_at = now();

  insert into public.sensitive_access_log (party_id, field_kind, action, auth_user_id)
  values (p_party_id, p_kind, 'write', (select auth.uid()));
end;
$fn$;

-- The hints are masked, not secret — but "••••••123 is on file for this person"
-- is still something about a client, and it answered for any party id to any
-- active staff member. Null, now, for a party you cannot see.
create or replace function public.get_masked_hint(p_party_id uuid, p_kind public.sensitive_field_kind)
returns text
language sql
security definer
stable
set search_path = ''
as $fn$
  select case when public.staff_can_access_party(p_party_id)
    then (select masked_hint from public.party_sensitive_data
          where party_id = p_party_id and field_kind = p_kind)
    else null end;
$fn$;

create or replace function public.get_masked_hints(p_party_id uuid)
returns jsonb
language sql
security definer
stable
set search_path = ''
as $fn$
  select case
    when public.staff_can_access_party(p_party_id) then
      coalesce(
        (select jsonb_object_agg(d.field_kind::text, d.masked_hint)
           from public.party_sensitive_data d
          where d.party_id = p_party_id),
        '{}'::jsonb)
    else '{}'::jsonb
  end;
$fn$;

-- ---------------------------------------------------------------------------
-- 4. Prove it, or abort
-- ---------------------------------------------------------------------------

do $$
declare
  v_fn  text;
  v_src text;
begin
  -- The shortcut is gone, and the party helper still reaches the group helper.
  select prosrc into v_src from pg_proc
   where proname = 'staff_can_access_party' and pronamespace = 'public'::regnamespace;
  if v_src like '%view_all_groups%' then
    raise exception 'staff_can_access_party still short-circuits on view_all_groups';
  end if;
  if v_src not like '%staff_can_access_group%' then
    raise exception 'staff_can_access_party no longer defers to the household';
  end if;

  -- No record helper keeps an unbounded creator hatch: each one pairs its
  -- creator check with "and nothing is attached yet".
  foreach v_fn in array array['staff_can_access_account', 'staff_can_access_item', 'staff_can_access_policy', 'staff_can_access_note']
  loop
    select prosrc into v_src from pg_proc
     where proname = v_fn and pronamespace = 'public'::regnamespace;
    if v_src not like '%and not exists%' then
      raise exception '% still lets its creator see the record for ever', v_fn;
    end if;
  end loop;

  -- Every SELECT policy still names its creator column — that is the creation
  -- window and it must stay — but each one is now BOUNDED by the matching
  -- has-anything-attached helper, and each defers to its access helper for
  -- everything else. A policy naming the creator WITHOUT the bound is the leak.
  for v_fn, v_src in
    select policyname, coalesce(qual, '') from pg_policies
     where schemaname = 'public'
       and policyname in ('notes_select', 'accounts_select', 'policies_select', 'items_select')
  loop
    if v_src !~ '(note_has_subjects|account_has_owners|policy_has_parties|item_has_owners)' then
      raise exception '% lets its creator read the record for ever', v_fn;
    end if;
    if v_src !~ 'staff_can_access_(note|account|policy|item)' then
      raise exception '% no longer defers to its access helper', v_fn;
    end if;
  end loop;

  -- Every sensitive-field path asks who the party is.
  foreach v_fn in array array['reveal_sensitive_field', 'set_sensitive_field', 'get_masked_hint', 'get_masked_hints']
  loop
    select prosrc into v_src from pg_proc
     where proname = v_fn and pronamespace = 'public'::regnamespace;
    if v_src not like '%staff_can_access_party%' then
      raise exception '% does not check access to the party', v_fn;
    end if;
  end loop;

  -- A party in no household is STILL visible to every active staff member. That
  -- is a deliberate carry-over, not an oversight, so it is asserted rather than
  -- left to be quietly removed by whoever reads this next.
  select prosrc into v_src from pg_proc
   where proname = 'staff_can_access_party' and pronamespace = 'public'::regnamespace;
  if v_src not like '%if not exists (%' then
    raise exception 'the ungrouped-party carve-out is gone; that is a bigger decision than this file';
  end if;
end $$;
