-- A post may name a client, a group or another workflow.
--
-- `@` names a colleague; `#` names a thing in the business. The chip carries an
-- id and the label as typed, exactly as a mention does, and the view resolves
-- the label to what the thing is called TODAY.
--
-- The point of the feature is not the chip. It is workflow_post_entities: once
-- "which posts are about this client" is a row lookup rather than a scan
-- through every document's JSON, it can become a tab on a client, a feed on a
-- group, or a question the connector answers. The chip is how the row gets
-- written; the table is the reason to write it.
--
-- ---- THE RULE THAT MATTERS -----------------------------------------------
--
-- A post may only name things in the SAME CLIENT GROUP as the workflow it sits
-- on. Not "anything the author can see", which was the first design and is
-- wrong.
--
-- The reason is body_text. A chip's label is part of the post's plain text —
-- it has to be, or "the post about the Testsmith trust" is unfindable — and
-- body_text is readable by everyone who can read the post. So if an adviser
-- could chip a client from another group, that client's NAME would be
-- published to every staff member with access to this workflow, none of whom
-- may have any right to it. RLS on the client's own row would still hold; the
-- name would already have escaped through the text column.
--
-- Confining chips to the workflow's own group closes that completely: anyone
-- who can see the post can see the workflow, therefore the group, therefore
-- its members. Nothing is revealed that the reader could not already read. It
-- is also the same set the composer offers, so the rule and the interface
-- agree instead of the interface being the only thing stopping a leak.

-- ---- the rows -------------------------------------------------------------

create table public.workflow_post_entities (
  post_id   uuid not null references public.workflow_posts(id) on delete cascade,
  kind      text not null,
  entity_id uuid not null,
  -- One row per thing per post: naming the same client twice in a paragraph is
  -- one fact about the post, not two.
  primary key (post_id, kind, entity_id),
  constraint workflow_post_entities_kind_allowed
    check (kind in ('client', 'group', 'workflow'))
);
comment on table public.workflow_post_entities is
  'The clients, groups and workflows a post names, extracted from its document by post_workflow_activity(). Normalised so "posts about this client" is a lookup rather than a JSON scan — which is the whole reason the chip exists. entity_id is deliberately NOT a foreign key: it points at one of three tables depending on kind, and the write path checks it against the right one under the caller''s own RLS.';
comment on column public.workflow_post_entities.entity_id is
  'A party_id when kind is client, a client_groups.id when group, a workflows.id when workflow. Guaranteed at write time to belong to the same client group as the post''s workflow.';

create index workflow_post_entities_entity_idx
  on public.workflow_post_entities (kind, entity_id);

alter table public.workflow_post_entities enable row level security;

-- Visible exactly when the post is, derived rather than restated — the same
-- shape as workflow_post_mentions.
create policy workflow_post_entities_select on public.workflow_post_entities
  for select to authenticated
  using (exists (select 1 from public.workflow_posts p where p.id = workflow_post_entities.post_id));

create policy workflow_post_entities_insert on public.workflow_post_entities
  for insert to authenticated
  with check (exists (
    select 1 from public.workflow_posts p
     where p.id = workflow_post_entities.post_id
       and p.author_staff_id = public.current_staff_id()));

-- Supabase hands a new table to authenticated in full; narrowed to what the
-- policies justify. A post is append-only and so is what it names.
revoke all on public.workflow_post_entities from public, anon, authenticated;
grant select, insert on public.workflow_post_entities to authenticated;

-- ---- the plain text of a document ----------------------------------------

-- A chip reads as #Label, inline, the way a mention reads as @Label. NO
-- newline: an entity is a word in a sentence, not a block, and emitting a
-- boundary would break the line it sits in.
create or replace function public.activity_doc_text(doc jsonb) returns text
language sql immutable strict set search_path = '' as $$
  select btrim(regexp_replace(coalesce(string_agg(
    case n->>'type'
      when 'text'       then n->>'text'
      when 'mention'    then '@' || coalesce(n->'attrs'->>'label', '')
      when 'entity'     then '#' || coalesce(n->'attrs'->>'label', '')
      when 'image'      then E'\n' || coalesce(nullif(btrim(n->'attrs'->>'alt'), ''),
                                               nullif(btrim(n->'attrs'->>'name'), ''),
                                               'Image')
      when 'attachment' then E'\n' || coalesce(nullif(btrim(n->'attrs'->>'name'), ''), 'File')
      else E'\n'
    end, '' order by ord), ''), E'\n{2,}', E'\n', 'g'), E' \t\r\n')
  from jsonb_path_query(doc, 'strict $.**') with ordinality as t(n, ord)
  where jsonb_typeof(n) = 'object'
    and n->>'type' in ('text','mention','entity','paragraph','listItem','hardBreak',
                       'heading','blockquote','codeBlock','horizontalRule',
                       'image','attachment','callout');
$$;
comment on function public.activity_doc_text(jsonb) is
  'The plain text of a post document: text nodes in order, mentions as @Label, entity chips as #Label, an image as its alt text or filename, an attachment as its filename, blocks (paragraph, listItem, hardBreak, heading, blockquote, codeBlock, horizontalRule, callout) separated by newlines, trimmed of all whitespace including newlines. Mentions and chips are INLINE and emit no boundary; images and attachments emit a newline BEFORE their words so they do not run into the paragraph above.';

-- ---- the write path -------------------------------------------------------

