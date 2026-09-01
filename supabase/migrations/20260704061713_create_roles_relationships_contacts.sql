-- party_roles: what a party is to Q Wealth (a party can hold many roles, with history)
create table public.party_roles (
  id uuid primary key default gen_random_uuid(),
  party_id uuid not null references public.parties (id) on delete cascade,
  role public.party_role_type not null,
  status public.role_status not null default 'active',
  start_date date not null default current_date,
  end_date date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint party_roles_dates check (end_date is null or end_date >= start_date)
);
comment on table public.party_roles is 'Roles a party holds with Q Wealth (client, referral_partner, etc). History kept via start/end dates.';

create unique index party_roles_one_open_per_role
  on public.party_roles (party_id, role)
  where end_date is null;
create index party_roles_party_idx on public.party_roles (party_id);

create trigger trg_party_roles_updated_at
  before update on public.party_roles
  for each row execute function public.set_updated_at();

-- party_relationships: party-to-party links (spouse_of, trustee_of, director_of, ...)
create table public.party_relationships (
  id uuid primary key default gen_random_uuid(),
  from_party_id uuid not null references public.parties (id) on delete cascade,
  to_party_id uuid not null references public.parties (id) on delete cascade,
  relationship_type public.relationship_type not null,
  start_date date,
  end_date date,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint party_relationships_not_self check (from_party_id <> to_party_id),
  constraint party_relationships_dates check (end_date is null or start_date is null or end_date >= start_date)
);
comment on table public.party_relationships is 'Directed party-to-party relationships, e.g. Jane trustee_of Smith Family Trust.';

create unique index party_relationships_one_open
  on public.party_relationships (from_party_id, to_party_id, relationship_type)
  where end_date is null;
create index party_relationships_from_idx on public.party_relationships (from_party_id);
create index party_relationships_to_idx on public.party_relationships (to_party_id);

create trigger trg_party_relationships_updated_at
  before update on public.party_relationships
  for each row execute function public.set_updated_at();

-- contact_points: all contact details attach once to the party
create table public.contact_points (
  id uuid primary key default gen_random_uuid(),
  party_id uuid not null references public.parties (id) on delete cascade,
  kind public.contact_kind not null,
  value text,
  address_line_1 text,
  address_line_2 text,
  suburb text,
  state text,
  postcode text,
  country text default 'Australia',
  is_preferred boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint contact_points_value_or_address check (
    (kind in ('email', 'phone_mobile', 'phone_other') and value is not null)
    or (kind in ('address_residential', 'address_postal', 'address_business') and address_line_1 is not null)
  )
);
comment on table public.contact_points is 'Emails, phones and addresses. Attached once per party; every role sees the same details.';

create index contact_points_party_idx on public.contact_points (party_id);
create unique index contact_points_one_preferred_per_kind
  on public.contact_points (party_id, kind)
  where is_preferred;

create trigger trg_contact_points_updated_at
  before update on public.contact_points
  for each row execute function public.set_updated_at();
