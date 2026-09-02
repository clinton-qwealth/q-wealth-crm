-- Editing an individual, and attaching an existing one to a group (2 Sep 2026)

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
  -- Optional: the person's role within one specific group. Null leaves every
  -- membership alone, so editing someone's name from one group's panel cannot
  -- silently change their role in another.
  p_group_id        uuid default null,
  p_member_role     public.member_role default null
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

  -- Reads and writes both go through RLS, so a party outside the caller's scope
  -- matches nothing and the update silently affects zero rows. Checking first
  -- turns that into an explicit refusal rather than a save that appears to work.
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
         gender         = nullif(trim(coalesce(p_gender,'')),''),
         marital_status = nullif(trim(coalesce(p_marital_status,'')),'')
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

revoke all on function public.update_person(
  uuid, text, text, text, text, text, date, text, text, text, text, text,
  text, text, text, text, text, text, uuid, public.member_role) from public, anon;
grant execute on function public.update_person(
  uuid, text, text, text, text, text, date, text, text, text, text, text,
  text, text, text, text, text, text, uuid, public.member_role) to authenticated;

-- Attaching an EXISTING person to a group is the operation the party model
-- exists for: one Jane Smith in a household and in a business group, not two
-- Jane Smiths. Without this, staff re-enter people and create the duplicates
-- the schema was designed to prevent.
create or replace function public.add_party_to_group(
  p_group_id    uuid,
  p_party_id    uuid,
  p_member_role public.member_role
) returns void
language plpgsql
security invoker
set search_path to ''
as $fn$
declare
  v_has_primary boolean;
begin
  if public.current_staff_id() is null then
    raise exception 'Not an active staff member';
  end if;

  if exists (
    select 1 from public.client_group_members m
     where m.group_id = p_group_id and m.party_id = p_party_id and m.end_date is null
  ) then
    raise exception 'That person is already a member of this group';
  end if;

  -- Their existing primary group stays primary. Joining a second group does not
  -- change which group a person reports under, and the partial unique index
  -- would refuse a second primary anyway.
  select exists (
    select 1 from public.client_group_members m
     where m.party_id = p_party_id and m.is_primary_group and m.end_date is null
  ) into v_has_primary;

  insert into public.client_group_members
    (group_id, party_id, member_role, is_primary_group)
  values (p_group_id, p_party_id, p_member_role, not v_has_primary);
end $fn$;

revoke all on function public.add_party_to_group(uuid, uuid, public.member_role)
  from public, anon;
grant execute on function public.add_party_to_group(uuid, uuid, public.member_role)
  to authenticated;
