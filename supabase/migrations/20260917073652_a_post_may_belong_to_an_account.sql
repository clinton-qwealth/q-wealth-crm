-- A post may belong to an account (17 Sep 2026)
--
-- The account drawer gains an Activity tab, and the instruction was explicit:
-- do not rebuild the tables, use the ones the task panel already uses and link
-- the relationship to the investment account. This is that, and it is a bigger
-- change than it sounds, because `workflow_posts.workflow_id` is not merely a
-- column — it is load-bearing in four places:
--
--   1. RLS. The whole access rule for a post, its mentions, its reactions and
--      its media is "can you see the workflow", deferred through this column.
--   2. Storage. A media row's path is `workflow_id/media_id`, by check constraint.
--   3. Revalidation. Every server action takes it and revalidates that route.
--   4. Every write path's first argument.
--
-- SO THE COLUMN BECOMES ONE OF TWO SCOPES RATHER THAN THE ONLY ONE, and the
-- thing that makes that safe is a check constraint: EXACTLY ONE of workflow_id
-- and account_id is set on every row, enforced by the database rather than by
-- the write paths. A post cannot be unscoped, and it cannot be scoped twice.
-- Relaxing a NOT NULL without that would be the actual risk here.
--
-- WHAT AN ACCOUNT POST GETS, AND WHAT IT DOES NOT, IN V1
--
--   Replies, @mentions and reactions all key off `post_id` alone and work
--   untouched — that is the whole reason for reusing the table.
--
--   Files are NOT offered. Media is keyed and path-derived by workflow_id, and
--   giving an account post a file would mean reworking the storage layout for a
--   tab that has none yet. `PostComposer` already treats its uploader as
--   optional — "absent → cannot carry pictures" — so this costs nothing but a
--   prop, and the write path below REFUSES a document naming a file rather
--   than inserting one nothing would claim.
--
--   `#` chips are NOT offered either. The workflow write path validates a chip
--   against the workflow's own group; an account reaches a group through its
--   owners and may reach more than one, which is a rule worth deciding
--   deliberately rather than inventing here. Refused explicitly, with a
--   sentence that says it is not yet rather than not ever.
--
-- THE TABLE KEEPS ITS NAME. `workflow_posts` is now a slight misnomer, and a
-- rename would touch the view, four server actions, the types and every test
-- for no behavioural gain. Recorded as the cost rather than paid today.
--
-- THE DOCUMENT RULES MOVE INTO ONE PLACE, for the reason the ingest promotions
-- moved theirs yesterday: two copies of a validator is one fix landing in one
-- of them. `validate_post_body()` holds everything about what a post document
-- may contain, and both write paths call it. It is PURE — it raises or it does
-- not, and writes nothing — which is what makes it cheap to prove equivalent:
-- feed the same documents to the old and the new and compare the refusals.

-- ---------------------------------------------------------------------------
-- 1. The second scope
-- ---------------------------------------------------------------------------

alter table public.workflow_posts
  alter column workflow_id drop not null,
  add column account_id uuid references public.financial_accounts(id) on delete cascade,
  -- Exactly one scope. `num_nonnulls` rather than a hand-written pair of IS
  -- NULLs, so adding a third scope later is one number.
  add constraint workflow_posts_has_one_scope
    check (num_nonnulls(workflow_id, account_id) = 1),
  -- A task belongs to a workflow, so an account post can never name one. The
  -- composite FK to workflow_tasks does NOT catch this: it is MATCH SIMPLE, so
  -- a NULL workflow_id satisfies it whatever task_id says.
  add constraint workflow_posts_account_has_no_task
    check (account_id is null or task_id is null);

-- The account feed's own read path, mirroring workflow_posts_workflow_created_idx.
create index workflow_posts_account_created_idx
  on public.workflow_posts (account_id, created_at desc, id desc)
  where account_id is not null;

comment on table public.workflow_posts is
  'A post on a workflow''s timeline — optionally about one of its tasks — or, since 17 Sep 2026, on a financial account. Exactly one of workflow_id and account_id is set, by check constraint. Optionally in reply to another post. Append-only. body is a structured document validated by validate_post_body(); a heading in a post is level 1 and there is only one size. body_text is the derived plain text. The name is historical: it carries account posts too.';
comment on column public.workflow_posts.account_id is
  'The financial account this post is about, when it is about one. Exactly one of this and workflow_id is set. An account post carries no task, no files and no entity chips in v1 — see the migration of 17 Sep 2026.';

