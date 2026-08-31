-- General audit trail (checklist item 1, built 26 Aug 2026)
--
-- Sensitive-field access was already logged in sensitive_access_log, but ordinary
-- edits (who changed an address, who granted access to a client group) left no
-- who-did-what history. This adds a queryable, append-only record across the
-- client, grouping, permission and note-filing tables.
--
-- Deliberately trigger-based rather than pgAudit: pgAudit writes to the Postgres
-- log stream, which is not queryable and not retained for the seven years AFSL
-- record-keeping expects.

create type public.audit_action as enum ('insert', 'update', 'delete');

-- 'elevated' means the write came from a dashboard/service-role/direct connection
-- with no end-user JWT, so no staff member can be named. Recording the context
-- explicitly stops a null actor from looking like data loss.
create type public.audit_context as enum ('api', 'elevated');

create table public.audit_log (
  id                 bigint generated always as identity primary key,
  occurred_at        timestamptz not null default now(),
  table_name         text        not null,
  record_id          uuid,
  action             public.audit_action not null,
  changed_fields     text[],
  old_data           jsonb,
  new_data           jsonb,
  actor_staff_id     uuid references public.staff_users(id),
  actor_auth_user_id uuid,
  actor_context      public.audit_context not null,
  db_user            text not null default current_user
);

comment on table public.audit_log is
  'Append-only who-changed-what history for client, grouping, permission and note-filing tables. Written only by the record_audit() trigger. Note bodies and transcripts are excluded - they are already immutable in notes.';
comment on column public.audit_log.actor_context is
  'api = a real staff JWT, actor_staff_id is populated. elevated = dashboard/service-role/direct connection, no end user to name.';
comment on column public.audit_log.changed_fields is
  'UPDATE only: the columns that actually changed. old_data/new_data are narrowed to these.';

create index audit_log_record_idx on public.audit_log (table_name, record_id, occurred_at desc);
create index audit_log_occurred_idx on public.audit_log (occurred_at desc);
create index audit_log_actor_idx on public.audit_log (actor_staff_id, occurred_at desc);

-- ---------------------------------------------------------------------------
-- Trigger function
-- ---------------------------------------------------------------------------
create or replace function public.record_audit()
returns trigger
language plpgsql
security definer
set search_path to ''
as $fn$
declare
  v_pk_col    text := coalesce(tg_argv[0], 'id');
  v_exclude   text[];
  v_old       jsonb;
  v_new       jsonb;
  v_changed   text[];
  v_old_slim  jsonb;
  v_new_slim  jsonb;
  v_record_id uuid;
  v_uid       uuid;
begin
  -- Housekeeping and generated columns never constitute a business change.
  v_exclude := array_remove(string_to_array(coalesce(tg_argv[1], ''), ','), '')
               || array['updated_at', 'search_tsv'];

  if tg_op <> 'DELETE' then
    v_new := to_jsonb(new) - v_exclude;
  end if;
  if tg_op <> 'INSERT' then
    v_old := to_jsonb(old) - v_exclude;
  end if;

  v_record_id := (coalesce(v_new, v_old) ->> v_pk_col)::uuid;

  if tg_op = 'UPDATE' then
    select array_agg(n.key order by n.key)
      into v_changed
    from jsonb_each(v_new) n
    where n.value is distinct from (v_old -> n.key);

    -- An updated_at-only touch is not an auditable event.
    if v_changed is null then
      return null;
    end if;

    select jsonb_object_agg(k, v_old -> k) into v_old_slim from unnest(v_changed) k;
    select jsonb_object_agg(k, v_new -> k) into v_new_slim from unnest(v_changed) k;
  else
    v_old_slim := v_old;
    v_new_slim := v_new;
  end if;

  v_uid := (select auth.uid());

  insert into public.audit_log (
    table_name, record_id, action, changed_fields,
    old_data, new_data, actor_staff_id, actor_auth_user_id, actor_context
  ) values (
    tg_table_name,
    v_record_id,
    lower(tg_op)::public.audit_action,
    v_changed,
    v_old_slim,
    v_new_slim,
    public.current_staff_id(),
    v_uid,
    case when public.is_elevated_context()
         then 'elevated'::public.audit_context
         else 'api'::public.audit_context end
  );

  return null;  -- AFTER trigger; return value is ignored
end
$fn$;

-- ---------------------------------------------------------------------------
-- Immutability: no updates, no deletes, by anyone, regardless of policy.
-- Retention pruning will need this trigger dropped deliberately in a migration.
-- ---------------------------------------------------------------------------
create or replace function public.enforce_audit_append_only()
returns trigger
language plpgsql
as $fn$
begin
  raise exception 'audit_log is append-only: % is not permitted', tg_op;
end
$fn$;

create trigger trg_audit_log_append_only
  before update or delete on public.audit_log
  for each row execute function public.enforce_audit_append_only();

-- ---------------------------------------------------------------------------
-- Access: compliance artifact, admin read only. Entries contain client PII.
-- No insert/update/delete policies exist, so the only writer is the
-- security-definer trigger above.
-- ---------------------------------------------------------------------------
alter table public.audit_log enable row level security;

create policy admin_read_audit_log on public.audit_log
  for select to authenticated
  using (public.current_staff_has('admin'));

revoke all on public.audit_log from anon;
grant select on public.audit_log to authenticated;

-- ---------------------------------------------------------------------------
-- Attach to the audited tables.
-- Excluded by design: party_sensitive_data (own audit log; encrypted values must
-- never be copied) and sensitive_access_log (already append-only).
-- ---------------------------------------------------------------------------
do $do$
declare
  t record;
begin
  for t in
    select * from (values
      ('parties',              'id',       ''),
      ('persons',              'party_id', ''),
      ('organisations',        'party_id', ''),
      ('party_roles',          'id',       ''),
      ('party_relationships',  'id',       ''),
      ('contact_points',       'id',       ''),
      ('client_groups',        'id',       ''),
      ('client_group_members', 'id',       ''),
      ('staff_users',          'id',       ''),
      ('access_profiles',      'id',       ''),
      ('teams',                'id',       ''),
      ('team_members',         'id',       ''),
      ('client_group_access',  'id',       ''),
      ('notes',                'id',       'body,transcript'),
      ('note_subjects',        'id',       ''),
      ('note_attachments',     'id',       '')
    ) as x(tbl, pk, excl)
  loop
    execute format('drop trigger if exists trg_%s_audit on public.%I', t.tbl, t.tbl);
    execute format(
      'create trigger trg_%s_audit after insert or update or delete on public.%I
         for each row execute function public.record_audit(%L, %L)',
      t.tbl, t.tbl, t.pk, t.excl);
  end loop;
end
$do$;
