-- Writing a postal address (6 Sep 2026)
--
-- set_preferred_address hardcoded 'address_residential', so it could only ever
-- write one of the three address kinds the enum has always carried. It now
-- takes the kind.
--
-- The six-argument form is DROPPED rather than kept alongside a defaulted
-- seventh: an overload would make every existing six-argument call ambiguous,
-- and worse, a caller could write a postal address and have it silently land on
-- the residential record. Only update_person_patch calls this, and it is
-- updated below in the same migration.
drop function if exists public.set_preferred_address(uuid, text, text, text, text, text);

create or replace function public.set_preferred_address(
  p_party_id uuid,
  p_line1    text,
  p_line2    text,
  p_suburb   text,
  p_state    text,
  p_postcode text,
  p_kind     public.contact_kind
) returns void
language plpgsql
security invoker
set search_path to ''
as $fn$
declare
  v_existing uuid;
begin
  if p_kind not in ('address_residential', 'address_postal', 'address_business') then
    raise exception 'Not an address kind: %', p_kind;
  end if;

  select id into v_existing
    from public.contact_points
   where party_id = p_party_id and kind = p_kind and is_preferred
   limit 1;

  -- line_1 is what the table's own check constraint requires for an address, so
  -- it is what decides whether an address exists at all.
  if p_line1 is null or length(trim(p_line1)) = 0 then
    if v_existing is not null then
      delete from public.contact_points where id = v_existing;
    end if;
    return;
  end if;

  if v_existing is null then
    insert into public.contact_points
      (party_id, kind, address_line_1, address_line_2, suburb, state, postcode, is_preferred)
    values
      (p_party_id, p_kind, trim(p_line1), nullif(trim(coalesce(p_line2,'')),''),
       nullif(trim(coalesce(p_suburb,'')),''), nullif(trim(coalesce(p_state,'')),''),
       nullif(trim(coalesce(p_postcode,'')),''), true);
  else
    update public.contact_points
       set address_line_1 = trim(p_line1),
           address_line_2 = nullif(trim(coalesce(p_line2,'')),''),
           suburb         = nullif(trim(coalesce(p_suburb,'')),''),
           state          = nullif(trim(coalesce(p_state,'')),''),
           postcode       = nullif(trim(coalesce(p_postcode,'')),'')
     where id = v_existing;
  end if;
end $fn$;

revoke all on function public.set_preferred_address(uuid, text, text, text, text, text, public.contact_kind)
  from public, anon;
grant execute on function public.set_preferred_address(uuid, text, text, text, text, text, public.contact_kind)
  to authenticated;

-- ---------------------------------------------------------------------------
-- update_person_patch gains the postal address and the flag
-- ---------------------------------------------------------------------------
create or replace function public.update_person_patch(
  p_party_id uuid,
  p_patch    jsonb,
  p_group_id uuid default null
) returns void
language plpgsql
security invoker
set search_path to ''
as $fn$
declare
  v_same boolean;
