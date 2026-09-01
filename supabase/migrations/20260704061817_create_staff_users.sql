-- staff_users: maps Supabase auth users to Q Wealth staff, with permission flags.
-- Anchor for all RLS policies and sensitive-data gating.
create table public.staff_users (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid unique references auth.users (id) on delete set null,
  email text not null unique,
  full_name text not null,
  is_admin boolean not null default false,
  view_sensitive boolean not null default false,
  status public.staff_status not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.staff_users is 'Q Wealth staff with permission flags. view_sensitive gates decryption of TFN and similar fields.';

create trigger trg_staff_users_updated_at
  before update on public.staff_users
  for each row execute function public.set_updated_at();

-- helper: is the calling auth user an active staff member?
-- security definer so RLS policies can use it without recursion.
create or replace function public.is_active_staff()
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  select
    case
      when current_user in ('postgres', 'service_role') then true
      else exists (
        select 1 from public.staff_users su
        where su.auth_user_id = (select auth.uid())
          and su.status = 'active'
      )
    end;
$$;

-- helper: does the calling user hold a specific permission?
create or replace function public.current_staff_has(p_permission text)
returns boolean
language plpgsql
security definer
stable
set search_path = ''
as $$
declare
  v_ok boolean;
begin
  if current_user in ('postgres', 'service_role') then
    return true;
  end if;
  select case p_permission
           when 'view_sensitive' then su.view_sensitive
           when 'admin' then su.is_admin
           else false
         end
    into v_ok
  from public.staff_users su
  where su.auth_user_id = (select auth.uid())
    and su.status = 'active';
  return coalesce(v_ok, false);
end;
$$;

revoke execute on function public.is_active_staff() from anon;
revoke execute on function public.current_staff_has(text) from anon;
