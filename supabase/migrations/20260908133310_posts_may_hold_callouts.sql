-- A post may hold a callout: a tinted block for the thing that must not be
-- skimmed past.
--
-- The cheapest element the feed has gained. No bytes, no new table, no
-- dependency — a block node with one attribute whose value comes from a closed
-- set of three, validated the way a heading's level is.
--
-- THREE TONES, NOT A COLOUR. `tone` is 'info', 'warning' or 'success', and the
-- client maps each to a tint; the document never carries a colour. The same
-- reasoning as the reaction keys: a colour in the document would be a decision
-- the writer's browser made, unchangeable afterwards and impossible to restyle,
-- and it would let a post pick any colour at all — including one that imitates
-- the application's own warnings about sensitive data.
--
-- Content is `block+`: a callout holds paragraphs and lists, so "what you need
-- to know before the review" can be more than one sentence. It cannot hold
-- another callout — the editor's schema forbids nesting — but the database
-- deliberately does NOT check that. A nested callout would render as a tinted
-- box inside a tinted box, which is ugly rather than dangerous, and the
-- whitelist exists to stop what the screen cannot draw, not what it draws
-- badly.

-- ---- the plain text of a document ----------------------------------------

-- A callout is a block boundary and nothing more: its words are its children's
-- words, which the walk already collects. Adding it to the list below is what
-- makes it end a line, so "Note: check the TFN" does not run into the
-- paragraph after it.
create or replace function public.activity_doc_text(doc jsonb) returns text
language sql immutable strict set search_path = '' as $$
  select btrim(regexp_replace(coalesce(string_agg(
    case n->>'type'
      when 'text'       then n->>'text'
      when 'mention'    then '@' || coalesce(n->'attrs'->>'label', '')
      when 'image'      then E'\n' || coalesce(nullif(btrim(n->'attrs'->>'alt'), ''),
                                               nullif(btrim(n->'attrs'->>'name'), ''),
                                               'Image')
      when 'attachment' then E'\n' || coalesce(nullif(btrim(n->'attrs'->>'name'), ''), 'File')
      else E'\n'
    end, '' order by ord), ''), E'\n{2,}', E'\n', 'g'), E' \t\r\n')
  from jsonb_path_query(doc, 'strict $.**') with ordinality as t(n, ord)
  where jsonb_typeof(n) = 'object'
    and n->>'type' in ('text','mention','paragraph','listItem','hardBreak',
                       'heading','blockquote','codeBlock','horizontalRule',
                       'image','attachment','callout');
$$;
comment on function public.activity_doc_text(jsonb) is
  'The plain text of a post document: text nodes in order, mentions as @Label, an image as its alt text or filename, an attachment as its filename, blocks (paragraph, listItem, hardBreak, heading, blockquote, codeBlock, horizontalRule, callout) separated by newlines, trimmed of all whitespace including newlines. Images and attachments emit a newline BEFORE their words so they do not run into the paragraph above. btrim() alone strips spaces only — an empty paragraph came through as a bare newline until the trim set was widened.';

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
  v_id      uuid;
  v_bad     text;
  v_href    text;
  v_level   text;
  v_tone    text;
  v_mention uuid;
  v_media   uuid;
  v_kind    text;
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

  -- Every node and mark type must be one the renderer knows. A table, an
  -- iframe: refused here, so no client can store what the screen cannot show —
  -- and the screen never has to fall back to raw markup.
  select n->>'type' into v_bad
    from jsonb_path_query(p_body, 'strict $.**') as t(n)
   where jsonb_typeof(n) = 'object' and n ? 'type'
     and n->>'type' not in ('doc','paragraph','text','hardBreak','mention',
                            'bulletList','orderedList','listItem',
                            'heading','blockquote','codeBlock','horizontalRule',
                            'image','attachment','callout',
                            'bold','italic','strike','code','link','underline')
   limit 1;
  if v_bad is not null then
    raise exception 'A post may not contain "%"', v_bad;
  end if;

  -- A heading in a post is one of three sizes.
  select n->'attrs'->>'level' into v_level
    from jsonb_path_query(p_body, 'strict $.** ? (@.type == "heading")') as t(n)
   where coalesce(n->'attrs'->>'level', '') !~ '^[123]$'
   limit 1;
  if found then
    raise exception 'A heading must be level 1, 2 or 3';
  end if;

  -- A callout's tone is one of three. Held here for the same reason the
  -- heading level is: the client maps the key to a tint, so an unknown key
  -- would be a block the renderer draws untinted, saying nothing.
  select n->'attrs'->>'tone' into v_tone
    from jsonb_path_query(p_body, 'strict $.** ? (@.type == "callout")') as t(n)
   where coalesce(n->'attrs'->>'tone', '') not in ('info', 'warning', 'success')
   limit 1;
  if found then
    raise exception 'A callout must be info, warning or success';
  end if;

  -- A link is a web link. javascript: and data: schemes never reach a page.
  select n->'attrs'->>'href' into v_href
    from jsonb_path_query(p_body, 'strict $.** ? (@.type == "link")') as t(n)
   where coalesce(n->'attrs'->>'href', '') !~* '^https?://'
   limit 1;
  if found then
    raise exception 'A link must start with http:// or https://';
  end if;

  -- Media is named by id. An address on one is not scrubbed, it is grounds to
  -- refuse the post: nothing in this system produces one, so a document
  -- carrying one came from something that does not know the rules.
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

  -- The composite foreign key enforces this; this gives the caller a sentence
  -- rather than a constraint name, and does not say which half was wrong.
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
  'Post to a workflow''s timeline, optionally about one of its tasks (p_task_id null for the workflow itself). p_body is a document. Nodes: doc, paragraph, text, hardBreak, mention (attrs.id = staff id, attrs.label), bulletList, orderedList, listItem, heading (attrs.level 1-3), blockquote, codeBlock, horizontalRule, callout (attrs.tone info/warning/success, holding block content), image and attachment (attrs.id = a workflow_post_media id you uploaded on this workflow and have not posted before, whose kind must match the node — image for image, file for attachment; attrs.name = filename; image also takes attrs.alt and attrs.width 40-2000; an address attribute of any kind is refused on either). Marks: bold, italic, strike, code, underline, link (attrs.href, http(s) only). Anything else is refused. The author is the caller; mentions are recorded in workflow_post_mentions and media is claimed in workflow_post_media.';

comment on table public.workflow_posts is
  'A post on a workflow''s timeline, optionally about one of its tasks. Append-only: no application role may update or delete. body is a structured document (type "doc"; nodes doc, paragraph, text, hardBreak, mention, bulletList, orderedList, listItem, heading (level 1-3), blockquote, codeBlock, horizontalRule, callout (tone info/warning/success), image, attachment; marks bold, italic, strike, code, underline, link) validated by post_workflow_activity(). body_text is the derived plain text. Images and attachments name a workflow_post_media row by id and never by address.';
