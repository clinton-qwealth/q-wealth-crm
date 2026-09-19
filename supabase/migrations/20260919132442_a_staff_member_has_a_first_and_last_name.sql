-- A staff member has a first and last name (19 Sep 2026)
--
-- `staff_users` has held a name as one `full_name text` since 4 July. Clients
-- never did: `persons` carries first, middle, last and preferred names, and
-- `parties.display_name` is derived from them. So the schema modelled a client's
-- name properly and a staff member's as one opaque string.
--
-- Clinton asked for the split. The gains are sorting a directory by surname and
-- addressing somebody by their first name — the app already fakes the second
-- with `full_name.split(' ')[0]` on the home page, which is exactly the guess
-- this removes.
--
-- THIS MIGRATION BREAKS NOTHING. It is the first of three, and everything here
-- is additive:
--
--   M1 (this file) → deploy the MCP function → deploy the app → M2 (views) → M3 (removal)
--
-- `full_name` stays, still populated, still read by the nine views and by both
-- deployed clients. The reason for the sequence is the 31 August outage: a
-- migration dropped `staff_users.profile_id` while the deployed MCP function
-- still read it, and every request failed for ten minutes. The documented
-- remedy is add-and-backfill, deploy the clients, only then drop.
--
-- ONE ACCEPTED LIMITATION, stated rather than discovered. Both columns are NOT
-- NULL with a not-blank check, so a staff member must have two name parts. That
-- forbids a mononym. It is the conventional choice for an internal directory and
-- it keeps every display site simple, but it is a real constraint: a person with
-- one name cannot be recorded, and the refusal below is where they would meet it.

-- ---------------------------------------------------------------------------
-- 1. The rule, written once
-- ---------------------------------------------------------------------------
-- Used by the backfill, by the transition trigger and by the request function,
-- so "how a name splits" has exactly one definition. IMMUTABLE so it can sit in
-- a generated expression or an index later without argument.

create or replace function public.split_staff_name(p_name text)
returns text[]
language plpgsql
immutable
set search_path to ''
as $fn$
declare
  v_clean text;
begin
  -- Collapse first, trim second. `btrim` with no argument strips SPACES ONLY,
  -- so a name arriving with a newline survives a trim and breaks the split.
  -- That ordering has already cost this schema two functions — activity_doc_text
  -- on 8 September and note_flat on the 10th.
  v_clean := btrim(regexp_replace(coalesce(p_name, ''), '\s+', ' ', 'g'));

  -- A regexp_replace that matches NOTHING returns its input unchanged, so a
  -- single-token name would split to ITSELF on both sides — 'Prince' becoming
  -- first name Prince and last name Prince — and a guard that only checked for
  -- a blank result would pass it silently. Proved by probe before this was
  -- written. The test is for the separator, not for the outcome.
  if v_clean !~ '\s' then
    raise exception 'Enter a first name and a last name';
  end if;

  return array[
    btrim(regexp_replace(v_clean, '\s+\S+$', '')),  -- everything before the last token
    btrim(regexp_replace(v_clean, '^.*\s', ''))     -- the last token
  ];
end $fn$;

comment on function public.split_staff_name(text) is
  'Splits a staff member''s name: the last whitespace-delimited token is the surname, everything before it the first name. Raises on a name with no internal whitespace rather than coercing — a single-token name would otherwise land identically in both columns. One definition, shared by the backfill, the transition trigger and request_staff_access(). Added 19 Sep 2026.';

revoke all on function public.split_staff_name(text) from public, anon;
grant execute on function public.split_staff_name(text) to authenticated;

-- The composition, also written once, and needed by the trigger below before
-- the views need it in M2.

create or replace function public.staff_display_name(p_first text, p_last text)
returns text
language sql
immutable
set search_path to ''
as $fn$
  select nullif(btrim(concat_ws(' ', nullif(btrim(coalesce(p_first, '')), ''),
                                     nullif(btrim(coalesce(p_last,  '')), ''))), '')
$fn$;

comment on function public.staff_display_name(text, text) is
  'A staff member''s two name parts as one display string. The inverse of split_staff_name(). Written once so the nine views that render a staff name cannot each compose it differently. Added 19 Sep 2026.';

