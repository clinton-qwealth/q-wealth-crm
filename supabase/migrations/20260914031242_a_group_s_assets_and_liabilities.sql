-- A group's assets and liabilities (14 Sep 2026)
--
-- The Assets + Liabilities tab has been a placeholder since 6 September, and
-- nothing behind it existed: thirty-six tables and not one column naming an
-- asset, a debt or a value outside investment accounts. This is the table.
--
-- It is also the join point `lib/wealth.ts` has been waiting for. That file
-- computes the three headline figures with `otherAssets = 0` and
-- `liabilities = 0` named as constants, which is why Total wealth, Total
-- investments and Total assets are the same number today and two of them carry
-- a tooltip admitting it. Those zeros stop being zeros now.
--
-- ## One table, and the SIDE IS DERIVED
--
-- Assets and liabilities share every column that matters -- a label, a value, a
-- date, owners, a status -- so they share a table. What they do not share is a
-- type, and the temptation is to store `side` beside `item_type` and trust the
-- two to agree. They would not: nothing stops a row carrying
-- ('home_loan', 'asset') and nothing would notice.
--
-- So `side` is a STORED GENERATED column computed from `item_type`. It cannot
-- disagree, there is no write path that could make it disagree, and adding a
-- type to the enum without deciding its side is a migration that will not
-- apply. The CASE is immutable, which is what generation requires.
--
-- ## Values are POSITIVE on both sides
--
-- A liability's value is the amount owed, not a negative asset. `side` is what
-- says which way it counts, and the arithmetic lives in one place. Signed
-- balances read fine until somebody sums a mixed list without checking, and
-- then the error is silent and plausible -- which is the worst kind.
--
-- ## Ownership carries a SHARE, and this departs from a recorded decision
--
-- `financial_account_owners` says in its own comment: "No shares: joint tenants
-- is the common case, and percentages recorded once are rarely maintained."
-- That is sound for a platform account. It is not sound here. Tenants in common
-- at other than half each is ordinary for an investment property, and a share
-- is the whole reason a per-member figure can be produced at all.
--
-- So the two ownership models differ on purpose. This is written down because
-- the next person to read both tables will otherwise take one of them for an
-- oversight and "fix" it.

create type public.asset_liability_type as enum (
  -- Assets
  'principal_residence',
  'investment_property',
  'holiday_home_or_land',
  'commercial_property',
  'cash_at_bank',
  'term_deposit',
  'motor_vehicle',
  'boat_or_caravan',
  'home_contents',
  'collectibles_and_art',
  'business_interest',
  'other_asset',
  -- Liabilities
  'home_loan',
  'investment_property_loan',
  'line_of_credit',
  'margin_loan',
  'personal_loan',
  'car_loan',
  'credit_card',
  'hecs_help',
  'business_loan',
  'other_liability'
);

create type public.balance_side as enum ('asset', 'liability');

-- 'closed' is a sold asset or a repaid loan. One word for both, because the
-- question every reader asks of such a row is the same: does it still count?
create type public.asset_liability_status as enum ('active', 'closed');

/**
 * Which side of the balance sheet a type sits on.
 *
 * IMMUTABLE so a generated column may use it, and a function rather than an
 * inline CASE so the list exists once: the views, the triggers and the column
 * all ask the same question of the same code.
 */
create or replace function public.balance_side_of(p_type public.asset_liability_type)
returns public.balance_side
language sql
immutable
set search_path to ''
as $function$
  select case p_type
    when 'principal_residence'      then 'asset'
    when 'investment_property'      then 'asset'
    when 'holiday_home_or_land'     then 'asset'
    when 'commercial_property'      then 'asset'
    when 'cash_at_bank'             then 'asset'
    when 'term_deposit'             then 'asset'
    when 'motor_vehicle'            then 'asset'
    when 'boat_or_caravan'          then 'asset'
    when 'home_contents'            then 'asset'
    when 'collectibles_and_art'     then 'asset'
    when 'business_interest'        then 'asset'
    when 'other_asset'              then 'asset'
    else 'liability'
  end::public.balance_side;
$function$;

comment on function public.balance_side_of(public.asset_liability_type) is
  'Which side of the balance sheet a type sits on. Immutable, so assets_liabilities.side can be a stored generated column and can never disagree with its own type.';

