-- Bytes a post can carry: images and files.
--
-- The feed's whole design is that a post body is a DOCUMENT whose node types
-- are a closed list, so nothing that reaches the screen is ever interpreted as
-- markup. An image breaks that the moment its node carries a `src`: a URL
-- attribute lets any client point a post at an arbitrary host — a tracking
-- pixel, a data: payload, a channel for who-read-what. So the node carries an
-- opaque ID and nothing else, and this table is what the ID means. Exactly the
-- mention precedent: the document keeps what was written, the row says what it
-- is today.
--
-- THIS IS THE FIRST STAFF-WRITABLE BUCKET IN THE SCHEMA. note-media has no
-- staff insert policy at all — "uploads come from the webhook via service
-- role" — so there is no precedent to copy and the policies below are written
-- from the position that RLS is the only enforcement point. Everything the
-- app checks before uploading, this file checks again: the mime list, the size
-- cap, who may write where.
--
-- ORDER MATTERS: the ROW IS CREATED FIRST, then the bytes are uploaded to the
-- path the row names. That ordering is the only reason the storage policy can
-- be enforced at all — without a row to point at, an INSERT into
-- storage.objects has nothing to check the uploader against, and the bucket
-- becomes a place any staff member can write any path.
--
-- Posts stay append-only. A mis-pasted screenshot is dealt with by REDACTION,
-- not deletion: redacted_at is set, the bytes are removed, the post is
-- untouched and the screen says the image was removed and by whom. A redaction
-- is a STATE, which is the same reasoning that gave the reactions table the
-- only DELETE grant under this feed.

-- ---- the closed lists, written once ---------------------------------------

-- These three facts are needed by the bucket, by the RLS policy and by the
-- write path. A function each, so there is one copy to change and no chance of
-- the bucket allowing what the policy refuses.
create or replace function public.post_media_size_limit() returns bigint
language sql immutable set search_path = '' as $$ select 10485760::bigint $$;
comment on function public.post_media_size_limit() is
  'The largest file a post may carry, in bytes (10 MB). Used by the post-media bucket, the RLS policy and create_post_media() so the three cannot disagree.';

create or replace function public.post_media_mime_types() returns text[]
language sql immutable set search_path = '' as $$
  select array[
    'image/png', 'image/jpeg', 'image/webp', 'image/gif',
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'text/csv', 'text/plain'
  ]::text[]
$$;
comment on function public.post_media_mime_types() is
  'What a post may carry. SVG and HTML are absent ON PURPOSE: both can carry script, and rendering either would undo the rule the whole document model exists to enforce. Used by the post-media bucket, the RLS policy and create_post_media().';

create or replace function public.post_media_kind(p_mime text) returns text
language sql immutable strict set search_path = '' as $$
  select case when p_mime like 'image/%' then 'image' else 'file' end
$$;
comment on function public.post_media_kind(text) is
  'Whether a mime type is drawn in the post (image) or offered as a chip to download (file). Derived, never taken from the client.';

revoke all on function public.post_media_size_limit() from public, anon;
revoke all on function public.post_media_mime_types() from public, anon;
revoke all on function public.post_media_kind(text) from public, anon;
grant execute on function public.post_media_size_limit() to authenticated;
grant execute on function public.post_media_mime_types() to authenticated;
grant execute on function public.post_media_kind(text) to authenticated;

-- ---- the bucket -----------------------------------------------------------

-- Private. The cap and the type list are the bucket's own, so Storage refuses
-- an oversized or wrong-typed body before a single policy is consulted — the
-- client's checks are a courtesy, these are the rule.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('post-media', 'post-media', false,
        public.post_media_size_limit(), public.post_media_mime_types())
on conflict (id) do update
  set public             = false,
      file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- ---- the rows -------------------------------------------------------------

