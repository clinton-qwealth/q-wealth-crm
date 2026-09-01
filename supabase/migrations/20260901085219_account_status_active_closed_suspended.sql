-- Account status: active | closed | suspended (1 Sep 2026)
--
-- The enum already existed as open|closed. `open` is renamed rather than replaced
-- so the two existing rows carry over untouched — no data migration, no window
-- where a row holds a value the type no longer knows about.
--
-- `suspended` covers an account that still exists but is not currently operating:
-- a frozen wrap, a fund in transition, a pending transfer. Distinct from closed,
-- which is terminal.

alter type public.financial_account_status rename value 'open' to 'active';
alter type public.financial_account_status add value if not exists 'suspended';

-- The column default was written as 'open'::financial_account_status. Renaming the
-- label leaves the stored default expression pointing at the same enum value, but
-- it is re-set explicitly so the schema reads as intended rather than relying on
-- that.
alter table public.financial_accounts
  alter column status set default 'active'::public.financial_account_status;

-- Unchanged in effect, restated for clarity: only a closed account may carry a
-- closing date. A suspended account has not ended, so it must not have one.
alter table public.financial_accounts
  drop constraint if exists financial_accounts_closed_date;

alter table public.financial_accounts
  add constraint financial_accounts_closed_date
  check (status = 'closed' or closed_on is null);

comment on column public.financial_accounts.status is
  'active = operating. suspended = exists but not currently operating (frozen, mid-transfer). closed = terminal, and the only status permitted a closed_on date.';