begin
  if public.current_staff_id() is null then
    raise exception 'Not an active staff member';
  end if;
  if p_patch is null or jsonb_typeof(p_patch) <> 'object' then
    raise exception 'A patch object is required';
  end if;

  if not exists (select 1 from public.persons p where p.party_id = p_party_id) then
    raise exception 'No such individual, or not within your access';
  end if;

  if p_patch ? 'first_name'
     and length(trim(coalesce(p_patch ->> 'first_name', ''))) = 0 then
    raise exception 'A first name is required';
  end if;
  if p_patch ? 'last_name'
     and length(trim(coalesce(p_patch ->> 'last_name', ''))) = 0 then
    raise exception 'A last name is required';
  end if;

  update public.persons p set
    title = case when p_patch ? 'title'
      then nullif(trim(coalesce(p_patch ->> 'title', '')), '') else p.title end,
    first_name = case when p_patch ? 'first_name'
      then trim(p_patch ->> 'first_name') else p.first_name end,
    middle_name = case when p_patch ? 'middle_name'
      then nullif(trim(coalesce(p_patch ->> 'middle_name', '')), '') else p.middle_name end,
    last_name = case when p_patch ? 'last_name'
      then trim(p_patch ->> 'last_name') else p.last_name end,
    preferred_name = case when p_patch ? 'preferred_name'
      then nullif(trim(coalesce(p_patch ->> 'preferred_name', '')), '') else p.preferred_name end,
    date_of_birth = case when p_patch ? 'date_of_birth'
      then nullif(p_patch ->> 'date_of_birth', '')::date else p.date_of_birth end,
    date_of_death = case when p_patch ? 'date_of_death'
      then nullif(p_patch ->> 'date_of_death', '')::date else p.date_of_death end,
    gender = case when p_patch ? 'gender'
      then nullif(trim(coalesce(p_patch ->> 'gender', '')), '') else p.gender end,
    marital_status = case when p_patch ? 'marital_status'
      then nullif(trim(coalesce(p_patch ->> 'marital_status', '')), '') else p.marital_status end,
    place_of_birth = case when p_patch ? 'place_of_birth'
      then nullif(trim(coalesce(p_patch ->> 'place_of_birth', '')), '') else p.place_of_birth end,
    smoker = case when p_patch ? 'smoker'
      then nullif(p_patch ->> 'smoker', '')::boolean else p.smoker end,
    primary_citizenship = case when p_patch ? 'primary_citizenship'
      then nullif(trim(coalesce(p_patch ->> 'primary_citizenship', '')), '') else p.primary_citizenship end,
    secondary_citizenship = case when p_patch ? 'secondary_citizenship'
      then nullif(trim(coalesce(p_patch ->> 'secondary_citizenship', '')), '') else p.secondary_citizenship end,
    tax_residency = case when p_patch ? 'tax_residency'
      then nullif(trim(coalesce(p_patch ->> 'tax_residency', '')), '') else p.tax_residency end,
    employment_status = case when p_patch ? 'employment_status'
      then nullif(p_patch ->> 'employment_status', '')::public.employment_status else p.employment_status end,
    occupation = case when p_patch ? 'occupation'
      then nullif(trim(coalesce(p_patch ->> 'occupation', '')), '') else p.occupation end,
    company_name = case when p_patch ? 'company_name'
      then nullif(trim(coalesce(p_patch ->> 'company_name', '')), '') else p.company_name end,
    hin = case when p_patch ? 'hin'
      then nullif(trim(coalesce(p_patch ->> 'hin', '')), '') else p.hin end,
    chess_pid = case when p_patch ? 'chess_pid'
      then nullif(trim(coalesce(p_patch ->> 'chess_pid', '')), '') else p.chess_pid end,
    coffee_preference = case when p_patch ? 'coffee_preference'
      then nullif(trim(coalesce(p_patch ->> 'coffee_preference', '')), '') else p.coffee_preference end,
    postal_same_as_residential = case when p_patch ? 'postal_same_as_residential'
      then coalesce(nullif(p_patch ->> 'postal_same_as_residential', '')::boolean, true)
      else p.postal_same_as_residential end
  where p.party_id = p_party_id;

  if p_patch ? 'notes' then
    update public.parties
       set notes = nullif(trim(coalesce(p_patch ->> 'notes', '')), '')
     where id = p_party_id;
  end if;

  if p_patch ? 'email' then
    perform public.set_preferred_contact(p_party_id, 'email', p_patch ->> 'email');
  end if;
  if p_patch ? 'mobile' then
    perform public.set_preferred_contact(p_party_id, 'phone_mobile', p_patch ->> 'mobile');
  end if;
  if p_patch ? 'phone_other' then
    perform public.set_preferred_contact(p_party_id, 'phone_other', p_patch ->> 'phone_other');
  end if;

  -- An address is ONE row with several columns, so it is patched as a unit:
  -- whichever key appears, all five are taken from the patch. The form that
  -- edits it submits all five together, so an absent key means empty rather
  -- than unchanged.
  if p_patch ?| array['addr_line1','addr_line2','addr_suburb','addr_state','addr_postcode'] then
    perform public.set_preferred_address(
      p_party_id,
      p_patch ->> 'addr_line1',
      p_patch ->> 'addr_line2',
      p_patch ->> 'addr_suburb',
      p_patch ->> 'addr_state',
      p_patch ->> 'addr_postcode',
      'address_residential');
  end if;

  -- The postal address, and the rule that keeps it from going stale.
  --
  -- While the flag is set there is NO postal row: the address is resolved from
  -- the residential one when read. So setting the flag deletes any postal row
  -- that existed, and there is never a moment where a stale copy and a live
  -- address disagree.
  select p.postal_same_as_residential into v_same
    from public.persons p where p.party_id = p_party_id;

  if v_same then
    perform public.set_preferred_address(p_party_id, null, null, null, null, null, 'address_postal');
  elsif p_patch ?| array['post_line1','post_line2','post_suburb','post_state','post_postcode'] then
    perform public.set_preferred_address(
      p_party_id,
      p_patch ->> 'post_line1',
      p_patch ->> 'post_line2',
      p_patch ->> 'post_suburb',
      p_patch ->> 'post_state',
      p_patch ->> 'post_postcode',
      'address_postal');
  end if;

  if p_patch ? 'member_role' then
    if p_group_id is null then
      raise exception 'A group is required to change someone''s role in it';
    end if;
    update public.client_group_members
       set member_role = (p_patch ->> 'member_role')::public.member_role
     where party_id = p_party_id and group_id = p_group_id and end_date is null;
  end if;
end $fn$;

revoke all on function public.update_person_patch(uuid, jsonb, uuid) from public, anon;
grant execute on function public.update_person_patch(uuid, jsonb, uuid) to authenticated;

comment on function public.update_person_patch(uuid, jsonb, uuid) is
  'Partial update of an individual. Key presence decides: absent leaves a column alone, present-and-empty clears it. Addresses are patched as a unit. While postal_same_as_residential is true no address_postal row is kept, so the postal address follows the residential one rather than becoming a stale copy.';
