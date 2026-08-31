-- Repair NULL columns on SQL-inserted auth users (31 Aug 2026)
--
-- test-management@ and test-services@ were inserted into auth.users directly by
-- SQL rather than created through the Auth API, so they never received GoTrue's
-- empty-string defaults. GoTrue scans these columns into non-pointer Go strings,
-- so NULL raises:
--
--   error finding user: sql: Scan error on column index 3, name
--   "confirmation_token": converting NULL to string is unsupported
--
-- Observed effect: /recover returned 500 five times. Password reset was broken
-- for those two accounts, and any other flow reading these columns would fail
-- the same way.
--
-- Scope is deliberately narrow. Nine other columns (banned_until, invited_at,
-- phone, deleted_at, the *_sent_at family) are NULL on the correctly-created
-- users too, so they are genuinely nullable and are left alone. last_sign_in_at
-- is also NULL on these rows, correctly, because neither account has ever signed
-- in - patching it would invent a login that did not happen.
--
-- created_at/updated_at are reconstructed from email_confirmed_at, which is the
-- closest real signal available. The original creation times were never recorded.

update auth.users
set confirmation_token     = coalesce(confirmation_token, ''),
    recovery_token         = coalesce(recovery_token, ''),
    email_change           = coalesce(email_change, ''),
    email_change_token_new = coalesce(email_change_token_new, ''),
    created_at             = coalesce(created_at, email_confirmed_at, now()),
    updated_at             = coalesce(updated_at, email_confirmed_at, now())
where confirmation_token is null
   or recovery_token is null
   or email_change is null
   or email_change_token_new is null
   or created_at is null
   or updated_at is null;