create table public.workflow_post_media (
  id            uuid primary key default gen_random_uuid(),
  workflow_id   uuid not null references public.workflows(id) on delete cascade,
  -- Null until the post exists. An upload necessarily happens BEFORE the post
  -- it goes in, and a post is append-only, so a row is created unclaimed and
  -- claimed by post_workflow_activity() in the same statement that stores the
  -- document naming it.
  post_id       uuid references public.workflow_posts(id) on delete cascade,
  uploaded_by   uuid not null references public.staff_users(id),
  kind          text not null,
  mime_type     text not null,
  byte_size     bigint not null,
  original_name text not null,
  -- Images only, and measured by the browser: enough to reserve the space so
  -- the feed does not jump as pictures load. Not trustworthy for anything else.
  width         int,
  height        int,
  redacted_at   timestamptz,
  redacted_by   uuid references public.staff_users(id),
  created_at    timestamptz not null default now(),
  -- The path is DERIVED, never chosen by the caller. Without this a client
  -- could name a path inside another workflow's prefix and the storage policy
  -- would happily match its own row against it.
  storage_path  text not null unique,
  constraint workflow_post_media_path_is_derived
    check (storage_path = workflow_id::text || '/' || id::text),
  constraint workflow_post_media_kind_allowed
    check (kind in ('image', 'file')),
  constraint workflow_post_media_kind_matches_mime
    check (kind = public.post_media_kind(mime_type)),
  constraint workflow_post_media_mime_allowed
    check (mime_type = any (public.post_media_mime_types())),
  constraint workflow_post_media_size_allowed
    check (byte_size > 0 and byte_size <= public.post_media_size_limit()),
  constraint workflow_post_media_name_not_blank
    check (btrim(original_name) <> ''),
  -- A picture has dimensions or it has neither; a file has neither.
  constraint workflow_post_media_dimensions_together
    check ((width is null) = (height is null)
           and (kind = 'image' or width is null)
           and (width is null or (width between 1 and 20000 and height between 1 and 20000))),
  -- Redaction is one fact recorded two ways, so it cannot be half-recorded.
  constraint workflow_post_media_redaction_complete
    check ((redacted_at is null) = (redacted_by is null))
);

comment on table public.workflow_post_media is
  'The bytes a post carries. A post''s document names one of these by ID ONLY — never a URL — and the app serves it through a route that re-checks access and hands out a short-lived signed URL. post_id is null while the upload is unclaimed; post_workflow_activity() claims it. Append-only apart from those two transitions, which enforce_post_media_transitions() polices.';
comment on column public.workflow_post_media.storage_path is
  'workflow_id/id, enforced by a check constraint. Derived rather than client-chosen so no caller can write outside its own workflow''s prefix; the storage.objects policies match objects.name against this column.';
comment on column public.workflow_post_media.post_id is
  'Null while the upload has not been posted yet. Set once, by post_workflow_activity(), to a post the uploader authored on the same workflow. An unclaimed row is an abandoned upload and is what a sweep would collect.';
comment on column public.workflow_post_media.redacted_at is
  'When set, the bytes are gone and the feed draws "removed by <name>" in place of the image. The post itself is never altered — a post is append-only, and a redaction is a state, not an edit.';

create index workflow_post_media_post_idx
  on public.workflow_post_media (post_id) where post_id is not null;
create index workflow_post_media_unclaimed_idx
  on public.workflow_post_media (created_at) where post_id is null;
create index workflow_post_media_workflow_idx
  on public.workflow_post_media (workflow_id);

-- ---- what may change ------------------------------------------------------

