-- Require MFA for sensitive-field access (31 Aug 2026)
--
-- Readiness checklist item 3. TOTP and leaked-password protection are enabled in
-- Supabase Auth, but enabling TOTP only makes enrolment possible: Supabase has no
-- global "require MFA" switch. Enforcement means checking the authenticator
-- assurance level, and the question is where.
--
-- It goes in the database, not the application. There are two clients of this
-- database (the web app and the MCP server), so MFA enforced in the web app alone
-- would leave the Claude path unprotected.
--
-- SCOPE IS DELIBERATELY NARROW FOR NOW. Only sensitive-field read and write
-- require aal2:
--   * Highest value: the TFN/passport/Medicare paths.
--   * Nothing breaks. No reveal UI exists yet and the MCP exposes no reveal tool,
--     so the only current caller is the dashboard, which bypasses as elevated.
--   * No connector risk. It is not yet known what `aal` an OAuth-issued token
--     carries after consent; requiring aal2 across all policies could silently
--     break the MCP connector. Measure before widening.

create or replace function public.current_aal()
returns text language sql stable set search_path to ''
as $fn$
  select coalesce(
    nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'aal',
    'none'
  );
$fn$;

comment on function public.current_aal is
  'Authenticator assurance level of the calling session, from the JWT aal claim. aal2 means a second factor was verified.';

create or replace function public.has_mfa()
returns boolean language plpgsql stable security definer set search_path to ''
as $fn$
begin
  if public.is_elevated_context() then
    return true;
  end if;
  return public.current_aal() = 'aal2';
end;
$fn$;

comment on function public.has_mfa is
  'True when the caller verified a second factor, or is an elevated context.';

-- reveal_sensitive_field and set_sensitive_field each gain:
--   if not public.has_mfa() then raise exception '...' end if;
-- Full bodies are in the applied migration; see Supabase migration history.

revoke all on function public.current_aal() from public, anon;
revoke all on function public.has_mfa() from public, anon;
grant execute on function public.current_aal() to authenticated;
grant execute on function public.has_mfa() to authenticated;
