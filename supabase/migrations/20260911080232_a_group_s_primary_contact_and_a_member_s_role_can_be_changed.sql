-- A group's primary contact, and a member's role, can be changed (11 Sep 2026)
--
-- The member panel's Memberships tab grew an edit control for the group it was
-- opened from. Two write paths, neither of which existed: a role was set when
-- somebody was added and never afterwards, and a group's primary contact was
-- set at creation and never afterwards at all.
--
-- ## Why the primary contact is the thing being edited
--
-- Three columns in this schema could be called "primary", and only one is a
-- per-group singleton:
--
--   * client_group_members.is_primary_group -- per PERSON. Four of the five
--     current members of one household have it, because that household is the
--     main group for each of them. Not a group-level fact at all.
--   * client_group_members.member_role = 'primary' -- a role among eight, and
--     one group currently has nobody holding it.
--   * client_groups.primary_contact_party_id -- exactly one per group, always,
--     and already what the group page prints as "Primary contact".
--
-- The reader chose the third on 11 Sep. It is the only one where "every group
-- has one" is already true and stays true by construction: this function MOVES
-- the contact from one member to another, so there is no state in which a group
-- has none. That also unblocks end_group_membership(), which refuses to remove
-- the contact and until now had nowhere to send the reader.
--
-- ## The row count is checked, for the reason the last migration found
--
-- Both tables split their policies the same way: SELECT is
-- staff_can_access_group(...) alone, while UPDATE also requires
-- current_staff_has('manage_groups'). So a staff member who can read a group
-- passes every guard below and then has the UPDATE filtered to zero rows by
-- row-level security -- and an UPDATE that matches nothing is not an error.
-- Without `get diagnostics` these would report success and change nothing,
-- which is exactly what end_group_membership() did on the branch before it was
-- caught. Verified the same way here.

create or replace function public.set_group_primary_contact(
  p_group_id uuid,
  p_party_id uuid
)
returns void
language plpgsql
set search_path to ''
as $function$
declare
  v_rows int;
begin
  if public.current_staff_id() is null then
    raise exception 'Not an active staff member';
  end if;

  -- The contact has to be somebody the group actually contains. Without this a
  -- group could point at a stranger, which is the state end_group_membership()
  -- exists to prevent from the other direction.
  if not exists (
    select 1 from public.client_group_members m
     where m.group_id = p_group_id and m.party_id = p_party_id and m.end_date is null
  ) then
    raise exception 'Only a current member of this group can be its primary contact';
  end if;

  update public.client_groups
     set primary_contact_party_id = p_party_id,
         updated_at = now()
   where id = p_group_id;

  get diagnostics v_rows = row_count;
  if v_rows = 0 then
    raise exception 'You do not have permission to change this group';
  end if;
end $function$;

comment on function public.set_group_primary_contact(uuid, uuid) is
  'Moves a group''s primary contact to another CURRENT member, so a group never has none. Added 11 Sep 2026 for the member panel''s Memberships tab.';

create or replace function public.set_member_role(
  p_group_id uuid,
  p_party_id uuid,
  p_member_role public.member_role
)
returns void
language plpgsql
set search_path to ''
as $function$
declare
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

  update public.client_group_members
     set member_role = p_member_role,
         updated_at = now()
   where group_id = p_group_id
     and party_id = p_party_id
     and end_date is null;

  get diagnostics v_rows = row_count;
  if v_rows = 0 then
    raise exception 'You do not have permission to change this group''s members';
  end if;
end $function$;

comment on function public.set_member_role(uuid, uuid, public.member_role) is
  'Changes a current member''s role within a group. Added 11 Sep 2026 for the member panel''s Memberships tab; a role was previously set on joining and never afterwards.';

-- PostgreSQL grants EXECUTE on every new function to PUBLIC as built-in
-- behaviour and every role inherits from PUBLIC, so these revokes are
-- load-bearing rather than boilerplate. Both functions are SECURITY INVOKER
-- (the default): they add guards, not reach.
revoke all on function public.set_group_primary_contact(uuid, uuid) from public, anon;
revoke all on function public.set_member_role(uuid, uuid, public.member_role) from public, anon;
grant execute on function public.set_group_primary_contact(uuid, uuid) to authenticated;
grant execute on function public.set_member_role(uuid, uuid, public.member_role) to authenticated;
