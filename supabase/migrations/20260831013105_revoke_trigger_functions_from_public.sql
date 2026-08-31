-- Follow-up to harden_trigger_function_grants (31 Aug 2026)
--
-- Revoking from anon and authenticated was not enough: Postgres grants EXECUTE
-- to PUBLIC by default on every function, and both API roles inherit it. The
-- grant has to be removed from PUBLIC as well.
--
-- Safe for triggers: privileges on a trigger function are checked when the
-- trigger is created, not each time it fires, and the trigger machinery runs as
-- the table owner. Revoking EXECUTE removes the /rest/v1/rpc surface only.

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
    execute format('revoke all on function %s from public, anon, authenticated', f.sig);
  end loop;
end
$do$;
