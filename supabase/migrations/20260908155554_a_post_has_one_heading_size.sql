-- A post has ONE heading size.
--
-- The whitelist has only ever grown. This is the first time it has NARROWED,
-- and the direction matters for how it is done.
--
-- Three levels were allowed on the reasoning that three sizes of emphasis was
-- already a large reduction from the six the editor ships with. In use even
-- three was too many: a post is a paragraph or two about a piece of work, and
-- the sizes were being chosen arbitrarily rather than structurally.
--
-- ---- WHY THIS IS SAFE, CHECKED RATHER THAN ASSUMED ------------------------
--
-- Narrowing a rule that stored rows were written under is normally the
-- dangerous direction: a generated column is not recomputed and a check
-- constraint is not re-validated, so existing rows simply stop satisfying a
-- rule nobody will notice. Here the question was asked of the data first:
--
--   select n->'attrs'->>'level', count(*)
--     from workflow_posts p,
--          jsonb_path_query(p.body, 'strict $.** ? (@.type == "heading")') as t(n)
--    group by 1;
--
-- Zero rows. No stored post carries a heading of ANY level, so nothing is
-- being orphaned by this change.
--
-- ---- AND WHY THE RENDERER IS NOT NARROWED ---------------------------------
--
-- The web app's renderer still maps level 2 to an h5 and level 3 to an h6.
-- That is deliberate. A renderer that forgot how to draw a level the database
-- once accepted would break history the moment such a row turned up — from a
-- restored backup, or from a row written in the window before this migration.
-- The GATE narrows; the reader stays generous. That asymmetry is the safe one.
--
-- The order was also deliberate: the editor lost its Heading 2 and Heading 3
-- buttons BEFORE this ran. For a widening, the migration goes first (the app
-- must never ask for what the schema lacks); for a NARROWING it is the
-- reverse, or the toolbar would offer a level the write path had begun to
-- refuse.

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
  select n->'attrs'->>'level' into v_level
    from jsonb_path_query(p_body, 'strict $.** ? (@.type == "heading")') as t(n)
   where coalesce(n->'attrs'->>'level', '') <> '1'
   limit 1;
  if found then
    raise exception 'A post has one heading size; a heading must be level 1';
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
  'Post to a workflow''s timeline, optionally about one of its tasks (p_task_id null for the workflow itself) and optionally in reply to another post (p_parent_post_id). A reply must answer a post on the same workflow and the same task; its thread root is DERIVED from the parent. Any depth of reply is permitted. p_body is a document. Nodes: doc, paragraph, text, hardBreak, mention, entity, bulletList, orderedList, listItem, heading (attrs.level must be 1 — a post has ONE heading size, narrowed from three on 8 September), blockquote, codeBlock, horizontalRule, callout (attrs.tone info/warning/success), image and attachment. Marks: bold, italic, strike, code, underline, link (http(s) only). Anything else is refused.';

comment on table public.workflow_posts is
  'A post on a workflow''s timeline, optionally about one of its tasks and optionally in reply to another post. Append-only. body is a structured document validated by post_workflow_activity(); a heading in a post is level 1 and there is only one size. body_text is the derived plain text.';
