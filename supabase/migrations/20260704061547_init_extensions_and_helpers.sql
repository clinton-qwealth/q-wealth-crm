-- Extensions
create extension if not exists pgcrypto with schema extensions;

-- Shared updated_at trigger function
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

comment on function public.set_updated_at is 'Sets updated_at to now() on row update. Attach as BEFORE UPDATE trigger.';
