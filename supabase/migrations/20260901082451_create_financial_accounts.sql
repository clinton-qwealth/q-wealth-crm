-- Financial accounts (1 Sep 2026)
--
-- Ownership is a join table even for a single owner, so individual, joint and
-- entity-owned accounts are all the same shape. An owner column plus a "joint"
-- flag would mean two places to look and two code paths for the same question.
--
-- SMSF and trust are NOT account types. They are org_entity_type values on the
-- party model, so an SMSF's investment account is type `investment` owned by the
-- SMSF organisation. One way to express each thing, and "all SMSF assets"
-- becomes a query on owner entity type rather than a second, drifting truth.
--
-- Group membership is derived, not stored: an account belongs to the group(s) its
-- owners belong to, reusing staff_can_access_party. A stored group_id would drift
-- when ownership changes, and a joint account across two households genuinely
-- belongs to both.

create type public.financial_account_type as enum ('investment', 'superannuation');
create type public.financial_account_status as enum ('open', 'closed');

create table public.financial_accounts (
  id                 uuid primary key default gen_random_uuid(),
  account_type       public.financial_account_type not null,
  provider_party_id  uuid references public.parties(id) on delete restrict,
  label              text not null,
  account_number     text,
  status             public.financial_account_status not null default 'open',
  opened_on          date,
  closed_on          date,
  -- Row-local access escape. Without it the SELECT policy could not see a row
  -- during INSERT ... RETURNING, because the owners rows do not exist yet - the
  -- defect that broke add_note twice in August.
  created_by_staff_id uuid references public.staff_users(id),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint financial_accounts_closed_date check (status = 'closed' or closed_on is null),
  constraint financial_accounts_date_order check (
    closed_on is null or opened_on is null or closed_on >= opened_on
  )
);

comment on table public.financial_accounts is
  'Investment and superannuation accounts. Structure (SMSF, trust) is expressed by who owns the account, not by its type.';
comment on column public.financial_accounts.created_by_staff_id is
  'Lets the creator read the row before its owners exist. Required for INSERT ... RETURNING to pass the SELECT policy.';

create index financial_accounts_provider_idx on public.financial_accounts (provider_party_id);
create index financial_accounts_status_idx on public.financial_accounts (status);

create table public.financial_account_owners (
  account_id uuid not null references public.financial_accounts(id) on delete cascade,
  party_id   uuid not null references public.parties(id) on delete restrict,
  created_at timestamptz not null default now(),
  primary key (account_id, party_id)
);

comment on table public.financial_account_owners is
  'Who owns an account. One row for an individual or entity, two or more for a joint account. No shares: joint tenants is the common case, and percentages recorded once are rarely maintained.';

create index financial_account_owners_party_idx on public.financial_account_owners (party_id);

create table public.financial_account_valuations (
  id                  uuid primary key default gen_random_uuid(),
  account_id          uuid not null references public.financial_accounts(id) on delete cascade,
  -- numeric, never float: floating point cannot hold 0.10 exactly, so balances
  -- drift by cents as they are summed. These figures feed advice documents.
  value               numeric(14,2) not null,
  as_at               date not null,
  source              text,
  created_by_staff_id uuid references public.staff_users(id),
  created_at          timestamptz not null default now(),
  -- One figure per account per day. Two valuations for the same date is how
  -- "which number is right?" begins.
  unique (account_id, as_at)
);

comment on table public.financial_account_valuations is
  'Account value over time. An as-at date is what makes a balance defensible in advice, so values are a series rather than a column on the account.';

create index financial_account_valuations_account_idx
  on public.financial_account_valuations (account_id, as_at desc);

create or replace function public.staff_can_access_account(p_account_id uuid)
returns boolean language plpgsql stable security definer set search_path to ''
as $fn$
declare
  v_staff   uuid;
  v_creator uuid;
begin
  if public.is_elevated_context() then return true; end if;
  v_staff := public.current_staff_id();
  if v_staff is null then return false; end if;

  select created_by_staff_id into v_creator
  from public.financial_accounts where id = p_account_id;
  if not found then return false; end if;
  if v_creator = v_staff then return true; end if;

  return exists (
    select 1 from public.financial_account_owners o
    where o.account_id = p_account_id and public.staff_can_access_party(o.party_id)
  );
end
$fn$;

alter table public.financial_accounts enable row level security;
alter table public.financial_account_owners enable row level security;
alter table public.financial_account_valuations enable row level security;

-- Deliberately NOT staff_can_access_account() here: that helper re-reads
-- financial_accounts, which cannot see a row being inserted by the statement
-- currently executing. The conditions are inlined so the creator clause is
-- row-local and RETURNING works.
create policy accounts_select on public.financial_accounts
  for select to authenticated
  using (
    created_by_staff_id = public.current_staff_id()
    or exists (
      select 1 from public.financial_account_owners o
      where o.account_id = id and public.staff_can_access_party(o.party_id)
    )
  );

create policy accounts_insert on public.financial_accounts
  for insert to authenticated
  with check (public.is_active_staff() and created_by_staff_id = public.current_staff_id());