-- ---------------------------------------------------------------------------
-- 2. Row-level security: a second branch, not a weaker rule
-- ---------------------------------------------------------------------------
-- The workflow branch is unchanged, character for character. The account branch
-- defers to `staff_can_access_account()`, which is the same function the
-- allocations table's select policy uses, so "can you see this account" means
-- one thing across the schema.

drop policy workflow_posts_select on public.workflow_posts;
create policy workflow_posts_select on public.workflow_posts
  for select to authenticated
  using (
    (workflow_posts.workflow_id is not null
      and exists (select 1 from public.workflows w where w.id = workflow_posts.workflow_id))
    or
    (workflow_posts.account_id is not null
      and public.staff_can_access_account(workflow_posts.account_id))
  );

drop policy workflow_posts_insert on public.workflow_posts;
create policy workflow_posts_insert on public.workflow_posts
  for insert to authenticated
  with check (
    public.is_active_staff()
    and author_staff_id = public.current_staff_id()
    and (
      (workflow_posts.workflow_id is not null
        and exists (select 1 from public.workflows w where w.id = workflow_posts.workflow_id))
      or
      (workflow_posts.account_id is not null
        and public.staff_can_access_account(workflow_posts.account_id))
    )
  );

-- Mentions, reactions and entities are unchanged: every one of them reaches its
-- post through `post_id` and inherits whichever branch above admitted it. That
-- is the property that made reusing this table worth the NOT NULL.

-- ---------------------------------------------------------------------------
-- 3. The document rules, in one place
-- ---------------------------------------------------------------------------

create or replace function public.validate_post_body(p_body jsonb)
returns void
language plpgsql
immutable
set search_path = ''
as $fn$
declare
  v_bad text;
begin
  if p_body is null or jsonb_typeof(p_body) <> 'object' or p_body->>'type' <> 'doc' then
    raise exception 'A post must be a document';
  end if;

  select n->>'type' into v_bad
    from jsonb_path_query(p_body, 'strict $.**') as t(n)
   where jsonb_typeof(n) = 'object' and n ? 'type'
     and n->>'type' not in ('doc','paragraph','text','hardBreak','mention','entity',
                            'bulletList','orderedList','listItem',
                            'heading','blockquote','codeBlock','horizontalRule',
                            'image','attachment','callout',
                            'bold','italic','strike','code','link','underline')
   limit 1;
  if v_bad is not null then
    raise exception 'A post may not contain "%"', v_bad;
  end if;

  -- ONE level. Was '^[123]$' until 8 September.
  perform 1
    from jsonb_path_query(p_body, 'strict $.** ? (@.type == "heading")') as t(n)
   where coalesce(n->'attrs'->>'level', '') <> '1'
   limit 1;
  if found then
    raise exception 'A post has one heading size; a heading must be level 1';
  end if;

  perform 1
    from jsonb_path_query(p_body, 'strict $.** ? (@.type == "callout")') as t(n)
   where coalesce(n->'attrs'->>'tone', '') not in ('info', 'warning', 'success')
   limit 1;
  if found then
    raise exception 'A callout must be info, warning or success';
  end if;

  perform 1
    from jsonb_path_query(p_body, 'strict $.** ? (@.type == "link")') as t(n)
   where coalesce(n->'attrs'->>'href', '') !~* '^https?://'
   limit 1;
  if found then
    raise exception 'A link must start with http:// or https://';
  end if;

  perform 1
    from jsonb_path_query(p_body, 'strict $.** ? (@.type == "entity")') as t(n)
   where coalesce(n->'attrs'->>'kind', '') not in ('client', 'group', 'workflow')
      or coalesce(n->'attrs'->>'id', '')
           !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      or coalesce(btrim(n->'attrs'->>'label'), '') = '';
  if found then
    raise exception 'A chip must name a client, group or workflow, by id, with a label';
  end if;

  perform 1
    from jsonb_path_query(p_body, 'strict $.** ? (@.type == "image" || @.type == "attachment")') as t(n)
   where n->'attrs' ?| array['src', 'srcset', 'href', 'url'];
  if found then
    raise exception 'A file in a post is named by id, never by address';
  end if;

  perform 1
    from jsonb_path_query(p_body, 'strict $.** ? (@.type == "image" || @.type == "attachment")') as t(n)
   where coalesce(n->'attrs'->>'id', '')
           !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      or coalesce(btrim(n->'attrs'->>'name'), '') = '';
  if found then
    raise exception 'A file must name an upload and carry its filename';
  end if;

  perform 1
    from jsonb_path_query(p_body, 'strict $.** ? (@.type == "image")') as t(n)
   where n->'attrs'->>'width' is not null
     and n->'attrs'->>'width' !~ '^[0-9]{1,4}$';
  if found then
    raise exception 'An image''s width must be a whole number of pixels';
  end if;

  perform 1
    from jsonb_path_query(p_body, 'strict $.** ? (@.type == "image")') as t(n)
   where n->'attrs'->>'width' is not null
     and (n->'attrs'->>'width')::int not between 40 and 2000;
  if found then
    raise exception 'An image''s width must be between 40 and 2000 pixels';
  end if;

  if coalesce(public.activity_doc_text(p_body), '') = '' then
    raise exception 'A post needs some words';
  end if;
