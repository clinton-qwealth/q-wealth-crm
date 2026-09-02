-- Personal insurance (2 Sep 2026)
--
-- Deliberately NOT folded into financial_accounts. Four things differ in kind:
--   * a benefit is a contractual amount, not a market value, so it has no place
--     in financial_account_valuations and no meaningful 30-day trend
--   * a policy has a life insured, which may not be the owner
--   * one policy commonly bundles several covers, each with its own amount
--   * premiums have a frequency and a structure
-- Sharing a table would make every column nullable for half the rows and turn
-- every rule into a conditional check.

create type public.insurance_cover_type as enum
  ('life', 'tpd', 'trauma', 'income_protection');

create type public.insurance_policy_status as enum
  ('in_force', 'lapsed', 'cancelled');

create type public.premium_frequency as enum
  ('monthly', 'quarterly', 'half_yearly', 'yearly');

create type public.premium_structure as enum
  ('stepped', 'level', 'hybrid');

-- owner and life insured are usually the same person: that is two rows for one
-- party, not a special case.
create type public.policy_party_role as enum ('owner', 'life_insured');

-- A lump sum and a monthly benefit are different quantities. Storing which one
-- an amount is, rather than letting each consumer infer it from cover_type,
-- means the row explains itself to the web app, to the MCP and to anything
-- added later. An implicit convention is exactly what gets misread.
create type public.benefit_basis as enum ('lump_sum', 'monthly', 'annual');

create table public.insurance_policies (
  id uuid primary key default gen_random_uuid(),
  provider_party_id uuid references public.parties(id) on delete restrict,
  policy_number text not null,
  label text not null,
  status public.insurance_policy_status not null default 'in_force',
  commenced_on date,
  cancelled_on date,
  premium numeric(12,2),
  premium_frequency public.premium_frequency,
  premium_structure public.premium_structure,
  -- Cover held inside a super fund is owned by the trustee, not the member.
  -- Nullable: most retail policies are held directly.
  held_in_account_id uuid references public.financial_accounts(id) on delete set null,
  created_by_staff_id uuid references public.staff_users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint insurance_policies_number_not_blank
    check (length(trim(policy_number)) > 0),
  constraint insurance_policies_label_not_blank
    check (length(trim(label)) > 0),
  constraint insurance_policies_cancelled_date
    check (status = 'cancelled' or cancelled_on is null),
  constraint insurance_policies_date_order
    check (cancelled_on is null or commenced_on is null or cancelled_on >= commenced_on),
  -- A premium without a frequency is not an amount anyone can act on.
  constraint insurance_policies_premium_pair
    check ((premium is null) = (premium_frequency is null)),
  constraint insurance_policies_premium_positive
    check (premium is null or premium > 0)
);

create index insurance_policies_provider_idx
  on public.insurance_policies (provider_party_id);
create index insurance_policies_held_in_idx
  on public.insurance_policies (held_in_account_id)
  where held_in_account_id is not null;

create trigger trg_insurance_policies_updated_at
  before update on public.insurance_policies
  for each row execute function public.set_updated_at();

create table public.insurance_policy_parties (
  policy_id uuid not null references public.insurance_policies(id) on delete cascade,
  party_id uuid not null references public.parties(id) on delete restrict,
  role public.policy_party_role not null,
  created_at timestamptz not null default now(),
  primary key (policy_id, party_id, role)
);

create index insurance_policy_parties_party_idx
  on public.insurance_policy_parties (party_id);

create table public.insurance_policy_covers (
  id uuid primary key default gen_random_uuid(),
  policy_id uuid not null references public.insurance_policies(id) on delete cascade,
  cover_type public.insurance_cover_type not null,
  benefit_amount numeric(14,2) not null,
  benefit_basis public.benefit_basis not null,
  benefit_period text,
  waiting_period text,
  indexed boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- One Life cover per policy. A second would be a separate policy.
  unique (policy_id, cover_type),
  constraint insurance_policy_covers_amount_positive check (benefit_amount > 0)
);

create trigger trg_insurance_policy_covers_updated_at
  before update on public.insurance_policy_covers
  for each row execute function public.set_updated_at();

-- Column documentation, so the schema explains itself to anything reading it.
comment on table public.insurance_policies is
  'Personal insurance policies. One row per policy number; the covers it bundles live in insurance_policy_covers.';
comment on column public.insurance_policies.premium is
  'What is actually debited, at premium_frequency. Policy-level rather than per-cover so there is one unambiguous figure; per-cover premiums can be added later without changing this.';
comment on column public.insurance_policies.held_in_account_id is
  'Set when the policy is held inside a superannuation account rather than owned directly.';
comment on column public.insurance_policy_parties.role is
  'owner = holds the contract. life_insured = the person covered. Commonly the same party, recorded as two rows.';
comment on column public.insurance_policy_covers.benefit_amount is
  'The amount payable. Read together with benefit_basis: a lump sum for life/tpd/trauma, a per-month figure for income protection. Never interpret without the basis.';
comment on column public.insurance_policy_covers.benefit_basis is
  'Whether benefit_amount is a lump_sum, or an income stream expressed monthly or annually.';