-- The RLS policy below says WHO may update a row; this says WHAT may change,
-- and the split is deliberate. Postgres OR-s permissive policies together, so
-- two policies — one for claiming, one for redacting — would let a caller
-- satisfy one policy's USING and the other's WITH CHECK and change a third
-- column entirely. A trigger is the only place a TRANSITION can be pinned.
-- Same shape as enforce_note_append_only(), which restricts notes to filing.
create or replace function public.enforce_post_media_transitions()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_me uuid := public.current_staff_id();
begin
  -- A direct database connection or the service role is doing maintenance, not
  -- being a staff member; the same stance is_elevated_context() takes elsewhere.
  if public.is_elevated_context() then
    return new;
  end if;

  -- A REDACTED ROW IS FINISHED. Checked first, and as a state rather than as a
  -- transition, because now() is the TRANSACTION's clock: a second redaction
  -- inside one transaction writes an identical timestamp, so "did redacted_at
  -- change" reads false and every transition test below is skipped. Found by
  -- running the redaction twice in one statement — it succeeded silently.
  if old.redacted_at is not null then
    raise exception 'That upload has already been removed';
  end if;

  -- Everything that identifies the bytes is fixed for the life of the row.
  if new.id <> old.id
     or new.workflow_id   <> old.workflow_id
     or new.uploaded_by   <> old.uploaded_by
     or new.kind          <> old.kind
     or new.mime_type     <> old.mime_type
     or new.byte_size     <> old.byte_size
     or new.original_name <> old.original_name
     or new.storage_path  <> old.storage_path
     or new.created_at    <> old.created_at
     or coalesce(new.width, -1)  <> coalesce(old.width, -1)
     or coalesce(new.height, -1) <> coalesce(old.height, -1) then
    raise exception 'An upload''s details cannot be changed once it exists';
  end if;

  -- Transition 1: claiming. Null to a post you wrote on the same workflow,
  -- once and never again.
  if new.post_id is distinct from old.post_id then
    if old.post_id is not null then
      raise exception 'That upload has already been posted';
    end if;
    if new.post_id is null then
      raise exception 'An upload cannot be taken back off a post';
    end if;
    if not exists (
      select 1 from public.workflow_posts p
       where p.id = new.post_id
         and p.workflow_id = new.workflow_id
         and p.author_staff_id = v_me) then
      raise exception 'An upload can only be posted onto your own post on the same workflow';
    end if;
    if new.uploaded_by <> v_me then
      raise exception 'Only the person who uploaded a file may post it';
    end if;
  end if;

  -- Transition 2: redacting. Null to now, by the uploader or an admin.
  --
  -- There is no "a removal cannot be undone" case here, and there does not
  -- need to be: reaching this line means old.redacted_at is null, so the only
  -- way to differ is for the new value to be set. Un-redacting is refused by
  -- the state check at the top, which is where the one that matters lives.
  if new.redacted_at is distinct from old.redacted_at then
    if new.redacted_by is distinct from v_me then
      raise exception 'A removal records who did it, and it must be you';
    end if;
    if old.uploaded_by <> v_me and not public.current_staff_has('admin') then
      raise exception 'Only the person who added a file, or an administrator, may remove it';
    end if;
  end if;

  return new;
end $fn$;
comment on function public.enforce_post_media_transitions() is
  'The only two changes a workflow_post_media row may undergo: claiming (post_id null to a post the uploader authored on the same workflow) and redaction (redacted_at null to now, by the uploader or an admin). Everything else raises. The RLS policy says who; this says what — a trigger, because Postgres OR-s permissive policies and two UPDATE policies could be played against each other.';

create trigger trg_workflow_post_media_transitions
  before update on public.workflow_post_media
  for each row execute function public.enforce_post_media_transitions();

-- Never boilerplate: Postgres grants EXECUTE on a new function to PUBLIC, and
-- every role inherits from PUBLIC. A trigger function is called by the trigger,
-- never by a client. The defect fixed twice on 31 August was exactly this.
revoke all on function public.enforce_post_media_transitions() from public, anon, authenticated;

-- Who did what to the bytes, including every redaction, for free.
create trigger trg_workflow_post_media_audit
  after insert or update or delete on public.workflow_post_media
  for each row execute function public.record_audit('id', '');

-- ---- RLS ------------------------------------------------------------------

alter table public.workflow_post_media enable row level security;

-- Visible when the workflow is, derived through workflows rather than restated,
-- exactly as workflow_posts_select does it.
create policy workflow_post_media_select on public.workflow_post_media
  for select to authenticated
  using (exists (select 1 from public.workflows w where w.id = workflow_post_media.workflow_id));