create table public.assets_liabilities (
  id          uuid primary key default gen_random_uuid(),
  item_type   public.asset_liability_type not null,
  -- Derived, never written. See the header.
  side        public.balance_side generated always as (public.balance_side_of(item_type)) stored,
  label       text not null,
  -- numeric, never float: floating point cannot hold 0.10 exactly, so balances
  -- drift by cents as they are summed, and these figures reach advice
  -- documents. The same rule financial_account_valuations follows.
  value       numeric(14,2) not null,
  valued_on   date not null default current_date,
  status      public.asset_liability_status not null default 'active',
  closed_on   date,
  -- The lender on a loan, the bank on a cash account. One column because it is
  -- one relationship -- "the institution behind this" -- and naming it twice
  -- would mean two nullable columns of which exactly one is ever set.
  institution_party_id uuid references public.parties(id) on delete restrict,
  -- The asset this liability is secured against. Self-referential and OPTIONAL:
  -- a credit card is secured against nothing. `set null` rather than `cascade`,
  -- because selling the house does not repay the loan -- the debt outlives the
  -- security and must not vanish with it.
  secured_against_id uuid references public.assets_liabilities(id) on delete set null,
  notes       text,
  -- Row-local access escape. Without it the SELECT policy cannot see a row
  -- during INSERT ... RETURNING, because the owner rows do not exist yet -- the
  -- defect that broke add_note twice in August and that financial_accounts
  -- carries this column for.
  created_by_staff_id uuid references public.staff_users(id),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  constraint assets_liabilities_label_not_blank check (length(trim(label)) > 0),
  -- A value of zero is meaningful (a repaid loan, a written-off asset); a
  -- negative one is a sign error. See the header.
  constraint assets_liabilities_value_positive check (value >= 0),
  -- Paired, both ways: only a closed row may carry a closing date, and a closed
  -- row without one is a record nobody can date.
  constraint assets_liabilities_closed_pair
    check ((status = 'closed') = (closed_on is not null)),
  constraint assets_liabilities_not_secured_against_itself
    check (secured_against_id is null or secured_against_id <> id)
);

comment on table public.assets_liabilities is
  'Everything on a group''s balance sheet except investment and superannuation accounts, which keep their own table and valuation series. One row per asset or liability; `side` is derived from `item_type` and cannot be written. Values are POSITIVE on both sides -- a liability''s value is the amount owed. Added 14 Sep 2026.';

comment on column public.assets_liabilities.side is
  'Derived from item_type by balance_side_of(). Generated, so no row can claim a side its type does not have.';

comment on column public.assets_liabilities.value is
  'Always positive, on both sides. `side` says which way it counts; a signed balance is where a silent sum error begins.';

comment on column public.assets_liabilities.secured_against_id is
  'The asset this liability is secured against, e.g. a home loan against the residence. Optional. Enforced by trigger rather than a check constraint, because the rule reads another row: the holder must be a liability and the target an asset.';

create index assets_liabilities_side_idx on public.assets_liabilities (side);
create index assets_liabilities_status_idx on public.assets_liabilities (status);
create index assets_liabilities_institution_idx
  on public.assets_liabilities (institution_party_id)
  where institution_party_id is not null;
create index assets_liabilities_secured_idx
  on public.assets_liabilities (secured_against_id)
  where secured_against_id is not null;

create table public.asset_liability_owners (
  item_id       uuid not null references public.assets_liabilities(id) on delete cascade,
  party_id      uuid not null references public.parties(id) on delete restrict,
  -- numeric(5,2), so 33.33 and 66.67 are both expressible and the pair still
  -- totals exactly 100. Three owners of a third each is the case that forces
  -- decimals; integers would make it unrepresentable.
  share_percent numeric(5,2) not null,
  created_at    timestamptz not null default now(),
  primary key (item_id, party_id),
  constraint asset_liability_owners_share_range
    check (share_percent > 0 and share_percent <= 100)
);

comment on table public.asset_liability_owners is
  'Who owns an item and in what share. UNLIKE financial_account_owners, which deliberately records no share -- tenants in common at other than half each is ordinary for property, and a share is what makes a per-member figure possible. Shares on one item must total exactly 100, enforced at COMMIT.';

