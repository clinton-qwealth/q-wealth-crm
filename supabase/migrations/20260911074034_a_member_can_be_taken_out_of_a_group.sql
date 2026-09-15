-- A member can be taken out of a group (11 Sep 2026)
--
-- The member panel's Memberships tab grew a Remove control, and until now there
-- was no write path for it: a party could be added to a group and never taken
-- out, from the app, the MCP or psql. This is that path, and it is a function
-- rather than an UPDATE inside the server action for the usual reason -- it
-- binds every caller, not only the button that prompted it.
--
-- ENDING, NOT DELETING, chosen with the reader on 11 Sep. The membership row
-- gets an end_date; it is not removed. Every read in the application already
-- filters `end_date is null` -- the members sheet, the person loader, the two
-- group views behind the accounts and insurance tabs -- so one UPDATE takes the
-- person out of the group's members, its accounts, its policies, its wealth
-- figures and its mix ring at once, while the fact that they were ever there
-- survives. Deleting would look identical today and answer nothing later;
-- client_group_members carries no audit trigger, so nothing else holds it.
--
-- THE PRIMARY CONTACT IS REFUSED, and it is not an edge case. Every group in
-- the database has exactly one current member who is also its
-- primary_contact_party_id, and one group has only that member. Ending their
-- membership would leave client_groups.primary_contact_party_id pointing at
-- somebody the group no longer contains: the group page would name a contact
-- the members sheet does not list, and nothing would say so. The refusal names
-- the person and says what to do instead. There is no screen for changing a
-- group's primary contact yet, so for now this does block removing that one
-- person per group -- the intended trade, taken over letting the two disagree.
--
-- is_primary_group IS LEFT AS IT WAS on the ended row. It is history now, and
-- every query that reads the flag also filters end_date, so a stale true cannot
-- be seen; the partial unique index behind it is likewise restricted to current
-- rows, so the person can be made primary elsewhere immediately. It does mean
-- ending somebody's primary membership leaves them with no primary group until
-- they join one, which add_party_to_group then handles -- it makes a first
-- membership primary.
--
-- ## The branch found a silent success, and that is why the row count is checked
--
-- The first version of this function had no `get diagnostics` and was WRONG in
-- a way no amount of reading would have shown. Probed on a throwaway branch as
-- an ordinary `authenticated` staff member holding view_all_groups but NOT
-- manage_groups: the call **returned successfully and changed nothing**.
--
-- The reason is the split between the two policies on this table. SELECT is
-- `staff_can_access_group(group_id)` alone, so that staff member can read the
-- membership and sails through the existence guard above. UPDATE additionally
-- requires `current_staff_has('manage_groups')`, so row-level security filtered
-- the UPDATE to zero rows -- and an UPDATE that matches nothing is not an
-- error. The server action would have reported success, the page would have
-- revalidated, and the member would still have been there.
--
-- So the row count is checked and a zero raises. The function adds guards; it
-- does not add reach, and it must not report reach it does not have.

create or replace function public.end_group_membership(
  p_group_id uuid,
  p_party_id uuid
)
returns void
language plpgsql
set search_path to ''
as $function$
declare
  v_name text;
  v_rows int;
begin
  if public.current_staff_id() is null then
    raise exception 'Not an active staff member';
  end if;

  if not exists (
    select 1 from public.client_group_members m
     where m.group_id = p_group_id and m.party_id = p_party_id and m.end_date is null
  ) then
    raise exception 'That person is not a current member of this group';
  end if;

  -- Named in the message: "the primary contact" is not useful to somebody
  -- looking at a panel that already has a name in its heading.
  select p.display_name
    into v_name
    from public.client_groups g
    join public.parties p on p.id = g.primary_contact_party_id
   where g.id = p_group_id and g.primary_contact_party_id = p_party_id;

  if v_name is not null then
    raise exception
      '% is this group''s primary contact. Name a different primary contact before removing them.', v_name;
  end if;

  update public.client_group_members
     set end_date = current_date,
         updated_at = now()
   where group_id = p_group_id
     and party_id = p_party_id
     and end_date is null;

  get diagnostics v_rows = row_count;

  -- Zero rows here means row-level security filtered the update out from under
  -- a caller who could read the row but may not change it. See the header.
  if v_rows = 0 then
    raise exception 'You do not have permission to change this group''s members';
  end if;
end $function$;

comment on function public.end_group_membership(uuid, uuid) is
  'Ends a party''s membership of a group by setting end_date, which removes them from every view the application reads. Refuses the group''s own primary contact, and refuses a caller whose row-level permissions filter the update to nothing rather than reporting success. Added 11 Sep 2026 for the member panel''s Memberships tab.';

-- SECURITY INVOKER (the default) -- it runs as the caller, so the UPDATE is
-- checked by scoped_update_client_group_members, which already requires
-- staff_can_access_group(group_id) AND current_staff_has('manage_groups').
--
-- PostgreSQL grants EXECUTE on every new function to PUBLIC as built-in
-- behaviour, and every role inherits from PUBLIC. This revoke is load-bearing
-- and must never be treated as boilerplate; revoking from anon alone is not
-- enough. Verified on the branch: public no, anon no, authenticated yes.
revoke all on function public.end_group_membership(uuid, uuid) from public, anon;
grant execute on function public.end_group_membership(uuid, uuid) to authenticated;
