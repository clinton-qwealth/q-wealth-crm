-- Transactional write paths for individuals (2 Sep 2026)
--
-- An individual spans five tables: parties, persons, contact_points,
-- party_roles and client_group_members. A half-created person — a parties row
-- with no persons row, or a person in no group — is not a state any screen
-- knows how to show, so each of these functions writes everything or nothing.
--
-- SECURITY INVOKER throughout: the caller's own RLS decides what they may touch.
-- Creating works because a party with no group membership yet is visible to all
-- active staff (staff_can_access_party returns true for an ungrouped party), so
-- the rows can be inserted before the membership that will scope them.

-- The panel manages the PREFERRED contact point of each kind. Passing a value
-- upserts it; passing null or blank removes it. Non-preferred duplicates of the
-- same kind are left alone — they were not created here and are not shown.
create or replace function public.set_preferred_contact(
  p_party_id uuid,
  p_kind public.contact_kind,
  p_value text
) returns void
language plpgsql
security invoker
set search_path to ''
as $fn$
declare
  v_existing uuid;
begin
  select id into v_existing
    from public.contact_points
   where party_id = p_party_id and kind = p_kind and is_preferred
   limit 1;

  if p_value is null or length(trim(p_value)) = 0 then
    if v_existing is not null then
      delete from public.contact_points where id = v_existing;
    end if;
    return;
  end if;

  if v_existing is null then
    insert into public.contact_points (party_id, kind, value, is_preferred)
    values (p_party_id, p_kind, trim(p_value), true);
  else
    update public.contact_points set value = trim(p_value) where id = v_existing;
  end if;
end $fn$;

revoke all on function public.set_preferred_contact(uuid, public.contact_kind, text)
  from public, anon;
grant execute on function public.set_preferred_contact(uuid, public.contact_kind, text)
  to authenticated;

-- The residential address is one contact point with several columns, so it does
-- not fit set_preferred_contact.
create or replace function public.set_preferred_address(
  p_party_id uuid,
  p_line1 text,
  p_line2 text,
  p_suburb text,
  p_state text,
  p_postcode text
) returns void
language plpgsql
security invoker
set search_path to ''
as $fn$
declare
  v_existing uuid;
begin
  select id into v_existing
    from public.contact_points
   where party_id = p_party_id and kind = 'address_residential' and is_preferred
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
      (p_party_id, 'address_residential', trim(p_line1), nullif(trim(coalesce(p_line2,'')),''),
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

revoke all on function public.set_preferred_address(uuid, text, text, text, text, text)
  from public, anon;
grant execute on function public.set_preferred_address(uuid, text, text, text, text, text)
  to authenticated;

create or replace function public.create_person_in_group(
  p_group_id        uuid,
  p_member_role     public.member_role,
  p_first_name      text,
  p_last_name       text,
  p_title           text default null,
  p_middle_name     text default null,
  p_preferred_name  text default null,
  p_date_of_birth   date default null,
  p_gender          text default null,
  p_marital_status  text default null,
  p_email           text default null,
  p_mobile          text default null,
  p_phone_other     text default null,
  p_addr_line1      text default null,
  p_addr_line2      text default null,
  p_addr_suburb     text default null,
  p_addr_state      text default null,
  p_addr_postcode   text default null,
  p_notes           text default null
) returns uuid
language plpgsql
security invoker
set search_path to ''
as $fn$
declare
  v_party uuid;
  v_has_primary boolean;
begin
  if public.current_staff_id() is null then
    raise exception 'Not an active staff member';
  end if;
  if p_first_name is null or length(trim(p_first_name)) = 0 then
    raise exception 'A first name is required';
  end if;
  if p_last_name is null or length(trim(p_last_name)) = 0 then
    raise exception 'A last name is required';
  end if;

  insert into public.parties (party_type, status, notes)
  values ('person', 'active', nullif(trim(coalesce(p_notes,'')),''))
  returning id into v_party;

  insert into public.persons
    (party_id, title, first_name, middle_name, last_name, preferred_name,
     date_of_birth, gender, marital_status)
  values
    (v_party,
     nullif(trim(coalesce(p_title,'')),''),
     trim(p_first_name),
     nullif(trim(coalesce(p_middle_name,'')),''),
     trim(p_last_name),
     nullif(trim(coalesce(p_preferred_name,'')),''),
     p_date_of_birth,
     nullif(trim(coalesce(p_gender,'')),''),
     nullif(trim(coalesce(p_marital_status,'')),''));

  perform public.set_preferred_contact(v_party, 'email', p_email);
  perform public.set_preferred_contact(v_party, 'phone_mobile', p_mobile);
  perform public.set_preferred_contact(v_party, 'phone_other', p_phone_other);
  perform public.set_preferred_address(
    v_party, p_addr_line1, p_addr_line2, p_addr_suburb, p_addr_state, p_addr_postcode);

  -- A party role is created here deliberately. Without one the person is absent
  -- from the `clients` view and from the MCP's search_clients, which would make
  -- a just-created member invisible to both the everyday query surface and to
  -- Claude. A dependant in the group is a dependant to the firm; everyone else
  -- added to a client group is a client.
  insert into public.party_roles (party_id, role, status)
  values (v_party,
          case when p_member_role = 'dependant' then 'dependant'::public.party_role_type
               else 'client'::public.party_role_type end,
          'active');

  -- First group a person belongs to is their primary group. A person can only
  -- have one, enforced by a partial unique index.
  select exists (
    select 1 from public.client_group_members m
     where m.party_id = v_party and m.is_primary_group and m.end_date is null
  ) into v_has_primary;

  insert into public.client_group_members
    (group_id, party_id, member_role, is_primary_group)
  values (p_group_id, v_party, p_member_role, not v_has_primary);

  return v_party;
end $fn$;

revoke all on function public.create_person_in_group(
  uuid, public.member_role, text, text, text, text, text, date, text, text,
  text, text, text, text, text, text, text, text, text) from public, anon;
grant execute on function public.create_person_in_group(
  uuid, public.member_role, text, text, text, text, text, date, text, text,
  text, text, text, text, text, text, text, text, text) to authenticated;
