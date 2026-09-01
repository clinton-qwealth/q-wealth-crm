-- parties: one row per real-world person or organisation
create table public.parties (
  id uuid primary key default gen_random_uuid(),
  party_type public.party_type not null,
  display_name text,
  status public.record_status not null default 'active',
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.parties is 'Party model base: one row per real-world person or organisation. Roles and relationships layer on top.';

create trigger trg_parties_updated_at
  before update on public.parties
  for each row execute function public.set_updated_at();

-- persons: subtype of parties (1:1)
create table public.persons (
  party_id uuid primary key references public.parties (id) on delete cascade,
  title text,
  first_name text not null,
  middle_name text,
  last_name text not null,
  preferred_name text,
  date_of_birth date,
  gender text,
  marital_status text,
  tfn_status public.tfn_status not null default 'not_provided',
  date_of_death date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.persons is 'Person subtype of parties. Actual TFN is stored encrypted in party_sensitive_data, only status here.';

create trigger trg_persons_updated_at
  before update on public.persons
  for each row execute function public.set_updated_at();

-- organisations: subtype of parties (1:1) - trusts, companies, SMSFs, partnerships
create table public.organisations (
  party_id uuid primary key references public.parties (id) on delete cascade,
  legal_name text not null,
  entity_type public.org_entity_type not null,
  abn text,
  acn text,
  establishment_date date,
  trustee_party_id uuid references public.parties (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.organisations is 'Organisation subtype of parties: trusts, companies, SMSFs, partnerships. Full trustee history lives in party_relationships.';

create trigger trg_organisations_updated_at
  before update on public.organisations
  for each row execute function public.set_updated_at();

-- keep parties.display_name in sync with subtype rows
create or replace function public.refresh_party_display_name()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_name text;
  v_party_id uuid;
begin
  if tg_table_name = 'persons' then
    v_party_id := new.party_id;
    v_name := trim(coalesce(new.preferred_name, new.first_name) || ' ' || new.last_name);
  else
    v_party_id := new.party_id;
    v_name := new.legal_name;
  end if;
  update public.parties set display_name = v_name where id = v_party_id;
  return new;
end;
$$;

create trigger trg_persons_display_name
  after insert or update of first_name, last_name, preferred_name on public.persons
  for each row execute function public.refresh_party_display_name();

create trigger trg_organisations_display_name
  after insert or update of legal_name on public.organisations
  for each row execute function public.refresh_party_display_name();