end $fn$;

comment on function public.validate_post_body(jsonb) is
  'Everything a post document must be, and nothing about where it lives: the node and mark whitelist, one heading size, callout tones, http(s) links, chip shape, files named by id and never by address, image widths, and some actual words. Raises with the sentence the writer should read. Lifted out of post_workflow_activity on 17 Sep 2026 so the account write path could not hold a second copy. Pure — it writes nothing.';

revoke all on function public.validate_post_body(jsonb) from public, anon;
grant execute on function public.validate_post_body(jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. The workflow write path, rewritten onto the shared validator
-- ---------------------------------------------------------------------------
-- Same signature, same messages, same refusals. The insert, the mentions, the
-- entity rules and the media claim are character for character as they were.
-- TWO things are NOT, and both were found by diffing this against the live
-- function on the verification branch rather than by reading it:
--
-- 1. `v_p_wf <> p_workflow_id` BECOMES `is distinct from`, and this one is
--    load-bearing. Until today `workflow_id` was NOT NULL, so `<>` was total.
--    This migration makes it nullable, and on an account post the parent's
--    workflow_id is NULL — so `NULL <> <a uuid>` is NULL, the OR is NULL, the
--    IF does not fire, and a WORKFLOW post could be threaded under an ACCOUNT
--    post. The check that was meant to keep a reply with its parent would have
--    silently stopped applying at exactly the moment a second scope existed.
--    Proved on the branch in both directions: refused now, and the predicate
--    itself demonstrated to return NULL under the old operator.
--
-- 2. The document checks now run BEFORE the reply check rather than around it.
--    The live function checks the document's shape, then the parent, then the
--    rest of the document; one call to a shared validator cannot straddle the
--    parent check. This only shows on input that is invalid in two ways at
--    once, where the document's complaint is now raised instead of the reply's.
--    Both are correct refusals and the sentences are unchanged; recorded
--    because "no behaviour changed" would have been false.

create or replace function public.post_workflow_activity(
  p_workflow_id    uuid,
  p_task_id        uuid,
  p_body           jsonb,
  p_parent_post_id uuid default null
) returns uuid
language plpgsql
security invoker
set search_path = ''
as $fn$
declare
  v_id       uuid;
  v_mention  uuid;
  v_media    uuid;
  v_kind     text;
  v_group    uuid;
  v_entity   uuid;
  v_ent_kind text;
  v_root     uuid;
  v_p_wf     uuid;
  v_p_task   uuid;
begin
  if public.current_staff_id() is null then
    raise exception 'Not an active staff member';
  end if;
  if p_workflow_id is null then
    raise exception 'No workflow given';
  end if;

  perform public.validate_post_body(p_body);

  if p_parent_post_id is not null then
    select p.workflow_id, p.task_id, coalesce(p.root_post_id, p.id)
      into v_p_wf, v_p_task, v_root
      from public.workflow_posts p
     where p.id = p_parent_post_id;
    if v_root is null then
      raise exception 'No such post to reply to, or not within your access';
    end if;
    if v_p_wf is distinct from p_workflow_id or v_p_task is distinct from p_task_id then
      raise exception 'A reply belongs to the same workflow and task as the post it answers';
    end if;
  end if;

  if p_task_id is not null and not exists (
       select 1 from public.workflow_tasks t
        where t.id = p_task_id and t.workflow_id = p_workflow_id) then
    raise exception 'No such task on this workflow, or not within your access';
  end if;

  insert into public.workflow_posts
         (workflow_id, task_id, author_staff_id, body, parent_post_id, root_post_id)
  values (p_workflow_id, p_task_id, public.current_staff_id(), p_body,
          p_parent_post_id, v_root)
  returning id into v_id;

  for v_mention in
    select distinct (n->'attrs'->>'id')::uuid
      from jsonb_path_query(p_body, 'strict $.** ? (@.type == "mention")') as t(n)
     where n->'attrs'->>'id' is not null
  loop
    if not exists (select 1 from public.staff_directory d where d.id = v_mention) then
      raise exception 'Mentioned person is not a staff member';
    end if;
    insert into public.workflow_post_mentions (post_id, staff_id) values (v_id, v_mention);
  end loop;

  select w.group_id into v_group from public.workflows w where w.id = p_workflow_id;

  for v_ent_kind, v_entity in
    select distinct n->'attrs'->>'kind', (n->'attrs'->>'id')::uuid
      from jsonb_path_query(p_body, 'strict $.** ? (@.type == "entity")') as t(n)
  loop
    if v_ent_kind = 'group' then
      if v_entity <> v_group then
        raise exception 'A post can only name the client group its workflow belongs to';
      end if;
    elsif v_ent_kind = 'client' then
      if not exists (
        select 1 from public.client_group_members m
         where m.group_id = v_group
           and m.party_id = v_entity
           and m.end_date is null) then
        raise exception 'A post can only name a current member of its workflow''s client group';
      end if;
    else
      if not exists (
        select 1 from public.workflows w
         where w.id = v_entity and w.group_id = v_group) then
        raise exception 'A post can only name a workflow on the same client group';
      end if;
    end if;

    insert into public.workflow_post_entities (post_id, kind, entity_id)
    values (v_id, v_ent_kind, v_entity);
  end loop;

  for v_media, v_kind in
    select distinct (n->'attrs'->>'id')::uuid,
           case n->>'type' when 'image' then 'image' else 'file' end
      from jsonb_path_query(p_body, 'strict $.** ? (@.type == "image" || @.type == "attachment")') as t(n)
  loop
    update public.workflow_post_media m
       set post_id = v_id
     where m.id = v_media
       and m.workflow_id = p_workflow_id
       and m.uploaded_by = public.current_staff_id()
       and m.kind = v_kind
       and m.post_id is null
       and m.redacted_at is null;
    if not found then
      raise exception 'That file is not yours to post, has already been posted, or is not the kind the post claims it is';
    end if;
  end loop;

  return v_id;
end $fn$;

revoke all on function public.post_workflow_activity(uuid, uuid, jsonb, uuid) from public, anon;
grant execute on function public.post_workflow_activity(uuid, uuid, jsonb, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. The account write path
-- ---------------------------------------------------------------------------

create or replace function public.post_account_activity(
  p_account_id     uuid,
  p_body           jsonb,
  p_parent_post_id uuid default null
) returns uuid
language plpgsql
security invoker
set search_path = ''
as $fn$
declare
  v_id      uuid;
  v_mention uuid;
  v_root    uuid;
  v_p_acct  uuid;
begin
  if public.current_staff_id() is null then
    raise exception 'Not an active staff member';
  end if;
  if p_account_id is null then
    raise exception 'No account given';
  end if;

  perform public.validate_post_body(p_body);

  -- Refused HERE rather than left to fail at a claim step that does not exist:
  -- an unclaimed media reference would insert cleanly and render as a broken
  -- file forever. The sentence says "yet" because the limit is the storage
  -- layout, not a rule about what belongs on an account.
  perform 1
    from jsonb_path_query(p_body, 'strict $.** ? (@.type == "image" || @.type == "attachment")') as t(n);
  if found then
    raise exception 'A post on an account cannot carry files yet';
  end if;

  -- Likewise: a chip on an account has no group to be checked against until
  -- somebody decides which of an account''s owners'' groups counts.
  perform 1
    from jsonb_path_query(p_body, 'strict $.** ? (@.type == "entity")') as t(n);
  if found then
    raise exception 'A post on an account cannot name a client, group or workflow yet';
  end if;

  -- The account must be one this staff member can see. RLS on the insert would
  -- refuse it anyway; this is the readable sentence in front of that.
  if not public.staff_can_access_account(p_account_id) then
    raise exception 'No such account, or not within your access';
  end if;

  if p_parent_post_id is not null then
    select p.account_id, coalesce(p.root_post_id, p.id)
      into v_p_acct, v_root
      from public.workflow_posts p
     where p.id = p_parent_post_id;
    if v_root is null then
      raise exception 'No such post to reply to, or not within your access';
    end if;
    if v_p_acct is distinct from p_account_id then
      raise exception 'A reply belongs to the same account as the post it answers';
    end if;
  end if;

  insert into public.workflow_posts
         (account_id, author_staff_id, body, parent_post_id, root_post_id)
  values (p_account_id, public.current_staff_id(), p_body,
          p_parent_post_id, v_root)
  returning id into v_id;

  for v_mention in
    select distinct (n->'attrs'->>'id')::uuid
      from jsonb_path_query(p_body, 'strict $.** ? (@.type == "mention")') as t(n)
     where n->'attrs'->>'id' is not null
  loop
    if not exists (select 1 from public.staff_directory d where d.id = v_mention) then
      raise exception 'Mentioned person is not a staff member';
    end if;
    insert into public.workflow_post_mentions (post_id, staff_id) values (v_id, v_mention);
  end loop;

  return v_id;
end $fn$;

comment on function public.post_account_activity(uuid, jsonb, uuid) is
  'Post to a financial account''s activity, optionally in reply to another post on the same account. Same document rules as a workflow post — validate_post_body() is shared — minus files and entity chips, which are refused with a sentence saying not yet. Mentions, reactions and replies work exactly as they do on a workflow, because all three key off post_id alone.';

revoke all on function public.post_account_activity(uuid, jsonb, uuid) from public, anon;
grant execute on function public.post_account_activity(uuid, jsonb, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. The summary view carries the second scope
-- ---------------------------------------------------------------------------
-- Appended LAST, which `create or replace view` is the reason for: it keeps
-- every existing column at its name, type and POSITION and permits nothing but
-- appending. An existing reader selecting by name is unaffected either way, and
-- the feed reads named columns rather than the star.

create or replace view public.workflow_posts_summary with (security_invoker = true) as
select p.id, p.workflow_id, p.task_id, p.author_staff_id,
       sd.full_name as author_name,
       p.body, p.body_text, p.created_at,
       coalesce((select jsonb_agg(jsonb_build_object('staff_id', m.staff_id, 'full_name', d.full_name) order by d.full_name)
                   from public.workflow_post_mentions m
                   join public.staff_directory d on d.id = m.staff_id
                  where m.post_id = p.id), '[]'::jsonb) as mentioned,
       coalesce((select jsonb_agg(jsonb_build_object('reaction', r.reaction, 'by', r.by) order by r.first_at)
                   from (select x.reaction,
                                min(x.created_at) as first_at,
                                jsonb_agg(jsonb_build_object('staff_id', x.staff_id, 'full_name', d.full_name) order by x.created_at) as by
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

       -- ── appended 17 September 2026 ──────────────────────────────────────
       -- LAST, not beside workflow_id where it reads better. `create or replace
       -- view` keeps every existing column at its own name, type AND POSITION,
       -- and permits nothing but appending — so account_id in third place would
       -- have renamed task_id to account_id and the statement would have been
       -- refused outright. Drafted in third place, caught by reading the live
       -- column order out of information_schema before applying anything.
       p.account_id
  from public.workflow_posts p
  left join public.staff_directory sd on sd.id = p.author_staff_id
  left join public.workflow_posts pp on pp.id = p.parent_post_id
  left join public.staff_directory pa on pa.id = pp.author_staff_id;

comment on view public.workflow_posts_summary is
  'Posts with the author named, mentions resolved to current names, reactions grouped by kind with who gave each, the media each post carries, the entities it names, and its place in a thread — parent_post_id, root_post_id and the name of the person being answered. Carries account_id since 17 Sep 2026; exactly one of workflow_id and account_id is set. security_invoker: RLS on workflow_posts decides, deferring to the workflow or to staff_can_access_account().';

revoke all on public.workflow_posts_summary from public, anon, authenticated;
grant select on public.workflow_posts_summary to authenticated;

-- ---------------------------------------------------------------------------
-- 7. The group's account posts, in one read
-- ---------------------------------------------------------------------------
-- The group page is held to TWO waves, and the drawer renders out of what the
-- page already fetched. Reading posts keyed by the account ids would mean
-- waiting for the accounts first, which is a third wave; reading every account
-- post the caller can see would drag in other groups' for nothing.
--
-- So the same shape `group_financial_accounts` takes, for the same reason: keyed
-- by group, so the page asks once, by the id already in the URL, on the wave
-- that is already running. A post on a jointly owned account appears under each
-- group that owns it, exactly as the account itself does.

create view public.group_account_posts
with (security_invoker = true) as
select g.group_id, s.*
from (
  select distinct m.group_id, o.account_id
    from public.client_group_members m
    join public.financial_account_owners o on o.party_id = m.party_id
   where m.end_date is null
) g
join public.workflow_posts_summary s on s.account_id = g.account_id;

comment on view public.group_account_posts is
  'Every post on an account owned by a CURRENT member of the group, keyed by group so the group page reads it in its first wave. security_invoker throughout: workflow_posts_summary defers to workflow_posts, which defers to staff_can_access_account(). Added 17 Sep 2026 with the account drawer''s Activity tab.';

revoke all on public.group_account_posts from public, anon, authenticated;
grant select on public.group_account_posts to authenticated;
