-- A post may reply to a post.
--
-- Asked for on 8 September: a reply glyph beside the reactions, so a post can
-- be answered rather than followed by an unrelated one.
--
-- ---- ARBITRARY DEPTH IN THE DATA, ONE INDENT ON THE SCREEN ----------------
--
-- The shape chosen deliberately, and it is neither of the two obvious ones.
-- A reply may reply to a reply, to any depth — so the DATA records exactly who
-- answered whom, which is a real fact about a conversation and cannot be
-- recovered once flattened. But the SCREEN draws every descendant of a
-- top-level post at a single indent, oldest first, because a 557px reading
-- column runs out of room at the third level and a deeply nested thread makes
-- the workflow timeline unreadable once posts from many tasks interleave.
--
-- That is why there are TWO columns rather than one:
--
--   parent_post_id  who this post is answering — the fact worth keeping
--   root_post_id    which thread it belongs to — what the screen groups by
--
-- `root_post_id` is deliberate denormalisation, and the write path is what
-- keeps it honest: it is never accepted from a caller, it is DERIVED from the
-- parent (the parent's root, or the parent itself when the parent is a root).
-- The alternative is a recursive CTE on every feed read to find each post's
-- root, which is a lot of work per render to recover something that cannot
-- change — a post is append-only, so its ancestry is fixed the moment it
-- exists. Same reasoning as `workflow_posts.workflow_id`, which is stored
-- beside `task_id` rather than derived through it.
--
-- NULL MEANS ROOT for both, which mirrors `task_id`: null there means "about
-- the workflow rather than a task", null here means "this starts a thread".
-- The feed groups on `coalesce(root_post_id, id)`.

alter table public.workflow_posts
  add column parent_post_id uuid references public.workflow_posts(id) on delete cascade,
  add column root_post_id   uuid references public.workflow_posts(id) on delete cascade,
  -- A reply has both or neither. Half-set would be a post that belongs to a
  -- thread without answering anything, or answers something without belonging
  -- to a thread, and neither is a state the screen could draw.
  add constraint workflow_posts_reply_is_complete
    check ((parent_post_id is null) = (root_post_id is null)),
  -- A post cannot be its own parent or its own thread.
  add constraint workflow_posts_no_self_reply
    check (parent_post_id is distinct from id and root_post_id is distinct from id);

comment on column public.workflow_posts.parent_post_id is
  'The post this one answers. Null starts a thread. Any depth is permitted — a reply may answer a reply — because who answered whom is a fact worth keeping even though the screen draws every descendant at one indent.';
comment on column public.workflow_posts.root_post_id is
  'The top-level post of the thread this belongs to. Null means this post IS a root. Derived by post_workflow_activity() from the parent and never accepted from a caller, so it cannot disagree with parent_post_id; stored rather than computed because a feed would otherwise need a recursive query per render to recover something that can never change.';

-- The feed's own access path: every post in a thread, in order.
create index workflow_posts_thread_idx
  on public.workflow_posts (root_post_id, created_at, id) where root_post_id is not null;
create index workflow_posts_parent_idx
  on public.workflow_posts (parent_post_id) where parent_post_id is not null;

-- ---- the write path -------------------------------------------------------

-- The signature gains a parameter, so THE OLD ONE IS DROPPED IN THIS MIGRATION.
-- `create or replace` with a different parameter list makes an overload, not a
-- replacement: both would live on, and a three-argument call would go on
-- resolving to the version that cannot reply, with nothing saying so. The same
-- decision was made for set_preferred_address() and create_workflow_task().
drop function if exists public.post_workflow_activity(uuid, uuid, jsonb);

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
  v_bad      text;
  v_href     text;
  v_level    text;
  v_tone     text;
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
  if p_body is null or jsonb_typeof(p_body) <> 'object' or p_body->>'type' <> 'doc' then
    raise exception 'A post must be a document';
  end if;

  -- The reply's ancestry, resolved BEFORE anything is written.
  --
  -- The parent is read under the caller's own RLS, so replying to a post you
  -- cannot see is indistinguishable from replying to one that does not exist.
  -- Its workflow and task must match the ones given: a reply belongs to the
  -- same conversation as the post it answers, and letting it name a different
  -- task would put half a thread on another screen.
  if p_parent_post_id is not null then
    select p.workflow_id, p.task_id, coalesce(p.root_post_id, p.id)
      into v_p_wf, v_p_task, v_root
      from public.workflow_posts p
     where p.id = p_parent_post_id;
    if v_root is null then
      raise exception 'No such post to reply to, or not within your access';
    end if;
    if v_p_wf <> p_workflow_id or v_p_task is distinct from p_task_id then
      raise exception 'A reply belongs to the same workflow and task as the post it answers';
    end if;
  end if;

  -- Every node and mark type must be one the renderer knows.
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

  select n->'attrs'->>'level' into v_level
    from jsonb_path_query(p_body, 'strict $.** ? (@.type == "heading")') as t(n)
   where coalesce(n->'attrs'->>'level', '') !~ '^[123]$'
   limit 1;
  if found then
    raise exception 'A heading must be level 1, 2 or 3';
  end if;

  select n->'attrs'->>'tone' into v_tone
    from jsonb_path_query(p_body, 'strict $.** ? (@.type == "callout")') as t(n)
   where coalesce(n->'attrs'->>'tone', '') not in ('info', 'warning', 'success')
   limit 1;
  if found then
    raise exception 'A callout must be info, warning or success';
  end if;

  select n->'attrs'->>'href' into v_href
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

comment on function public.post_workflow_activity(uuid, uuid, jsonb, uuid) is
  'Post to a workflow''s timeline, optionally about one of its tasks (p_task_id null for the workflow itself) and optionally in reply to another post (p_parent_post_id). A reply must answer a post on the same workflow and the same task; its thread root is DERIVED from the parent and never taken from the caller. Any depth of reply is permitted. p_body is a document. Nodes: doc, paragraph, text, hardBreak, mention, entity (attrs.kind client/group/workflow, attrs.id, attrs.label - must belong to the workflow''s own client group), bulletList, orderedList, listItem, heading (level 1-3), blockquote, codeBlock, horizontalRule, callout (attrs.tone info/warning/success), image and attachment (attrs.id = a workflow_post_media id you uploaded on this workflow and have not posted before, whose kind must match the node; attrs.name = filename; image also takes attrs.alt and attrs.width 40-2000; an address attribute of any kind is refused). Marks: bold, italic, strike, code, underline, link (http(s) only). Anything else is refused.';

comment on table public.workflow_posts is
  'A post on a workflow''s timeline, optionally about one of its tasks and optionally in reply to another post. Append-only: no application role may update or delete. parent_post_id records who a reply answers (any depth); root_post_id records which thread it belongs to and is derived from the parent, never supplied. body is a structured document validated by post_workflow_activity(). body_text is the derived plain text.';

revoke all on function public.post_workflow_activity(uuid, uuid, jsonb, uuid) from public, anon;
grant execute on function public.post_workflow_activity(uuid, uuid, jsonb, uuid) to authenticated;

-- ---- what the feed reads --------------------------------------------------

-- Gains `parent_post_id`, `root_post_id` and **the name of the person being
-- answered**. That last one is what makes a flat thread honest: with arbitrary
-- depth drawn at one indent, a reply three levels down would otherwise look
-- like a reply to the root. The screen shows "replying to <name>" whenever the
-- parent is not the thread's root, so the shape the data holds is still
-- legible at a single indent.
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
       pa.full_name as parent_author_name
  from public.workflow_posts p
  left join public.staff_directory sd on sd.id = p.author_staff_id
  left join public.workflow_posts pp on pp.id = p.parent_post_id
  left join public.staff_directory pa on pa.id = pp.author_staff_id;
comment on view public.workflow_posts_summary is
  'Posts with the author named, mentions resolved to current names, reactions grouped by kind with who gave each, the media each post carries, the entities it names, and its place in a thread — parent_post_id, root_post_id and the name of the person being answered. security_invoker: RLS on workflow_posts, and through it on workflows, decides.';
revoke all on public.workflow_posts_summary from public, anon, authenticated;
grant select on public.workflow_posts_summary to authenticated;
