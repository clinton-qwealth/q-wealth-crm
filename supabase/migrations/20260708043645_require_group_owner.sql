-- R9: every client group must have an owning staff member (usually the servicing adviser).
-- Creators who are not the owner (e.g. operations staff) must specify who the owner is.
alter table public.client_groups alter column owner_staff_id set not null;
comment on column public.client_groups.owner_staff_id is 'Owning staff member (usually the servicing adviser). Required: creation flows must ask for the owner when the creator is not an adviser.';