-- Insert restates every rule create_post_media() checks, because the RPC is
-- SECURITY INVOKER and this is the enforcement point: a client inserting into
-- the table directly must get the same answer as one calling the RPC.
create policy workflow_post_media_insert on public.workflow_post_media
  for insert to authenticated
  with check (
    public.is_active_staff()
    and uploaded_by = public.current_staff_id()
    -- An upload arrives unclaimed and unredacted. Both transitions are the
    -- trigger's business, and neither may be pre-set at birth.
    and post_id is null
    and redacted_at is null
    and exists (select 1 from public.workflows w where w.id = workflow_post_media.workflow_id)
  );

-- One UPDATE policy, saying only who. The trigger says what.
create policy workflow_post_media_update on public.workflow_post_media
  for update to authenticated
  using (
    public.is_active_staff()
    and exists (select 1 from public.workflows w where w.id = workflow_post_media.workflow_id)
    and (uploaded_by = public.current_staff_id() or public.current_staff_has('admin'))
  )
  with check (
    exists (select 1 from public.workflows w where w.id = workflow_post_media.workflow_id)
  );

-- Supabase's default privileges hand a new table to authenticated in full.
-- Narrowed here, in the migration that creates it, to what the policies
-- justify. NO DELETE: an abandoned upload is collected by a sweep running as
-- the service role, and a posted one is redacted, never deleted.
revoke all on public.workflow_post_media from public, anon, authenticated;
grant select, insert, update on public.workflow_post_media to authenticated;

-- ---- the bucket's policies ------------------------------------------------

-- Writing bytes requires a row that already names the path, belongs to the
-- caller, and has not been posted yet. This is the half that the row-first
-- ordering buys: there is something concrete to check the uploader against.
create policy post_media_write on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'post-media'
    and exists (
      select 1 from public.workflow_post_media m
       where m.storage_path = storage.objects.name
         and m.uploaded_by = public.current_staff_id()
         and m.post_id is null
         and m.redacted_at is null
    )
  );

-- Reading is the workflow's visibility. The subquery is itself evaluated under
-- workflow_post_media's RLS — which already limits it to visible workflows —
-- but the condition is written out rather than relied upon implicitly: a
-- reader of this policy should not have to know that to see why it is safe.
create policy post_media_read on storage.objects
  for select to authenticated
  using (
    bucket_id = 'post-media'
    and exists (
      select 1 from public.workflow_post_media m
       where m.storage_path = storage.objects.name
         and m.redacted_at is null
         and exists (select 1 from public.workflows w where w.id = m.workflow_id)
    )
  );

-- The bytes are deleted only as the second half of a redaction: the row is
-- marked first, which is what makes this permissible, and only then do the
-- bytes go.
create policy post_media_delete_redacted on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'post-media'
    and exists (
      select 1 from public.workflow_post_media m
       where m.storage_path = storage.objects.name
         and m.redacted_at is not null
         and (m.uploaded_by = public.current_staff_id() or public.current_staff_has('admin'))
    )
  );

-- No update policy for staff on this bucket: an object is written once. An
-- upload that failed halfway is abandoned, and the next attempt gets a new row
-- and a new path.

-- ---- the write path -------------------------------------------------------

-- Called BEFORE the bytes are uploaded. Returns the id the post's document
-- will name and the path the browser must write to; the app never invents
-- either.
create or replace function public.create_post_media(
  p_workflow_id   uuid,
  p_mime_type     text,
  p_byte_size     bigint,
  p_original_name text,
  p_width         int default null,
  p_height        int default null
-- jsonb rather than the row type: PostgREST's shape for a function returning a
-- composite is not something the client should have to guess at, and the caller
-- needs exactly two of the columns.
) returns jsonb
language plpgsql
security invoker
set search_path = ''
as $fn$
declare
  v_me   uuid := public.current_staff_id();
  v_id   uuid := gen_random_uuid();
  v_kind text;
  v_path text;
