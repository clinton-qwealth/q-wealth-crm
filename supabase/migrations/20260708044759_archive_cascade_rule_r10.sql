-- R10: archiving a party ends all active participation, in the same transaction.
-- Open roles, group memberships and relationships are end-dated (history preserved),
-- and the party is removed as any group's primary contact.
create or replace function public.cascade_party_archive()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'archived' and old.status <> 'archived' then
    update public.party_roles
      set end_date = current_date, status = 'inactive'
      where party_id = new.id and end_date is null;

    update public.client_group_members
      set end_date = current_date
      where party_id = new.id and end_date is null;

    update public.party_relationships
      set end_date = current_date
      where (from_party_id = new.id or to_party_id = new.id) and end_date is null;

    update public.client_groups
      set primary_contact_party_id = null
      where primary_contact_party_id = new.id;
  end if;
  return new;
end;
$$;
revoke all on function public.cascade_party_archive() from public, anon, authenticated;

create trigger trg_parties_archive_cascade
  after update of status on public.parties
  for each row execute function public.cascade_party_archive();
