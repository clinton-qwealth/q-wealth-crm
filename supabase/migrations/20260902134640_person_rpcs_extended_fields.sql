-- create_person_in_group and update_person carry the extended fields (2 Sep 2026)
--
-- Both gain the same block of parameters, all defaulted, so every existing
-- caller keeps working. The encrypted identifiers are NOT parameters here:
-- writing one goes through set_sensitive_field, which enforces view_sensitive
-- and a verified second factor. Routing them through this function would have
-- quietly bypassed both.

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
  p_notes           text default null,
  p_place_of_birth  text default null,
  p_smoker          boolean default null,
  p_primary_citizenship text default null,
  p_secondary_citizenship text default null,
  p_tax_residency   text default null,
  p_employment_status public.employment_status default null,
  p_occupation      text default null,
  p_company_name    text default null,
  p_hin             text default null,
  p_chess_pid       text default null,
  p_coffee_preference text default null,
  p_date_of_death   date default null
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
     date_of_birth, date_of_death, gender, marital_status,
     place_of_birth, smoker, primary_citizenship, secondary_citizenship,
     tax_residency, employment_status, occupation, company_name,
     hin, chess_pid, coffee_preference)
  values
    (v_party,
     nullif(trim(coalesce(p_title,'')),''),
     trim(p_first_name),
     nullif(trim(coalesce(p_middle_name,'')),''),
     trim(p_last_name),
     nullif(trim(coalesce(p_preferred_name,'')),''),
     p_date_of_birth,
     p_date_of_death,
     nullif(trim(coalesce(p_gender,'')),''),
     nullif(trim(coalesce(p_marital_status,'')),''),
     nullif(trim(coalesce(p_place_of_birth,'')),''),
     p_smoker,
     nullif(trim(coalesce(p_primary_citizenship,'')),''),
     nullif(trim(coalesce(p_secondary_citizenship,'')),''),
     nullif(trim(coalesce(p_tax_residency,'')),''),
     p_employment_status,
     nullif(trim(coalesce(p_occupation,'')),''),
     nullif(trim(coalesce(p_company_name,'')),''),
     nullif(trim(coalesce(p_hin,'')),''),
     nullif(trim(coalesce(p_chess_pid,'')),''),
     nullif(trim(coalesce(p_coffee_preference,'')),''));

  insert into public.party_roles (party_id, role, status)
  values (v_party,
          case when p_member_role = 'dependant' then 'dependant'::public.party_role_type
               else 'client'::public.party_role_type end,
          'active');

  perform public.set_preferred_contact(v_party, 'email', p_email);
  perform public.set_preferred_contact(v_party, 'phone_mobile', p_mobile);
  perform public.set_preferred_contact(v_party, 'phone_other', p_phone_other);
  perform public.set_preferred_address(
    v_party, p_addr_line1, p_addr_line2, p_addr_suburb, p_addr_state, p_addr_postcode);

  select exists (
    select 1 from public.client_group_members m
     where m.party_id = v_party and m.is_primary_group and m.end_date is null
  ) into v_has_primary;

  insert into public.client_group_members
    (group_id, party_id, member_role, is_primary_group)
  values (p_group_id, v_party, p_member_role, not v_has_primary);

  return v_party;
end $fn$;

create or replace function public.update_person(
  p_party_id        uuid,
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
  p_notes           text default null,
  p_group_id        uuid default null,
  p_member_role     public.member_role default null,
  p_place_of_birth  text default null,
  p_smoker          boolean default null,
  p_primary_citizenship text default null,
  p_secondary_citizenship text default null,
  p_tax_residency   text default null,
  p_employment_status public.employment_status default null,
  p_occupation      text default null,
  p_company_name    text default null,
  p_hin             text default null,
  p_chess_pid       text default null,
  p_coffee_preference text default null,
  p_date_of_death   date default null
) returns void
language plpgsql
security invoker
set search_path to ''
as $fn$
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

  if not exists (select 1 from public.persons p where p.party_id = p_party_id) then
    raise exception 'No such individual, or not within your access';
  end if;

  update public.persons
     set title          = nullif(trim(coalesce(p_title,'')),''),
         first_name     = trim(p_first_name),
         middle_name    = nullif(trim(coalesce(p_middle_name,'')),''),
         last_name      = trim(p_last_name),
         preferred_name = nullif(trim(coalesce(p_preferred_name,'')),''),
         date_of_birth  = p_date_of_birth,
         date_of_death  = p_date_of_death,
         gender         = nullif(trim(coalesce(p_gender,'')),''),
         marital_status = nullif(trim(coalesce(p_marital_status,'')),''),
         place_of_birth = nullif(trim(coalesce(p_place_of_birth,'')),''),
         smoker         = p_smoker,
         primary_citizenship = nullif(trim(coalesce(p_primary_citizenship,'')),''),
         secondary_citizenship = nullif(trim(coalesce(p_secondary_citizenship,'')),''),
         tax_residency  = nullif(trim(coalesce(p_tax_residency,'')),''),
         employment_status = p_employment_status,
         occupation     = nullif(trim(coalesce(p_occupation,'')),''),
         company_name   = nullif(trim(coalesce(p_company_name,'')),''),
         hin            = nullif(trim(coalesce(p_hin,'')),''),
         chess_pid      = nullif(trim(coalesce(p_chess_pid,'')),''),
         coffee_preference = nullif(trim(coalesce(p_coffee_preference,'')),'')
   where party_id = p_party_id;

  update public.parties
     set notes = nullif(trim(coalesce(p_notes,'')),'')
   where id = p_party_id;

  perform public.set_preferred_contact(p_party_id, 'email', p_email);
  perform public.set_preferred_contact(p_party_id, 'phone_mobile', p_mobile);
  perform public.set_preferred_contact(p_party_id, 'phone_other', p_phone_other);
  perform public.set_preferred_address(
    p_party_id, p_addr_line1, p_addr_line2, p_addr_suburb, p_addr_state, p_addr_postcode);

  if p_group_id is not null and p_member_role is not null then
    update public.client_group_members
       set member_role = p_member_role
     where party_id = p_party_id and group_id = p_group_id and end_date is null;
  end if;
end $fn$;

-- The old signatures would otherwise linger and a short call could reach a
-- stale one, silently dropping the new fields.
drop function if exists public.create_person_in_group(
  uuid, public.member_role, text, text, text, text, text, date, text, text,
  text, text, text, text, text, text, text, text, text);
drop function if exists public.update_person(
  uuid, text, text, text, text, text, date, text, text, text, text, text,
  text, text, text, text, text, text, uuid, public.member_role);

revoke all on function public.create_person_in_group(
  uuid, public.member_role, text, text, text, text, text, date, text, text,
  text, text, text, text, text, text, text, text, text, text, boolean, text,
  text, text, public.employment_status, text, text, text, text, text, date)
  from public, anon;
grant execute on function public.create_person_in_group(
  uuid, public.member_role, text, text, text, text, text, date, text, text,
  text, text, text, text, text, text, text, text, text, text, boolean, text,
  text, text, public.employment_status, text, text, text, text, text, date)
  to authenticated;

revoke all on function public.update_person(
  uuid, text, text, text, text, text, date, text, text, text, text, text,
  text, text, text, text, text, text, uuid, public.member_role, text, boolean,
  text, text, text, public.employment_status, text, text, text, text, text, date)
  from public, anon;
grant execute on function public.update_person(
  uuid, text, text, text, text, text, date, text, text, text, text, text,
  text, text, text, text, text, text, uuid, public.member_role, text, boolean,
  text, text, text, public.employment_status, text, text, text, text, text, date)
  to authenticated;
