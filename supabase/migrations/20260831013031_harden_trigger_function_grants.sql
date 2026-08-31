-- Harden trigger-function exposure (31 Aug 2026)
--
-- Two advisor findings introduced by create_general_audit_trail and not caught
-- because advisors were not re-run after that migration:
--
--   1. enforce_audit_append_only had no fixed search_path, unlike every other
--      function in the schema.
--   2. record_audit() was EXECUTE-able by anon via /rest/v1/rpc/record_audit.
--      Postgres refuses to invoke a trigger function outside trigger context, so
--      the practical risk was low, but it should not be exposed on the API at all.
--
-- Trigger functions are only ever invoked by the trigger machinery, which runs as
-- the table owner and does not consult these grants. Revoking EXECUTE from the
-- API roles removes the RPC surface without affecting any trigger.

create or replace function public.enforce_audit_append_only()
returns trigger
language plpgsql
set search_path to ''
as $fn$
begin
  raise exception 'audit_log is append-only: % is not permitted', tg_op;
end
$fn$;

do $do$
declare
  f record;
begin
  for f in
    select p.oid::regprocedure as sig
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    join pg_type t on t.oid = p.prorettype
    where n.nspname = 'public'
      and t.typname = 'trigger'
  loop
    execute format('revoke all on function %s from anon, authenticated', f.sig);
  end loop;
end
$do$;
