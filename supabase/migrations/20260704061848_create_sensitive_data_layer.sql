-- party_sensitive_data: encrypted sensitive values (TFN, passport, etc). No direct access.
create table public.party_sensitive_data (
  id uuid primary key default gen_random_uuid(),
  party_id uuid not null references public.parties (id) on delete cascade,
  field_kind public.sensitive_field_kind not null,
  value_encrypted bytea not null,
  masked_hint text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint party_sensitive_data_unique unique (party_id, field_kind)
);
comment on table public.party_sensitive_data is 'Encrypted sensitive values. RLS deny-all: access only via set_sensitive_field / reveal_sensitive_field.';

create trigger trg_party_sensitive_data_updated_at
  before update on public.party_sensitive_data
  for each row execute function public.set_updated_at();

-- sensitive_access_log: every write and reveal is recorded
create table public.sensitive_access_log (
  id uuid primary key default gen_random_uuid(),
  party_id uuid not null,
  field_kind public.sensitive_field_kind not null,
  action public.sensitive_action not null,
  auth_user_id uuid,
  db_user text not null default current_user,
  occurred_at timestamptz not null default now()
);
comment on table public.sensitive_access_log is 'Audit trail of all sensitive-field writes and reveals. Append-only.';

create index sensitive_access_log_party_idx on public.sensitive_access_log (party_id, occurred_at desc);

-- internal: fetch the encryption key from Supabase Vault
create or replace function public.get_sensitive_key()
returns text
language plpgsql
security definer
stable
set search_path = ''
as $$
declare
  v_key text;
begin
  select decrypted_secret into v_key
  from vault.decrypted_secrets
  where name = 'sensitive_data_key';
  if v_key is null then
    raise exception 'Encryption key sensitive_data_key not found in Vault';
  end if;
  return v_key;
end;
$$;
revoke all on function public.get_sensitive_key() from public, anon, authenticated;

-- write a sensitive value (encrypts, stores masked hint, logs)
create or replace function public.set_sensitive_field(
  p_party_id uuid,
  p_kind public.sensitive_field_kind,
  p_value text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.current_staff_has('view_sensitive') then
    raise exception 'Permission denied: view_sensitive required';
  end if;
  if p_value is null or length(trim(p_value)) = 0 then
    raise exception 'Value must not be empty';
  end if;

  insert into public.party_sensitive_data (party_id, field_kind, value_encrypted, masked_hint)
  values (
    p_party_id,
    p_kind,
    extensions.pgp_sym_encrypt(p_value, public.get_sensitive_key()),
    repeat('•', greatest(length(p_value) - 3, 0)) || right(p_value, 3)
  )
  on conflict (party_id, field_kind)
  do update set
    value_encrypted = excluded.value_encrypted,
    masked_hint = excluded.masked_hint,
    updated_at = now();

  insert into public.sensitive_access_log (party_id, field_kind, action, auth_user_id)
  values (p_party_id, p_kind, 'write', (select auth.uid()));
end;
$$;

-- reveal a sensitive value (permission-checked, decrypts, logs)
create or replace function public.reveal_sensitive_field(
  p_party_id uuid,
  p_kind public.sensitive_field_kind
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_value text;
begin
  if not public.current_staff_has('view_sensitive') then
    raise exception 'Permission denied: view_sensitive required';
  end if;

  select extensions.pgp_sym_decrypt(value_encrypted, public.get_sensitive_key())
    into v_value
  from public.party_sensitive_data
  where party_id = p_party_id and field_kind = p_kind;

  if v_value is null then
    return null;
  end if;

  insert into public.sensitive_access_log (party_id, field_kind, action, auth_user_id)
  values (p_party_id, p_kind, 'reveal', (select auth.uid()));

  return v_value;
end;
$$;

-- read-only masked hints for everyday screens (no permission needed beyond staff)
create or replace function public.get_masked_hint(
  p_party_id uuid,
  p_kind public.sensitive_field_kind
)
returns text
language sql
security definer
stable
set search_path = ''
as $$
  select case when public.is_active_staff()
    then (select masked_hint from public.party_sensitive_data
          where party_id = p_party_id and field_kind = p_kind)
    else null end;
$$;

revoke execute on function public.set_sensitive_field(uuid, public.sensitive_field_kind, text) from anon;
revoke execute on function public.reveal_sensitive_field(uuid, public.sensitive_field_kind) from anon;
revoke execute on function public.get_masked_hint(uuid, public.sensitive_field_kind) from anon;
