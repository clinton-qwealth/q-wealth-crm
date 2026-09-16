-- An account and a policy can be corrected (16 Sep 2026)
--
-- Until now the only write path to either record was its create function.
-- `create_financial_account()` and `create_insurance_policy()` insert and
-- nothing else, so a name typed wrongly stayed wrong and an account whose
-- ownership changed had no way to say so.
--
-- WHAT IS EDITABLE, AND WHY IT IS ONLY THIS. Three fields on an account: its
-- label, its account_type and its owners. Three on a policy: its label, its
-- owners and its lives insured. What they have in common is that a PERSON owns
-- them. Everything else on an account is now the provider's — the value, the
-- cash, the product, the allocation, all refreshed daily by ingest.promote(),
-- and a hand edit would be overwritten by the next run. `account_type` in
-- particular is deliberately the CRM's own and never taken from HUB24, whose
-- product type reads "Investment" on a superfund with a corporate trustee.
--
-- Not `status`, on either record. A policy's status is coupled to cancelled_on
-- by two check constraints and an account's to closed_on by one, so editing it
-- is really editing a status-and-date pair with its own refusals. That is a
-- different control and it is named as deferred rather than half-built here.
--
-- Patch-shaped, so KEY PRESENCE DECIDES: a form carrying only a name produces a
-- one-key patch and the owners are not touched. `update_person_patch` set the
-- convention and the reason holds — null cannot mean both "leave this alone"
-- and "clear this", and whichever meaning is chosen the other becomes
-- impossible to express.

-- ---------------------------------------------------------------------------
-- 1. An account's name, type and owners
-- ---------------------------------------------------------------------------

create or replace function public.update_financial_account_patch(
  p_account_id uuid,
  p_patch      jsonb
)
returns void
language plpgsql
set search_path to ''
as $fn$
declare
  v_owners uuid[];
  v_party  uuid;
  v_rows   int;
  v_keys   text[] := array['label', 'account_type', 'owner_party_ids'];