begin
  if v_me is null then
    raise exception 'Not an active staff member';
  end if;
  if p_workflow_id is null then
    raise exception 'No workflow given';
  end if;
  -- A sentence rather than a constraint name, and it does not say whether the
  -- workflow is missing or merely out of reach.
  if not exists (select 1 from public.workflows w where w.id = p_workflow_id) then
    raise exception 'No such workflow, or not within your access';
  end if;
  if p_mime_type is null or not (p_mime_type = any (public.post_media_mime_types())) then
    raise exception 'A post cannot carry a "%" — images, PDFs, Word, Excel, CSV and text only', coalesce(p_mime_type, 'file of unknown type');
  end if;
  if p_byte_size is null or p_byte_size <= 0 then
    raise exception 'That file is empty';
  end if;
  if p_byte_size > public.post_media_size_limit() then
    raise exception 'That file is larger than the % MB limit', public.post_media_size_limit() / 1048576;
  end if;
  if p_original_name is null or btrim(p_original_name) = '' then
    raise exception 'A file needs a name';
  end if;

  v_kind := public.post_media_kind(p_mime_type);

  insert into public.workflow_post_media (
    id, workflow_id, uploaded_by, kind, mime_type, byte_size, original_name,
    width, height, storage_path)
  values (
    v_id, p_workflow_id, v_me, v_kind, p_mime_type, p_byte_size,
    btrim(p_original_name),
    case when v_kind = 'image' then p_width  end,
    case when v_kind = 'image' then p_height end,
    p_workflow_id::text || '/' || v_id::text)
  returning storage_path into v_path;

  return jsonb_build_object('id', v_id, 'storage_path', v_path, 'kind', v_kind);
end $fn$;
comment on function public.create_post_media(uuid, text, bigint, text, int, int) is
  'Reserve a place for a file a post will carry, BEFORE the bytes are uploaded. Returns the row, whose id is what the post''s document names and whose storage_path is where the browser must write. The row is unclaimed until post_workflow_activity() attaches it to a post; an upload that is never posted is an abandoned row.';

revoke all on function public.create_post_media(uuid, text, bigint, text, int, int) from public, anon;
grant execute on function public.create_post_media(uuid, text, bigint, text, int, int) to authenticated;

-- Redaction. The row is marked here; the app deletes the bytes immediately
-- afterwards, which the storage policy above permits only once this has run.
create or replace function public.redact_post_media(p_id uuid)
returns text
language plpgsql
security invoker
set search_path = ''
as $fn$
declare
  v_me   uuid := public.current_staff_id();
  v_path text;
begin
  if v_me is null then
    raise exception 'Not an active staff member';
  end if;

  -- `redacted_at is null` in the WHERE, not left to the trigger: an already
  -- redacted row must be told apart from one that is not there, and the
  -- trigger's answer for a repeat within a single transaction is "nothing
  -- changed" rather than an error, because now() would write the same value.
  update public.workflow_post_media
     set redacted_at = now(), redacted_by = v_me
   where id = p_id
     and redacted_at is null
  returning storage_path into v_path;

  if v_path is not null then
    return v_path;
  end if;

  -- Nothing updated. Either it is already gone — worth saying, since the
  -- caller's screen may simply be stale — or it does not exist for this
  -- person, and those two must not be told apart any further than this.
  if exists (select 1 from public.workflow_post_media m
              where m.id = p_id and m.redacted_at is not null) then
    raise exception 'That file has already been removed';
  end if;
  raise exception 'No such file, or not within your access';
end $fn$;
comment on function public.redact_post_media(uuid) is
  'Remove a file from a post without altering the post. Returns the storage path so the caller can delete the bytes, which the post-media delete policy permits only after this has marked the row. The uploader or an administrator may do it; enforce_post_media_transitions() is what says so.';

revoke all on function public.redact_post_media(uuid) from public, anon;
grant execute on function public.redact_post_media(uuid) to authenticated;

-- OPEN ITEM, recorded here rather than assumed away: a row whose post_id stays
-- null is an upload someone started and never posted, and its bytes sit in the
-- bucket for ever. Collecting them needs a job running as the service role —
-- there is deliberately no staff DELETE grant — and it does not exist yet. The
-- workflow_post_media_unclaimed_idx index is here so that when it is written it
-- is a cheap query.
