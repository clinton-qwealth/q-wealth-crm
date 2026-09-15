-- Marital status becomes a closed set (15 Sep 2026)
--
-- persons.marital_status has been free `text` since the party core tables were
-- created on 4 July, and production shows exactly what that produces: three
-- rows carrying a value, and two different spellings between them —
-- `married` twice and `Married` once. Two vocabularies for one fact, in a
-- column an adviser filters and reports on.
--
-- An ENUM rather than a text column with a check constraint, matching
-- employment_status on this same table. The convention says a check constraint
-- is the lighter fit for "a closed set that will GROW SOON"; marital status is
-- a stable legal vocabulary, so the enum's stronger guarantee is the right
-- trade. The cost is that a seventh value cannot be used in the transaction
-- that adds it, which is why the list was settled before this was written.
--
-- Six values. No `not_disclosed`, deliberately, where employment_status has
-- one: this column is nullable and blank already means "not recorded", so a
-- seventh value would only split that meaning in two without adding a fact.
--
-- THIS IS A NARROWING, so the application went first: the member panel's
-- Marital status input became a select over exactly these six values before
-- this migration was written. The other half of that rule — ask the stored
-- data whether it satisfies the new rule — is the `update` below, which is
-- what the `Married` row needs.

create type public.marital_status as enum (
  'single',
  'married',
  'de_facto',
  'separated',
  'divorced',
  'widowed'
);

comment on type public.marital_status is
  'Marital status as an Australian fact-find records it. Nullable on persons, and NULL means not recorded — there is deliberately no not_disclosed value. Added 15 Sep 2026, replacing free text.';

-- Normalise before casting. `Married` becomes `married`, and a value stored
-- with spaces or hyphens ("De facto", "de-facto") becomes `de_facto`, so the
-- cast below has a chance of succeeding on data nobody typed carefully.
--
-- Anything that still does not match a value is NOT coerced to null and NOT
-- dropped: the cast raises and this migration aborts, which is the correct
-- outcome. Silently discarding a client's recorded status to make a migration
-- pass is how a fact disappears without anybody deciding to lose it.
update public.persons
   set marital_status = lower(replace(replace(btrim(marital_status), ' ', '_'), '-', '_'))
 where marital_status is not null
   and marital_status <> lower(replace(replace(btrim(marital_status), ' ', '_'), '-', '_'));

alter table public.persons
  alter column marital_status type public.marital_status
  using nullif(btrim(marital_status), '')::public.marital_status;

comment on column public.persons.marital_status is
  'Marital status, one of six. NULL means not recorded. Was free text until 15 Sep 2026, when production held both `married` and `Married`.';

-- The three write paths.
--
-- create_person_in_group and update_person take the parameter as the enum, so
-- a bad value is refused at the call rather than at the insert — and the
-- trim/nullif treatment every text parameter gets is dropped for this one,
-- because an enum is already a closed set and there is nothing to trim.
-- p_employment_status has always been passed through the same way.
--
-- update_person_patch keeps its signature: the patch is jsonb, so what changes
-- is the cast inside it. `nullif(..., '')::public.marital_status` — an absent
-- key still leaves the column alone, and a present-and-empty one still clears
-- it, so the patch contract is unchanged.

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
  p_marital_status  public.marital_status default null,
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
     p_marital_status,
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
  p_marital_status  public.marital_status default null,
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
         marital_status = p_marital_status,
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
      then nullif(p_patch ->> 'marital_status', '')::public.marital_status else p.marital_status end,
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

-- CHANGING A PARAMETER'S TYPE CREATES AN OVERLOAD, NOT A REPLACEMENT. Both
-- would live on, every existing text call would go on resolving to the old one,
-- and nothing would say so — the trap this schema has now hit four times. The
-- old signatures are dropped in the same migration, as the convention requires.
drop function if exists public.create_person_in_group(
  uuid, public.member_role, text, text, text, text, text, date, text, text,
  text, text, text, text, text, text, text, text, text, text, boolean, text,
  text, text, public.employment_status, text, text, text, text, text, date);
drop function if exists public.update_person(
  uuid, text, text, text, text, text, date, text, text, text, text, text,
  text, text, text, text, text, text, uuid, public.member_role, text, boolean,
  text, text, text, public.employment_status, text, text, text, text, text, date);

revoke all on function public.create_person_in_group(
  uuid, public.member_role, text, text, text, text, text, date, text, public.marital_status,
  text, text, text, text, text, text, text, text, text, text, boolean, text,
  text, text, public.employment_status, text, text, text, text, text, date)
  from public, anon;
grant execute on function public.create_person_in_group(
  uuid, public.member_role, text, text, text, text, text, date, text, public.marital_status,
  text, text, text, text, text, text, text, text, text, text, boolean, text,
  text, text, public.employment_status, text, text, text, text, text, date)
  to authenticated;

revoke all on function public.update_person(
  uuid, text, text, text, text, text, date, text, public.marital_status, text, text, text,
  text, text, text, text, text, text, uuid, public.member_role, text, boolean,
  text, text, text, public.employment_status, text, text, text, text, text, date)
  from public, anon;
grant execute on function public.update_person(
  uuid, text, text, text, text, text, date, text, public.marital_status, text, text, text,
  text, text, text, text, text, text, uuid, public.member_role, text, boolean,
  text, text, text, public.employment_status, text, text, text, text, text, date)
  to authenticated;

revoke all on function public.update_person_patch(uuid, jsonb, uuid) from public, anon;
grant execute on function public.update_person_patch(uuid, jsonb, uuid) to authenticated;

comment on function public.update_person_patch(uuid, jsonb, uuid) is
  'Partial update of an individual. Key presence decides: absent leaves a column alone, present-and-empty clears it. Addresses are patched as a unit. While postal_same_as_residential is true no address_postal row is kept, so the postal address follows the residential one rather than becoming a stale copy. marital_status is cast to the enum of the same name since 15 Sep 2026.';
