-- Patch semantics for editing one section at a time (2 Sep 2026)
--
-- update_person takes every column as a parameter defaulting to null, so it can
-- only ever write the WHOLE record. Saving a single section through it would
-- send four fields and null the other nineteen — silently, and against a client
-- record that is audited.
--
-- This takes a jsonb patch instead, where the distinction that matters is
-- key PRESENCE, not value:
--
--   key absent      leave the column exactly as it is
--   key present, null or ""   clear the column
--   key present, value        set it
--
-- That is what lets a section save only its own fields, and still lets a field
-- be emptied — which a "skip nulls" approach could never express.
create or replace function public.update_person_patch(
  p_party_id uuid,
  p_patch    jsonb,
  -- Only needed when the patch carries member_role: a person's role is a
  -- property of one membership, not of the person.
  p_group_id uuid default null
) returns void
language plpgsql
security invoker
set search_path to ''
as $fn$
declare
  -- Text straight out of the patch, blank-normalised to null.
  function_txt text;
begin
  if public.current_staff_id() is null then
    raise exception 'Not an active staff member';
  end if;
  if p_patch is null or jsonb_typeof(p_patch) <> 'object' then
    raise exception 'A patch object is required';
  end if;

  -- Reads and writes both go through RLS, so a party outside the caller's scope
  -- matches nothing and the update would quietly affect zero rows.
  if not exists (select 1 from public.persons p where p.party_id = p_party_id) then
    raise exception 'No such individual, or not within your access';
  end if;

  -- Names are the one thing that cannot be cleared: display_name is derived from
  -- them, and a party with no name is unusable everywhere it appears.
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
      then nullif(trim(coalesce(p_patch ->> 'coffee_preference', '')), '') else p.coffee_preference end
  where p.party_id = p_party_id;

  if p_patch ? 'notes' then
    update public.parties
       set notes = nullif(trim(coalesce(p_patch ->> 'notes', '')), '')
     where id = p_party_id;
  end if;

  -- Contact points are separate rows, so each is only touched when its key is
  -- in the patch.
  if p_patch ? 'email' then
    perform public.set_preferred_contact(p_party_id, 'email', p_patch ->> 'email');
  end if;
  if p_patch ? 'mobile' then
    perform public.set_preferred_contact(p_party_id, 'phone_mobile', p_patch ->> 'mobile');
  end if;
  if p_patch ? 'phone_other' then
    perform public.set_preferred_contact(p_party_id, 'phone_other', p_patch ->> 'phone_other');
  end if;

  -- The address is ONE row with several columns, so it is patched as a unit:
  -- whichever address key appears, all five are taken from the patch. The form
  -- that edits it submits all five together, so an absent key means empty
  -- rather than unchanged. Patching them individually would need a read-modify-
  -- write and could half-update a single address.
  if p_patch ?| array['addr_line1','addr_line2','addr_suburb','addr_state','addr_postcode'] then
    perform public.set_preferred_address(
      p_party_id,
      p_patch ->> 'addr_line1',
      p_patch ->> 'addr_line2',
      p_patch ->> 'addr_suburb',
      p_patch ->> 'addr_state',
      p_patch ->> 'addr_postcode');
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
  'Partial update of an individual. Key presence decides: absent leaves a column alone, present-and-empty clears it. Lets one section of a form save without nulling the fields it does not contain. update_person is retained for whole-record writes.';