begin
  if public.current_staff_id() is null then
    raise exception 'Not an active staff member';
  end if;
  if p_patch is null or jsonb_typeof(p_patch) <> 'object' then
    raise exception 'A patch object is required';
  end if;
  if p_patch = '{}'::jsonb then
    raise exception 'Nothing to change';
  end if;

  -- UNLIKE update_person_patch, an unrecognised key is REFUSED rather than
  -- ignored. Three fields are editable and this function is the only path to
  -- them, so a fourth key is a caller's mistake — and a write that silently
  -- drops half of what was asked is how "why didn't my change save?" begins.
  -- The cost is stated plainly: an app deployed ahead of this migration gets a
  -- refusal instead of a partial write, which is the failure worth having.
  if exists (select 1 from jsonb_object_keys(p_patch) k where k <> all (v_keys)) then
    raise exception 'Unknown field in patch: %',
      (select string_agg(k, ', ' order by k) from jsonb_object_keys(p_patch) k where k <> all (v_keys));
  end if;

  -- This read goes through RLS, so an account outside the caller's access
  -- matches nothing here and is refused with a sentence, rather than being
  -- quietly filtered out of the UPDATE below and reported as a success.
  if not exists (select 1 from public.financial_accounts a where a.id = p_account_id) then
    raise exception 'No such account, or not one you have access to';
  end if;

  if p_patch ? 'label' and length(btrim(coalesce(p_patch ->> 'label', ''))) = 0 then
    raise exception 'An account needs a name';
  end if;

  -- Checked against the enum itself rather than a list written out here, so a
  -- third account type added later needs no edit to this function.
  if p_patch ? 'account_type'
     and not exists (select 1 from unnest(enum_range(null::public.financial_account_type)) t
                      where t::text = p_patch ->> 'account_type') then
    raise exception 'Unknown account type: %', p_patch ->> 'account_type';
  end if;

  if p_patch ?| array['label', 'account_type'] then
    update public.financial_accounts a
       set label = case when p_patch ? 'label'
                        then btrim(p_patch ->> 'label') else a.label end,
           account_type = case when p_patch ? 'account_type'
                        then (p_patch ->> 'account_type')::public.financial_account_type
                        else a.account_type end
     where a.id = p_account_id;
    -- updated_at is left alone: trg_financial_accounts_updated_at sets it.

    -- The 11 September lesson, which cost a function that reported success while
    -- changing nothing. accounts_select and accounts_update carry the same
    -- condition today so this cannot fire — and an UPDATE filtered to zero rows
    -- by RLS is not an error, so if that ever changes this function must not be
    -- the thing that lies about it.
    get diagnostics v_rows = row_count;
    if v_rows = 0 then
      raise exception 'You do not have permission to change this account';
    end if;
  end if;

  if p_patch ? 'owner_party_ids' then
    if jsonb_typeof(p_patch -> 'owner_party_ids') <> 'array' then
      raise exception 'Owners must be given as a list of party ids';
    end if;

    select array_agg(distinct e::uuid) into v_owners
      from jsonb_array_elements_text(p_patch -> 'owner_party_ids') e;

    -- Said here rather than left to the deferred trigger at COMMIT, so the
    -- adviser reads a sentence about what they did rather than one naming a uuid.
    if v_owners is null or cardinality(v_owners) = 0 then
      raise exception 'An account must have at least one owner';
    end if;

    -- Named before anything is written. Without this the insert below fails on
    -- the row-level security policy and surfaces as "new row violates row-level
    -- security policy for table financial_account_owners", which tells an
    -- adviser nothing they can act on.
    foreach v_party in array v_owners loop
      if not exists (select 1 from public.parties p where p.id = v_party) then
        raise exception 'One of those owners is not someone you can add to this account';
      end if;
    end loop;

    -- A DIFF, NOT A CHURN. Deleting every owner and re-inserting the set
    -- satisfies the deferred trigger just as well, and writes two audit rows per
    -- owner who never changed while resetting their created_at. An owner who
    -- stays is not an event.
    delete from public.financial_account_owners o
     where o.account_id = p_account_id
       and not (o.party_id = any (v_owners));

    insert into public.financial_account_owners (account_id, party_id)
    select p_account_id, u from unnest(v_owners) u
    on conflict (account_id, party_id) do nothing;
  end if;
end $fn$;

comment on function public.update_financial_account_patch(uuid, jsonb) is
  'Partial update of the three fields of an account a person owns: label, account_type and the owner set. Key presence decides; an unknown key is REFUSED rather than ignored. Owners are replaced by difference inside one transaction, so the deferred at-least-one-owner trigger sees the final state at COMMIT and an unchanged owner writes no audit row. Everything else about an account is the provider feed''s and would be overwritten by the next run. Added 16 Sep 2026.';

