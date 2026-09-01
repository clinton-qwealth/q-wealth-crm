-- create_financial_account gains a status parameter (1 Sep 2026)
--
-- Adding a parameter changes the signature, so this creates a new function rather
-- than replacing the old one. The old signature is dropped explicitly, otherwise
-- both would exist and a call with eight arguments could silently reach the stale
-- one.

drop function if exists public.create_financial_account(
  public.financial_account_type, text, uuid[], uuid, text, date, numeric, date
);

create or replace function public.create_financial_account(
  p_account_type      public.financial_account_type,
  p_label             text,
  p_owner_party_ids   uuid[],
  p_provider_party_id uuid    default null,
  p_account_number    text    default null,
  p_opened_on         date    default null,
  p_opening_value     numeric default null,
  p_valued_on         date    default null,
  p_status            public.financial_account_status default 'active'
) returns uuid
language plpgsql
security invoker
set search_path to ''
as $fn$
declare
  v_account uuid;
  v_staff   uuid := public.current_staff_id();
  v_party   uuid;
begin
  if v_staff is null then
    raise exception 'Not an active staff member';
  end if;
  if p_owner_party_ids is null or cardinality(p_owner_party_ids) = 0 then
    raise exception 'An account must have at least one owner';
  end if;
  if p_label is null or length(trim(p_label)) = 0 then
    raise exception 'An account needs a label';
  end if;

  insert into public.financial_accounts
    (account_type, label, provider_party_id, account_number, opened_on, status, created_by_staff_id)
  values
    (p_account_type, trim(p_label), p_provider_party_id, p_account_number, p_opened_on,
     coalesce(p_status, 'active'), v_staff)
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

revoke all on function public.create_financial_account(
  public.financial_account_type, text, uuid[], uuid, text, date, numeric, date,
  public.financial_account_status
) from public, anon;

grant execute on function public.create_financial_account(
  public.financial_account_type, text, uuid[], uuid, text, date, numeric, date,
  public.financial_account_status
) to authenticated;