create index asset_liability_owners_party_idx on public.asset_liability_owners (party_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- Integrity: an item has owners, the shares total 100, and a security link
-- points the right way.
--
-- All three are DEFERRED constraint triggers, because each reads rows that do
-- not exist yet when the parent is inserted. Each opens by checking the parent
-- still exists: a deferred check fires at COMMIT even for a row created and
-- deleted inside one transaction, which is the correction migration
-- 20260901082823 exists to make.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.enforce_item_has_owner()
returns trigger
language plpgsql
set search_path to ''
as $function$
begin
  -- Created and removed inside the same transaction: nothing left to protect.
  if not exists (select 1 from public.assets_liabilities a where a.id = new.id) then
    return null;
  end if;

  if not exists (select 1 from public.asset_liability_owners o where o.item_id = new.id) then
    raise exception 'An asset or liability must have at least one owner';
  end if;

  return null;
end
$function$;

create or replace function public.enforce_item_shares_total()
returns trigger
language plpgsql
set search_path to ''
as $function$
declare
  v_item  uuid := coalesce(new.item_id, old.item_id);
  v_total numeric(6,2);
begin
  if not exists (select 1 from public.assets_liabilities a where a.id = v_item) then
    return null;
  end if;

  select coalesce(sum(share_percent), 0)
    into v_total
    from public.asset_liability_owners o
   where o.item_id = v_item;

  -- Exactly 100. Not "at most", which would let a half-recorded ownership pass
  -- and quietly understate every per-member figure derived from it.
  if v_total <> 100 then
    -- "per cent" spelled out rather than a literal %. RAISE reads % as a
    -- placeholder and %% as a literal, and three in a row parse as the pair
    -- first — so '100%%, not %%%' prints "not %90", which is worse than plain.
    raise exception 'Ownership shares must total 100 per cent, not %', v_total;
  end if;

  return null;
end
$function$;

/**
 * A security link points from a liability to an asset.
 *
 * **NOT deferred, unlike the two above, and the difference is the point.** They
 * have to be: owners do not exist when the parent row is inserted, so their
 * check can only run at COMMIT. This one has everything it needs immediately —
 * the foreign key guarantees the target row already exists, and `side` is
 * generated on the row being written.
 *
 * Deferring it would be worse than unnecessary. A deferred trigger raises at
 * COMMIT, which is outside any `begin … exception` around the statement that
 * caused it, so the error arrives detached from the call that earned it and
 * cannot be caught where it makes sense. Found exactly that way on the branch:
 * the first version was deferred and its refusal escaped the probe's own
 * handler.
 */
create or replace function public.enforce_security_link()
returns trigger
language plpgsql
set search_path to ''
as $function$
declare
  v_target_side public.balance_side;
begin
  if new.secured_against_id is null then
    return null;
  end if;

  if new.side <> 'liability' then
    raise exception 'Only a liability can be secured against something';
  end if;

  select side into v_target_side
    from public.assets_liabilities where id = new.secured_against_id;

  if v_target_side <> 'asset' then
    raise exception 'A liability can only be secured against an asset';
  end if;

  return null;
end
$function$;

create constraint trigger trg_assets_liabilities_owner_required
  after insert on public.assets_liabilities
  deferrable initially deferred
  for each row execute function public.enforce_item_has_owner();

create constraint trigger trg_asset_liability_owners_total
  after insert or update or delete on public.asset_liability_owners
  deferrable initially deferred
  for each row execute function public.enforce_item_shares_total();

create trigger trg_assets_liabilities_security
  after insert or update on public.assets_liabilities
  for each row execute function public.enforce_security_link();

-- Trigger-only, so granted to nobody at all.
revoke all on function public.enforce_item_has_owner() from public, anon, authenticated;
revoke all on function public.enforce_item_shares_total() from public, anon, authenticated;
revoke all on function public.enforce_security_link() from public, anon, authenticated;

create trigger trg_assets_liabilities_updated_at
  before update on public.assets_liabilities
  for each row execute function public.set_updated_at();

-- Ownership and value changes are exactly what a regulator asks about, so both
-- tables are in the audit trail. The owners table has a composite key; the
-- item id is the meaningful record reference.
create trigger trg_assets_liabilities_audit
  after insert or update or delete on public.assets_liabilities
  for each row execute function public.record_audit('id', '');
create trigger trg_asset_liability_owners_audit
  after insert or update or delete on public.asset_liability_owners
  for each row execute function public.record_audit('item_id', '');

-- ─────────────────────────────────────────────────────────────────────────────
-- Access
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.staff_can_access_item(p_item_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path to ''
as $function$
declare
  v_staff   uuid;
  v_creator uuid;
begin
  if public.is_elevated_context() then return true; end if;
  v_staff := public.current_staff_id();
  if v_staff is null then return false; end if;

  select created_by_staff_id into v_creator
  from public.assets_liabilities where id = p_item_id;
  if not found then return false; end if;
  if v_creator = v_staff then return true; end if;

  return exists (
    select 1 from public.asset_liability_owners o
    where o.item_id = p_item_id and public.staff_can_access_party(o.party_id)
  );
end
$function$;

revoke all on function public.staff_can_access_item(uuid) from public, anon;
grant execute on function public.staff_can_access_item(uuid) to authenticated;

alter table public.assets_liabilities enable row level security;
alter table public.asset_liability_owners enable row level security;

-- Deliberately NOT staff_can_access_item() here: that helper re-reads
-- assets_liabilities, which cannot see the row the current statement is
-- inserting. The conditions are inlined so the creator clause is row-local and
-- INSERT ... RETURNING works -- the same shape accounts_select uses.
create policy items_select on public.assets_liabilities
  for select to authenticated
  using (
    created_by_staff_id = public.current_staff_id()
    or exists (
      select 1 from public.asset_liability_owners o
      where o.item_id = id and public.staff_can_access_party(o.party_id)
    )
  );

create policy items_insert on public.assets_liabilities
  for insert to authenticated
  with check (public.is_active_staff() and created_by_staff_id = public.current_staff_id());

create policy items_update on public.assets_liabilities
  for update to authenticated using (public.staff_can_access_item(id));

create policy items_delete on public.assets_liabilities
  for delete to authenticated using (public.staff_can_access_item(id));

-- The `with check` additionally requires party access, so a caller cannot
-- attach an owner they are not allowed to see.
create policy item_owners_all on public.asset_liability_owners
  for all to authenticated
  using (public.staff_can_access_item(item_id))
  with check (
    public.staff_can_access_item(item_id) and public.staff_can_access_party(party_id)
  );

-- Supabase's default privileges hand every new table in public to anon,
-- authenticated and service_role with ALL privileges. Revoked rather than
-- assumed: this is the seventh object to arrive that way.
revoke all on public.assets_liabilities from anon, public, authenticated;
revoke all on public.asset_liability_owners from anon, public, authenticated;
grant select, insert, update, delete on public.assets_liabilities to authenticated;
grant select, insert, update, delete on public.asset_liability_owners to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- Reading
-- ─────────────────────────────────────────────────────────────────────────────

/**
 * One row per item, with its owners, its institution and whatever it secures
 * against named.
 *
 * Correlated LATERAL lookups, never a `distinct on` view joined from a filtered
 * query. That is the 10 September lesson and it cost 2,080ms to learn: a
 * DISTINCT ON is a wall the planner will not push a filter through, so it
 * computes the answer for every row in the table and only then joins. Here the
 * lookups are per item and hit the primary key.
 */
create view public.assets_liabilities_summary
with (security_invoker = true) as
select
  a.id as item_id,
  a.item_type,
  a.side,
  a.label,
  a.value,
  a.valued_on,
  a.status,
  a.closed_on,
  a.notes,
  inst.display_name as institution,
  a.secured_against_id,
  sec.label as secured_against,
  (select string_agg(p.display_name, ', ' order by p.display_name)
     from public.asset_liability_owners o
     join public.parties p on p.id = o.party_id
    where o.item_id = a.id) as owners,
  (select count(*)
     from public.asset_liability_owners o
    where o.item_id = a.id) as owner_count,
  -- The shares as a document, so one read carries who owns what. A per-member
  -- figure needs the pairs; a string_agg of names cannot supply them.
  (select jsonb_agg(jsonb_build_object(
            'party_id', o.party_id,
            'name', p.display_name,
            'share_percent', o.share_percent)
          order by p.display_name)
     from public.asset_liability_owners o
     join public.parties p on p.id = o.party_id
    where o.item_id = a.id) as owner_shares
from public.assets_liabilities a
left join public.parties inst on inst.id = a.institution_party_id
left join lateral (
  select s.label from public.assets_liabilities s where s.id = a.secured_against_id
) sec on true;

comment on view public.assets_liabilities_summary is
  'One row per asset or liability with its owners, their shares, its institution and what it is secured against. security_invoker, so a caller sees exactly the items they could already open.';

/**
 * The same, keyed by group.
 *
 * An item belongs to the group(s) its owners belong to -- there is no group_id
 * column, by the same design as accounts and policies. DISTINCT on the PAIR
 * rather than the whole row, so the planner can still push a `group_id` filter
 * into the subquery: a filter on a DISTINCT column is one it may move below the
 * DISTINCT.
 */
create view public.group_assets_liabilities
with (security_invoker = true) as
select
  g.group_id,
  s.item_id, s.item_type, s.side, s.label, s.value, s.valued_on,
  s.status, s.closed_on, s.notes, s.institution,
  s.secured_against_id, s.secured_against,
  s.owners, s.owner_count, s.owner_shares
from (
  select distinct m.group_id, o.item_id
  from public.client_group_members m
  join public.asset_liability_owners o on o.party_id = m.party_id
  where m.end_date is null
) g
join public.assets_liabilities_summary s on s.item_id = g.item_id;

comment on view public.group_assets_liabilities is
  'assets_liabilities_summary with a group_id: every item owned by a CURRENT member of the group, once. Membership is derived, never stored -- the same rule group_financial_accounts follows.';

-- Read by signed-in staff only, and READ is the whole grant. Checked on the
-- branch rather than assumed: as created, a view carries INSERT, UPDATE, DELETE
-- and TRUNCATE for `authenticated`, so the revoke names it too. A grant should
-- say what is meant, not lean on what happens not to work.
revoke all on public.assets_liabilities_summary from anon, public, authenticated;
revoke all on public.group_assets_liabilities from anon, public, authenticated;
grant select on public.assets_liabilities_summary to authenticated;
grant select on public.group_assets_liabilities to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- Writing
-- ─────────────────────────────────────────────────────────────────────────────

/**
 * Create an item and its owners in one transaction.
 *
 * Owners arrive as jsonb rather than two parallel arrays -- a party and its
 * share belong together, and two arrays can differ in length, which is a bug
 * with no natural home. The same argument create_insurance_policy makes for
 * covers.
 *
 * SECURITY INVOKER (the default): row-level security must still evaluate as the
 * caller. The guards below add refusals; they add no reach.
 */
create or replace function public.create_asset_liability(
  p_item_type public.asset_liability_type,
  p_label text,
  p_value numeric,
  p_owners jsonb,
  p_valued_on date default null,
  p_institution_party_id uuid default null,
  p_secured_against_id uuid default null,
  p_notes text default null
)
returns uuid
language plpgsql
set search_path to ''
as $function$
declare
  v_item  uuid;
  v_staff uuid := public.current_staff_id();
  v_owner jsonb;
  v_total numeric(6,2);
begin
  if v_staff is null then
    raise exception 'Not an active staff member';
  end if;
  if p_label is null or length(trim(p_label)) = 0 then
    raise exception 'An asset or liability needs a name';
  end if;
  if p_value is null or p_value < 0 then
    raise exception 'A value is required, and cannot be negative';
  end if;
  if p_owners is null or jsonb_array_length(p_owners) = 0 then
    raise exception 'An asset or liability must have at least one owner';
  end if;

  -- Checked here as well as by the deferred trigger, so the message names the
  -- problem in the adviser's terms rather than surfacing at COMMIT.
  select sum((o->>'share_percent')::numeric)
    into v_total
    from jsonb_array_elements(p_owners) o;
  if v_total is distinct from 100 then
    raise exception 'Ownership shares must total 100 per cent, not %', coalesce(v_total, 0);
  end if;

  insert into public.assets_liabilities
    (item_type, label, value, valued_on, institution_party_id,
     secured_against_id, notes, created_by_staff_id)
  values
    (p_item_type, trim(p_label), p_value, coalesce(p_valued_on, current_date),
     p_institution_party_id, p_secured_against_id, nullif(trim(coalesce(p_notes, '')), ''),
     v_staff)
  returning id into v_item;

  for v_owner in select * from jsonb_array_elements(p_owners) loop
    insert into public.asset_liability_owners (item_id, party_id, share_percent)
    values (v_item,
            (v_owner->>'party_id')::uuid,
            (v_owner->>'share_percent')::numeric);
  end loop;

  return v_item;
end
$function$;

comment on function public.create_asset_liability(public.asset_liability_type, text, numeric, jsonb, date, uuid, uuid, text) is
  'Creates an asset or liability with its owners in one transaction. Shares must total 100. Added 14 Sep 2026 for the group page''s Assets + Liabilities tab.';

-- PostgreSQL grants EXECUTE on every new function to PUBLIC as built-in
-- behaviour and every role inherits from PUBLIC, so this revoke is load-bearing
-- rather than boilerplate; revoking from anon alone would not be enough.
revoke all on function public.create_asset_liability(public.asset_liability_type, text, numeric, jsonb, date, uuid, uuid, text) from public, anon;
grant execute on function public.create_asset_liability(public.asset_liability_type, text, numeric, jsonb, date, uuid, uuid, text) to authenticated;