revoke all on function public.update_financial_account_patch(uuid, jsonb) from public, anon;
grant execute on function public.update_financial_account_patch(uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. A policy's name and its two sets of people
-- ---------------------------------------------------------------------------

create or replace function public.update_insurance_policy_patch(
  p_policy_id uuid,
  p_patch     jsonb
)
returns void
language plpgsql
set search_path to ''
as $fn$
declare
  v_owners uuid[];
  v_lives  uuid[];
  v_party  uuid;
  v_rows   int;
  v_keys   text[] := array['label', 'owner_party_ids', 'life_insured_party_ids'];
begin
  if public.current_staff_id() is null then
    raise exception 'Not an active staff member';
  end if;
  if p_patch is null or jsonb_typeof(p_patch) <> 'object' then
    raise exception 'A patch object is required';
  end if;
  if p_patch = '{}'::jsonb then
    raise exception 'Nothing to change';
  end if;

  if exists (select 1 from jsonb_object_keys(p_patch) k where k <> all (v_keys)) then
    raise exception 'Unknown field in patch: %',
      (select string_agg(k, ', ' order by k) from jsonb_object_keys(p_patch) k where k <> all (v_keys));
  end if;

  if not exists (select 1 from public.insurance_policies p where p.id = p_policy_id) then
    raise exception 'No such policy, or not one you have access to';
  end if;

  if p_patch ? 'label' and length(btrim(coalesce(p_patch ->> 'label', ''))) = 0 then
    raise exception 'A policy needs a name';
  end if;

  if p_patch ? 'label' then
    update public.insurance_policies p
       set label = btrim(p_patch ->> 'label')
     where p.id = p_policy_id;
    get diagnostics v_rows = row_count;
    if v_rows = 0 then
      raise exception 'You do not have permission to change this policy';
    end if;
  end if;

  if p_patch ? 'owner_party_ids' then
    if jsonb_typeof(p_patch -> 'owner_party_ids') <> 'array' then
      raise exception 'Owners must be given as a list of party ids';
    end if;
    select array_agg(distinct e::uuid) into v_owners
      from jsonb_array_elements_text(p_patch -> 'owner_party_ids') e;
    foreach v_party in array coalesce(v_owners, '{}'::uuid[]) loop
      if not exists (select 1 from public.parties p where p.id = v_party) then
        raise exception 'One of those owners is not someone you can name on this policy';
      end if;
    end loop;

    delete from public.insurance_policy_parties pp
     where pp.policy_id = p_policy_id
       and pp.role = 'owner'
       and not (pp.party_id = any (coalesce(v_owners, '{}'::uuid[])));

    insert into public.insurance_policy_parties (policy_id, party_id, role)
    select p_policy_id, u, 'owner' from unnest(coalesce(v_owners, '{}'::uuid[])) u
    on conflict (policy_id, party_id, role) do nothing;
  end if;

  if p_patch ? 'life_insured_party_ids' then
    if jsonb_typeof(p_patch -> 'life_insured_party_ids') <> 'array' then
      raise exception 'Lives insured must be given as a list of party ids';
    end if;
    select array_agg(distinct e::uuid) into v_lives
      from jsonb_array_elements_text(p_patch -> 'life_insured_party_ids') e;
    foreach v_party in array coalesce(v_lives, '{}'::uuid[]) loop
      if not exists (select 1 from public.parties p where p.id = v_party) then
        raise exception 'One of those lives insured is not someone you can name on this policy';
      end if;
    end loop;

    delete from public.insurance_policy_parties pp
     where pp.policy_id = p_policy_id
       and pp.role = 'life_insured'
       and not (pp.party_id = any (coalesce(v_lives, '{}'::uuid[])));

    insert into public.insurance_policy_parties (policy_id, party_id, role)
    select p_policy_id, u, 'life_insured' from unnest(coalesce(v_lives, '{}'::uuid[])) u
    on conflict (policy_id, party_id, role) do nothing;
  end if;

  -- CHECKED ON THE FINAL STATE, after both sets have been applied, rather than
  -- inside each branch above. A patch that moves the only life insured across to
  -- owner is two legal-looking halves and one illegal whole; per-key checks
  -- would pass it and leave the deferred trigger to refuse it at COMMIT with a
  -- message naming a uuid.
  if p_patch ?| array['owner_party_ids', 'life_insured_party_ids'] then
    if not exists (select 1 from public.insurance_policy_parties pp
                    where pp.policy_id = p_policy_id and pp.role = 'owner') then
      raise exception 'An insurance policy must have at least one owner';
    end if;
    if not exists (select 1 from public.insurance_policy_parties pp
                    where pp.policy_id = p_policy_id and pp.role = 'life_insured') then
      raise exception 'An insurance policy must name at least one life insured';
    end if;
  end if;
end $fn$;

comment on function public.update_insurance_policy_patch(uuid, jsonb) is
  'Partial update of a policy''s label and its two sets of people. Key presence decides; an unknown key is REFUSED. Each role set is replaced by difference, and the at-least-one-of-each rule is checked on the FINAL state so a patch moving the last life insured into the owner set is refused with a sentence rather than by the deferred trigger. Status is not editable here: it is coupled to cancelled_on and belongs to a control of its own. Added 16 Sep 2026.';

revoke all on function public.update_insurance_policy_patch(uuid, jsonb) from public, anon;
grant execute on function public.update_insurance_policy_patch(uuid, jsonb) to authenticated;