create or replace function public.post_workflow_activity(
  p_workflow_id uuid,
  p_task_id     uuid,
  p_body        jsonb
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

  -- A chip's kind is one of three, its id is an id, and its label says
  -- something — the label is what the post's plain text carries, so a blank one
  -- would make the chip invisible to search.
  perform 1
    from jsonb_path_query(p_body, 'strict $.** ? (@.type == "entity")') as t(n)
   where coalesce(n->'attrs'->>'kind', '') not in ('client', 'group', 'workflow')
      or coalesce(n->'attrs'->>'id', '')
           !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      or coalesce(btrim(n->'attrs'->>'label'), '') = '';
  if found then
    raise exception 'A chip must name a client, group or workflow, by id, with a label';
  end if;

  -- Media is named by id. An address on one is not scrubbed, it is grounds to
  -- refuse the post.
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

  -- Width is a picture's business. TWO STATEMENTS, NOT ONE OR: Postgres does
  -- not promise to short-circuit OR, so a combined test is free to run the
  -- cast on "wide" and fail with a type error instead of the sentence below.
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

  insert into public.workflow_posts (workflow_id, task_id, author_staff_id, body)
  values (p_workflow_id, p_task_id, public.current_staff_id(), p_body)
  returning id into v_id;

  for v_mention in
    select distinct (n->'attrs'->>'id')::uuid
      from jsonb_path_query(p_body, 'strict $.** ? (@.type == "mention")') as t(n)
     where n->'attrs'->>'id' is not null
  loop
    -- staff_directory rather than staff_users: it is the view every active
    -- staff member can read, and a mention of someone who has since left must
    -- still resolve.
    if not exists (select 1 from public.staff_directory d where d.id = v_mention) then
      raise exception 'Mentioned person is not a staff member';
    end if;
    insert into public.workflow_post_mentions (post_id, staff_id) values (v_id, v_mention);
  end loop;

  -- The chips. The group is read from the workflow rather than trusted from
  -- the caller, and every chip must belong to it — see THE RULE THAT MATTERS
  -- at the top of this file. Note what is NOT checked: whether the AUTHOR can
  -- see the thing. Being able to see the workflow is what grants the right to
  -- name its group's members, and an author who can post here can already read
  -- all of them.
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

  -- Claim the bytes. The WHERE clause is the whole security argument: your own
  -- upload, on this workflow, not already posted, and the kind the node claims
  -- it is.
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

comment on function public.post_workflow_activity(uuid, uuid, jsonb) is
  'Post to a workflow''s timeline, optionally about one of its tasks (p_task_id null for the workflow itself). p_body is a document. Nodes: doc, paragraph, text, hardBreak, mention (attrs.id = staff id, attrs.label), entity (attrs.kind client/group/workflow, attrs.id, attrs.label — must belong to the workflow''s own client group), bulletList, orderedList, listItem, heading (attrs.level 1-3), blockquote, codeBlock, horizontalRule, callout (attrs.tone info/warning/success), image and attachment (attrs.id = a workflow_post_media id you uploaded on this workflow and have not posted before, whose kind must match the node; attrs.name = filename; image also takes attrs.alt and attrs.width 40-2000; an address attribute of any kind is refused). Marks: bold, italic, strike, code, underline, link (attrs.href, http(s) only). Anything else is refused. The author is the caller; mentions go to workflow_post_mentions, chips to workflow_post_entities, media is claimed in workflow_post_media.';

comment on table public.workflow_posts is
  'A post on a workflow''s timeline, optionally about one of its tasks. Append-only: no application role may update or delete. body is a structured document (nodes doc, paragraph, text, hardBreak, mention, entity, bulletList, orderedList, listItem, heading (level 1-3), blockquote, codeBlock, horizontalRule, callout, image, attachment; marks bold, italic, strike, code, underline, link) validated by post_workflow_activity(). body_text is the derived plain text. Images and attachments name a workflow_post_media row by id and never by address; chips name things in the workflow''s own client group.';

-- ---- what the feed reads --------------------------------------------------

-- Gains `entities`, with each label resolved to what the thing is called TODAY
-- and NULL when the reader cannot see it. The renderer draws a neutral word in
-- that case rather than the label the document carries: a chip is the one place
-- where falling back to the stored text would be a disclosure, because unlike a
-- staff mention — staff_directory is readable by every active staff member — a
-- client is group-scoped. In practice the null case is nearly unreachable,
-- since a chip can only name things in the group the reader already sees; it is
-- handled because "nearly unreachable" is not "unreachable".
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
                          'id', f.id,
                          'kind', f.kind,
                          'name', f.original_name,
                          'mime_type', f.mime_type,
                          'byte_size', f.byte_size,
                          'width', f.width,
                          'height', f.height,
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
                  where e.post_id = p.id), '[]'::jsonb) as entities
  from public.workflow_posts p
  left join public.staff_directory sd on sd.id = p.author_staff_id;
comment on view public.workflow_posts_summary is
  'Posts with the author named, mentions resolved to current names, reactions grouped by kind with who gave each, the media each post carries, and the entities it names with each label resolved to the thing''s current name — null where the reader cannot see it, which the renderer draws as a neutral word rather than echoing the document. security_invoker: RLS on workflow_posts, and through it on workflows, decides.';
revoke all on public.workflow_posts_summary from public, anon, authenticated;
grant select on public.workflow_posts_summary to authenticated;