create policy accounts_update on public.financial_accounts
  for update to authenticated using (public.staff_can_access_account(id));

create policy accounts_delete on public.financial_accounts
  for delete to authenticated using (public.staff_can_access_account(id));

create policy account_owners_all on public.financial_account_owners
  for all to authenticated
  using (public.staff_can_access_account(account_id))
  with check (
    public.staff_can_access_account(account_id) and public.staff_can_access_party(party_id)
  );

create policy account_valuations_all on public.financial_account_valuations
  for all to authenticated
  using (public.staff_can_access_account(account_id))
  with check (public.staff_can_access_account(account_id));

create view public.financial_account_latest_valuation
with (security_invoker = true) as
  select distinct on (v.account_id) v.account_id, v.value, v.as_at, v.source
  from public.financial_account_valuations v
  order by v.account_id, v.as_at desc, v.created_at desc;

create view public.financial_accounts_summary
with (security_invoker = true) as
  select a.id as account_id, a.account_type, a.label, a.account_number, a.status,
         a.opened_on, a.closed_on,
         prov.display_name as provider,
         (select string_agg(p.display_name, ', ' order by p.display_name)
            from public.financial_account_owners o
            join public.parties p on p.id = o.party_id
           where o.account_id = a.id) as owners,
         (select count(*) from public.financial_account_owners o where o.account_id = a.id) as owner_count,
         lv.value as latest_value, lv.as_at as valued_on
  from public.financial_accounts a
  left join public.parties prov on prov.id = a.provider_party_id
  left join public.financial_account_latest_valuation lv on lv.account_id = a.id;

-- SECURITY INVOKER: RLS must still evaluate as the caller.
create or replace function public.create_financial_account(
  p_account_type      public.financial_account_type,
  p_label             text,
  p_owner_party_ids   uuid[],
  p_provider_party_id uuid    default null,
  p_account_number    text    default null,
  p_opened_on         date    default null,
  p_opening_value     numeric default null,
  p_valued_on         date    default null
) returns uuid language plpgsql security invoker set search_path to ''
as $fn$
declare
  v_account uuid;
  v_staff   uuid := public.current_staff_id();
  v_party   uuid;
begin
  if v_staff is null then raise exception 'Not an active staff member'; end if;
  if p_owner_party_ids is null or cardinality(p_owner_party_ids) = 0 then
    raise exception 'An account must have at least one owner';
  end if;
  if p_label is null or length(trim(p_label)) = 0 then
    raise exception 'An account needs a label';
  end if;

  insert into public.financial_accounts
    (account_type, label, provider_party_id, account_number, opened_on, created_by_staff_id)
  values
    (p_account_type, trim(p_label), p_provider_party_id, p_account_number, p_opened_on, v_staff)
  returning id into v_account;

  foreach v_party in array p_owner_party_ids loop
    insert into public.financial_account_owners (account_id, party_id) values (v_account, v_party);
  end loop;

  if p_opening_value is not null then
    insert into public.financial_account_valuations
      (account_id, value, as_at, source, created_by_staff_id)
    values (v_account, p_opening_value, coalesce(p_valued_on, current_date), 'manual', v_staff);
  end if;

  return v_account;
end
$fn$;

create trigger trg_financial_accounts_updated_at
  before update on public.financial_accounts
  for each row execute function public.set_updated_at();

-- Ownership changes are exactly what a regulator asks about, so all three tables
-- are in the audit trail. Owners has a composite key; the account id is the
-- meaningful record reference.
create trigger trg_financial_accounts_audit
  after insert or update or delete on public.financial_accounts
  for each row execute function public.record_audit('id', '');
create trigger trg_financial_account_owners_audit
  after insert or update or delete on public.financial_account_owners
  for each row execute function public.record_audit('account_id', '');
create trigger trg_financial_account_valuations_audit
  after insert or update or delete on public.financial_account_valuations
  for each row execute function public.record_audit('id', '');

-- `from public, anon` and not just `from anon`: Postgres grants EXECUTE to PUBLIC
-- by default and anon inherits it. Getting this wrong was the defect fixed twice
-- on 31 August.
revoke all on function public.staff_can_access_account(uuid) from public, anon;
revoke all on function public.create_financial_account(
  public.financial_account_type, text, uuid[], uuid, text, date, numeric, date) from public, anon;
grant execute on function public.staff_can_access_account(uuid) to authenticated;
grant execute on function public.create_financial_account(
  public.financial_account_type, text, uuid[], uuid, text, date, numeric, date) to authenticated;

revoke all on public.financial_accounts from anon;
revoke all on public.financial_account_owners from anon;
revoke all on public.financial_account_valuations from anon;
revoke all on public.financial_account_latest_valuation from anon;
revoke all on public.financial_accounts_summary from anon;

grant select, insert, update, delete on public.financial_accounts to authenticated;
grant select, insert, update, delete on public.financial_account_owners to authenticated;
grant select, insert, update, delete on public.financial_account_valuations to authenticated;
grant select on public.financial_account_latest_valuation to authenticated;
grant select on public.financial_accounts_summary to authenticated;