revoke all on function public.staff_display_name(text, text) from public, anon;
grant execute on function public.staff_display_name(text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. The columns, and the backfill
-- ---------------------------------------------------------------------------

alter table public.staff_users
  add column first_name text,
  add column last_name  text;

-- Backfill through the shared rule, so the migration refuses exactly what the
-- application will refuse. An unsplittable name ABORTS rather than being
-- coerced — the same call the marital-status migration made on 15 September,
-- and for the same reason: quietly writing a blank surname would be locked in
-- by the NOT NULL below and would render as a trailing space in every view,
-- with nobody having decided to lose the name.
do $$
declare
  r record;
  v_bad text := '';
begin
  for r in select id, full_name from public.staff_users loop
    begin
      perform public.split_staff_name(r.full_name);
    exception when others then
      v_bad := v_bad || format('%s (%L); ', r.id, r.full_name);
    end;
  end loop;
  if v_bad <> '' then
    raise exception 'These staff names cannot be split into a first and last name: %', v_bad;
  end if;
end $$;

update public.staff_users
   set first_name = (public.split_staff_name(full_name))[1],
       last_name  = (public.split_staff_name(full_name))[2];

-- THE BACKFILL LEAVES PENDING TRIGGER EVENTS, AND ALTER TABLE REFUSES THEM.
-- `enforce_an_administrator_remains` is a DEFERRABLE INITIALLY DEFERRED
-- constraint trigger on this table, so the update above queues one event per
-- row to fire at COMMIT — and Postgres answers the next `alter table` with
-- `55006: cannot ALTER TABLE "staff_users" because it has pending trigger
-- events`. Forcing them to fire here clears the queue and runs the
-- last-administrator check early, which is harmless: nothing above touches a
-- status or a profile. Found by the first apply failing on exactly this.
set constraints all immediate;

alter table public.staff_users
  alter column first_name set not null,
  alter column last_name  set not null,
  add constraint staff_users_first_name_not_blank check (btrim(first_name) <> ''),
  add constraint staff_users_last_name_not_blank  check (btrim(last_name)  <> '');

comment on column public.staff_users.first_name is
  'Given name. Required. See last_name for why a person must have both.';
comment on column public.staff_users.last_name is
  'Family name, and what the staff directory sorts on. Required — together with first_name this means a staff member must have two name parts, so a mononym cannot be recorded. A deliberate limitation taken on 19 Sep 2026 for an internal directory, not an oversight.';

-- ---------------------------------------------------------------------------
-- 3. The transition trigger — what actually makes the window safe
-- ---------------------------------------------------------------------------
-- update_staff_patch() is NOT the only writer. The currently deployed
-- request_staff_access(text) writes full_name alone, and so does anyone editing
-- a row in the Supabase dashboard. A rule that lived only in the patch function
-- would be a rule those two walk straight past — which is the same reasoning
-- that put the self-preservation and last-administrator rules in triggers.
--
-- BEFORE, so it runs ahead of the NOT NULL check: an old client inserting only
-- full_name still succeeds, with the parts filled in for it.
--
-- Dropped in M3, once nothing writes full_name any more.

create or replace function public.keep_staff_name_in_step()
returns trigger
language plpgsql
security invoker
set search_path to ''
as $fn$
declare
  v_parts text[];
begin
  if tg_op = 'INSERT' then
    -- The parts win when they are given: a new client sends those.
    if new.first_name is not null and new.last_name is not null then
      new.full_name := public.staff_display_name(new.first_name, new.last_name);
    elsif new.full_name is not null then
      v_parts := public.split_staff_name(new.full_name);
      new.first_name := v_parts[1];
      new.last_name  := v_parts[2];
    end if;
  else
    if new.first_name is distinct from old.first_name
       or new.last_name is distinct from old.last_name then
      new.full_name := public.staff_display_name(new.first_name, new.last_name);
    elsif new.full_name is distinct from old.full_name then
      v_parts := public.split_staff_name(new.full_name);
      new.first_name := v_parts[1];
      new.last_name  := v_parts[2];
    end if;
  end if;
  return new;
end $fn$;

comment on function public.keep_staff_name_in_step() is
  'Transitional, 19 Sep 2026 to M3. Keeps full_name and first_name/last_name in step whichever side a writer sets, so the old deployed clients and the Supabase dashboard keep working while the new ones roll out. Dropped once full_name goes.';

revoke all on function public.keep_staff_name_in_step() from public, anon, authenticated;

create trigger trg_staff_users_name_in_step
  before insert or update on public.staff_users
  for each row execute function public.keep_staff_name_in_step();

-- ---------------------------------------------------------------------------
-- 4. staff_directory gains the parts — APPENDED
-- ---------------------------------------------------------------------------
-- `create or replace view` permits nothing but appending, and appending is all
-- that is wanted here: full_name stays until M2, so the nine dependent views
-- are untouched and every grant survives. Removing it is what would need a drop.

create or replace view public.staff_directory
with (security_invoker = true) as
  select su.id, su.full_name, su.email, su.status, su.avatar_path,
         -- ── appended 19 September 2026, LAST ─────────────────────────────
         su.first_name, su.last_name
  from public.staff_users su;

-- ---------------------------------------------------------------------------
-- 5. The feed's mention and reaction payloads carry BOTH keys
-- ---------------------------------------------------------------------------
-- `full_name` is a JSON KEY inside `mentioned` and `reactions[].by`, which the
-- activity feed reads directly. Flipping it would break the deployed feed the
-- moment this lands. Emitting BOTH lets the new app read `name` while the old
-- one goes on reading `full_name`; M3 drops the old key once nothing wants it.
--
-- Adding a key inside a jsonb expression is not a column change, so this is a
-- replace: same columns, same order, same types, and the grants survive.

create or replace view public.workflow_posts_summary with (security_invoker = true) as
select p.id, p.workflow_id, p.task_id, p.author_staff_id,
       sd.full_name as author_name,
       p.body, p.body_text, p.created_at,
       coalesce((select jsonb_agg(jsonb_build_object(
                          'staff_id', m.staff_id,
                          'full_name', d.full_name,
                          'name', public.staff_display_name(d.first_name, d.last_name)) order by d.full_name)
                   from public.workflow_post_mentions m
                   join public.staff_directory d on d.id = m.staff_id
                  where m.post_id = p.id), '[]'::jsonb) as mentioned,
       coalesce((select jsonb_agg(jsonb_build_object('reaction', r.reaction, 'by', r.by) order by r.first_at)
                   from (select x.reaction,
                                min(x.created_at) as first_at,
                                jsonb_agg(jsonb_build_object(
                                  'staff_id', x.staff_id,
                                  'full_name', d.full_name,
                                  'name', public.staff_display_name(d.first_name, d.last_name)) order by x.created_at) as by
                           from public.workflow_post_reactions x
                           join public.staff_directory d on d.id = x.staff_id
                          where x.post_id = p.id
                          group by x.reaction) r), '[]'::jsonb) as reactions,
       coalesce((select jsonb_agg(jsonb_build_object(
                          'id', f.id, 'kind', f.kind, 'name', f.original_name,
                          'mime_type', f.mime_type, 'byte_size', f.byte_size,
                          'width', f.width, 'height', f.height,
                          'redacted_at', f.redacted_at,
                          'redacted_by_name', rb.full_name) order by f.created_at)
                   from public.workflow_post_media f
                   left join public.staff_directory rb on rb.id = f.redacted_by
                  where f.post_id = p.id), '[]'::jsonb) as media,
       coalesce((select jsonb_agg(jsonb_build_object(
                          'kind', e.kind,
                          'entity_id', e.entity_id,
                          'label', case e.kind
                                     when 'client'   then (select c.display_name from public.clients c where c.party_id = e.entity_id)
                                     when 'group'    then (select g.name from public.group_summary g where g.group_id = e.entity_id)
                                     when 'workflow' then (select w.name from public.workflows w where w.id = e.entity_id)
                                   end) order by e.kind, e.entity_id)
                   from public.workflow_post_entities e
                  where e.post_id = p.id), '[]'::jsonb) as entities,
       p.parent_post_id,
       p.root_post_id,
       pa.full_name as parent_author_name,
       p.account_id,
       p.policy_id
  from public.workflow_posts p
  left join public.staff_directory sd on sd.id = p.author_staff_id
  left join public.workflow_posts pp on pp.id = p.parent_post_id
  left join public.staff_directory pa on pa.id = pp.author_staff_id;

-- ---------------------------------------------------------------------------
-- 6. The audit label reads BOTH shapes, permanently
-- ---------------------------------------------------------------------------
-- This function reads HISTORICAL payloads out of `audit_log`, which is
-- append-only. Rows written before today carry a `full_name` key and can never
-- be rewritten, so this coalesce is not transitional — it stays after M3, when
-- the column it names no longer exists.
--
-- `full_name` FIRST, so every input the function has ever seen produces the
-- byte-identical output it produced before. That is what keeps IMMUTABLE honest.

create or replace function public.audit_record_label(p_table text, p_data jsonb)
returns text
language sql
immutable
set search_path to ''
as $fn$
  select nullif(btrim(case p_table
    when 'parties'                      then p_data->>'display_name'
    when 'persons'                      then concat_ws(' ', p_data->>'first_name', p_data->>'last_name')
    when 'organisations'                then p_data->>'legal_name'
    when 'client_groups'                then p_data->>'name'
    when 'teams'                        then p_data->>'name'
    when 'access_profiles'              then p_data->>'name'
    -- Payloads written before 19 Sep 2026 carry full_name; those written after
    -- carry the two parts. Both must resolve, forever.
    when 'staff_users'                  then coalesce(p_data->>'full_name',
                                                      concat_ws(' ', p_data->>'first_name', p_data->>'last_name'))
    when 'contact_points'               then p_data->>'value'
    when 'party_roles'                  then p_data->>'role'
    when 'party_relationships'          then p_data->>'relationship_type'
    when 'client_group_members'         then p_data->>'member_role'
    when 'client_group_access'          then p_data->>'access_level'
    when 'notes'                        then p_data->>'title'
    when 'financial_accounts'           then p_data->>'label'
    when 'assets_liabilities'           then p_data->>'label'
    when 'insurance_policies'           then p_data->>'label'
    when 'financial_account_valuations' then p_data->>'as_at'
    when 'note_attachments'             then p_data->>'kind'
    when 'workflow_post_media'          then p_data->>'original_name'
    else coalesce(p_data->>'label', p_data->>'name', p_data->>'display_name', p_data->>'title')
  end), '')
$fn$;

comment on function public.audit_record_label(text, jsonb) is
  'The label to show for an audited row, read from the payload as it stood at the time rather than from the record''s current name. The staff_users branch reads full_name OR the two name parts, because audit_log is append-only and payloads from before 19 Sep 2026 carry the old shape permanently.';

-- ---------------------------------------------------------------------------
-- 7. request_staff_access gains a two-argument form, ALONGSIDE the old one
-- ---------------------------------------------------------------------------
-- A different arity is an overload, not a replacement, so both live until M3 —
-- which is the point: the deployed request-access page goes on calling the
-- one-argument form until the new one ships. PostgREST resolves on the body keys.

create or replace function public.request_staff_access(p_first_name text, p_last_name text)
returns uuid
language plpgsql
security definer
set search_path to ''
as $fn$
declare
  v_uid       uuid;
  v_email     text;
  v_confirmed timestamptz;
  v_domain    text;
  v_first     text;
  v_last      text;
  v_id        uuid;
  v_status    text;
begin
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'Not signed in';
  end if;

  select lower(btrim(u.email)), u.email_confirmed_at
    into v_email, v_confirmed
    from auth.users u
   where u.id = v_uid;
  if v_email is null then
    raise exception 'Not signed in';
  end if;
  if v_confirmed is null then
    raise exception 'Confirm your email address first';
  end if;

  v_domain := split_part(v_email, '@', 2);
  if not exists (select 1 from public.staff_email_domains d where d.domain = v_domain) then
    raise exception 'Access requests are limited to Q Wealth staff email addresses';
  end if;

  -- The 2-120 rule the one-argument form applied to the whole name becomes a
  -- rule per field; 60 each keeps the same ceiling on the composed string.
  v_first := btrim(regexp_replace(coalesce(p_first_name, ''), '\s+', ' ', 'g'));
  v_last  := btrim(regexp_replace(coalesce(p_last_name,  ''), '\s+', ' ', 'g'));
  if v_first = '' or v_last = '' then
    raise exception 'Enter a first name and a last name';
  end if;
  if length(v_first) > 60 or length(v_last) > 60 then
    raise exception 'That name is too long';
  end if;

  select su.id, su.status::text into v_id, v_status
    from public.staff_users su
   where su.auth_user_id = v_uid;
  if found then
    if v_status = 'pending' then
      return v_id;
    end if;
    raise exception 'This account already belongs to a staff record — contact an administrator';
  end if;
  if exists (select 1 from public.staff_users su where lower(su.email) = v_email) then
    raise exception 'A staff record with this email already exists — contact an administrator';
  end if;

  -- full_name is left to the transition trigger, so the composition rule is not
  -- written a second time here.
  insert into public.staff_users (auth_user_id, email, first_name, last_name, status)
  values (v_uid, v_email, v_first, v_last, 'pending')
  returning id into v_id;
  return v_id;
end $fn$;

comment on function public.request_staff_access(text, text) is
  'A signed-in, email-confirmed person on an allowed domain asks to join the staff, giving their name in two parts. Replaces the one-argument form, which is dropped in M3 once the request page ships. Added 19 Sep 2026.';

revoke all on function public.request_staff_access(text, text) from public, anon;
grant execute on function public.request_staff_access(text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 8. update_staff_patch accepts the parts as well
-- ---------------------------------------------------------------------------
-- Signature unchanged — the patch is jsonb, so only the keys inside it move.
-- `full_name` is still accepted, because the deployed Staff tab still sends it;
-- it comes out of the whitelist in M3.

create or replace function public.update_staff_patch(p_staff_id uuid, p_patch jsonb)
returns text
language plpgsql
security invoker
set search_path to ''
as $fn$
declare
  v_keys         text[] := array['full_name', 'first_name', 'last_name', 'email', 'status', 'profile_id', 'avatar_path'];
  v_key          text;
  cur            record;
  v_name         text;
  v_first        text;
  v_last         text;
  v_email        text;
  v_status       text;
  v_profile      uuid;
  v_avatar       text;
  v_before_admin boolean;
  v_after_admin  boolean;
  v_after_active boolean;
  v_rows         int;
begin
  if public.current_staff_id() is null then
    raise exception 'Not an active staff member';
  end if;
  if p_patch is null or jsonb_typeof(p_patch) <> 'object' or p_patch = '{}'::jsonb then
    raise exception 'Nothing to change';
  end if;
  for v_key in select jsonb_object_keys(p_patch) loop
    if not (v_key = any (v_keys)) then
      raise exception 'Unknown field in patch: %', v_key;
    end if;
  end loop;

  select su.id, su.status::text as status, su.avatar_path, saa.profile_id
    into cur
    from public.staff_users su
    left join public.staff_access_assignments saa on saa.staff_id = su.id
   where su.id = p_staff_id;
  if not found then
    raise exception 'No such staff member, or not one you have access to';
  end if;

  if p_patch ? 'full_name' then
    v_name := btrim(p_patch->>'full_name');
    if coalesce(v_name, '') = '' then
      raise exception 'A staff member needs a name';
    end if;
  end if;

  if p_patch ? 'first_name' then
    v_first := btrim(regexp_replace(coalesce(p_patch->>'first_name', ''), '\s+', ' ', 'g'));
    if v_first = '' then
      raise exception 'Enter a first name';
    end if;
    if length(v_first) > 60 then
      raise exception 'That first name is too long';
    end if;
  end if;

  if p_patch ? 'last_name' then
    v_last := btrim(regexp_replace(coalesce(p_patch->>'last_name', ''), '\s+', ' ', 'g'));
    if v_last = '' then
      raise exception 'Enter a last name';
    end if;
    if length(v_last) > 60 then
      raise exception 'That last name is too long';
    end if;
  end if;

  if p_patch ? 'email' then
    v_email := lower(btrim(p_patch->>'email'));
    if coalesce(v_email, '') = '' or v_email not like '%_@_%.%' then
      raise exception 'Enter a valid email address';
    end if;
    if exists (select 1 from public.staff_users su where lower(su.email) = v_email and su.id <> p_staff_id) then
      raise exception 'Another staff member already uses that email address';
    end if;
  end if;

  if p_patch ? 'status' then
    v_status := p_patch->>'status';
    if v_status is null or not (v_status = any (enum_range(null::public.staff_status)::text[])) then
      raise exception 'Unknown status: %', coalesce(v_status, 'null');
    end if;
    if v_status = 'pending' then
      raise exception 'A staff member cannot be returned to pending';
    end if;
    if cur.status = 'pending' and v_status = 'active' then
      raise exception 'Use Approve to activate a pending request';
    end if;
    if p_staff_id = public.current_staff_id() and v_status <> 'active' then
      raise exception 'You cannot deactivate your own account';
    end if;
  end if;

  if p_patch ? 'profile_id' then
    begin
      v_profile := (p_patch->>'profile_id')::uuid;
    exception when others then
      raise exception 'No such access profile';
    end;
    if not exists (select 1 from public.access_profiles ap where ap.id = v_profile) then
      raise exception 'No such access profile';
    end if;
  end if;

  if p_patch ? 'avatar_path' then
    v_avatar := nullif(p_patch->>'avatar_path', '');
    if v_avatar is not null then
      if v_avatar !~ ('^' || p_staff_id::text || '/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(png|jpg|webp)$') then
        raise exception 'That photo does not belong to this staff member';
      end if;
      if not exists (select 1 from storage.objects o where o.bucket_id = 'staff-avatars' and o.name = v_avatar) then
        raise exception 'That photo has not been uploaded';
      end if;
    end if;
  end if;

  if (p_patch ? 'status' or p_patch ? 'profile_id') and cur.status = 'active' then
    select ap.manage_staff into v_before_admin from public.access_profiles ap where ap.id = cur.profile_id;
    if coalesce(v_before_admin, false) then
      v_after_active := coalesce(v_status, cur.status) = 'active';
      select ap.manage_staff into v_after_admin from public.access_profiles ap where ap.id = coalesce(v_profile, cur.profile_id);
      if not (v_after_active and coalesce(v_after_admin, false))
         and not exists (
           select 1
             from public.staff_users su
             join public.staff_access_assignments saa on saa.staff_id = su.id
             join public.access_profiles ap on ap.id = saa.profile_id
            where su.id <> p_staff_id and su.status = 'active' and ap.manage_staff
         ) then
        raise exception 'At least one active administrator must remain';
      end if;
    end if;
  end if;

  -- The transition trigger reconciles whichever side was written, so this does
  -- not compose or split anything itself.
  if p_patch ?| array['full_name', 'first_name', 'last_name', 'email', 'status', 'avatar_path'] then
    update public.staff_users su
       set full_name   = coalesce(v_name, su.full_name),
           first_name  = coalesce(v_first, su.first_name),
           last_name   = coalesce(v_last, su.last_name),
           email       = coalesce(v_email, su.email),
           status      = case when p_patch ? 'status' then v_status::public.staff_status else su.status end,
           avatar_path = case when p_patch ? 'avatar_path' then v_avatar else su.avatar_path end
     where su.id = p_staff_id;
    get diagnostics v_rows = row_count;
    if v_rows = 0 then
      raise exception 'You do not have permission to change this staff member';
    end if;
  end if;

  if p_patch ? 'profile_id' then
    insert into public.staff_access_assignments (staff_id, profile_id)
    values (p_staff_id, v_profile)
    on conflict (staff_id) do update
      set profile_id = excluded.profile_id
      where staff_access_assignments.profile_id is distinct from excluded.profile_id;
  end if;

  return case when p_patch ? 'avatar_path' and cur.avatar_path is distinct from v_avatar then cur.avatar_path end;
end $fn$;

comment on function public.update_staff_patch(uuid, jsonb) is
  'Change a staff member: first_name, last_name, email, status, profile_id and avatar_path, by key presence; unknown keys refused. full_name is still accepted until M3, for the deployed Staff tab. Email is the CRM address, not the sign-in email. Refuses deactivating yourself and removing the last active administrator (both also enforced by triggers). Returns the photo path it replaced or removed, or null. Added 19 Sep 2026.';

-- ---------------------------------------------------------------------------
-- 9. Prove it, or abort
-- ---------------------------------------------------------------------------

do $$
declare
  v_missing int;
begin
  select count(*) into v_missing
    from public.staff_users
   where first_name is null or last_name is null
      or btrim(first_name) = '' or btrim(last_name) = '';
  if v_missing > 0 then
    raise exception 'Backfill left % staff rows without both name parts', v_missing;
  end if;

  select count(*) into v_missing
    from public.staff_users
   where full_name is distinct from public.staff_display_name(first_name, last_name);
  if v_missing > 0 then
    raise exception '% staff rows disagree with their own name parts after backfill', v_missing;
  end if;

  if not exists (
    select 1 from pg_trigger where tgname = 'trg_staff_users_name_in_step'
  ) then
    raise exception 'The transition trigger was not created';
  end if;

  if to_regprocedure('public.request_staff_access(text)') is null
     or to_regprocedure('public.request_staff_access(text,text)') is null then
    raise exception 'Both request_staff_access signatures must exist during the window';
  end if;
end $$;
