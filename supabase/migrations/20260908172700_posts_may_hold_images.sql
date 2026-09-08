-- A post may hold a picture.
--
-- The third time the document whitelist has grown, and the first time it has
-- grown to admit something that is not typed. An `image` node carries an ID
-- from workflow_post_media AND NOTHING THAT LOOKS LIKE AN ADDRESS: a `src`
-- would let a client point a post at any host on the internet, which is
-- precisely the class of thing the closed node list exists to prevent. The app
-- resolves the id through a route that re-checks access and hands out a
-- short-lived signed URL.
--
-- Three checks below matter more than they look:
--
--   * `src`, `href` and `srcset` are refused OUTRIGHT on an image node, not
--     sanitised. There is no legitimate reason for one to be present, so its
--     presence means the document came from somewhere that does not understand
--     the rules, and the right answer is to refuse the whole post.
--   * the id must name a row on THIS workflow, uploaded by THIS caller, NOT
--     YET POSTED. One condition, three attacks closed: embedding a colleague's
--     upload, reaching into another workflow's bytes, and re-using an id that
--     is already on someone's post.
--   * activity_doc_text() must say something for an image, because an
--     image-only post has no words and workflow_posts_body_not_blank is a
--     TABLE CHECK CONSTRAINT on the generated column — the write path cannot
--     route around it. Emitting the alt text or the filename also makes "the
--     post with the balance screenshot in it" findable, which is the reason to
--     prefer them over a literal placeholder.

-- ---- the plain text of a document ----------------------------------------

-- An image contributes a block boundary AND its words, in that order. Without
-- the leading newline the alt text runs straight into the paragraph above it —
-- "we saw thisscreenshot.png" — because an image node emits text rather than
-- the newline every other block emits.
--
-- Replacing this function under a generated column is settled ground: the
-- 8 September migration did it and noted that Postgres does not recompute
-- stored rows when the function behind them changes. That is still correct, and
-- for the same reason: no stored document contains an image.
create or replace function public.activity_doc_text(doc jsonb) returns text
language sql immutable strict set search_path = '' as $$
  select btrim(regexp_replace(coalesce(string_agg(
    case n->>'type'
      when 'text'    then n->>'text'
      when 'mention' then '@' || coalesce(n->'attrs'->>'label', '')
      when 'image'   then E'\n' || coalesce(nullif(btrim(n->'attrs'->>'alt'), ''),
                                            nullif(btrim(n->'attrs'->>'name'), ''),
                                            'Image')
      else E'\n'
    end, '' order by ord), ''), E'\n{2,}', E'\n', 'g'), E' \t\r\n')
  from jsonb_path_query(doc, 'strict $.**') with ordinality as t(n, ord)
  where jsonb_typeof(n) = 'object'
    and n->>'type' in ('text','mention','paragraph','listItem','hardBreak',
                       'heading','blockquote','codeBlock','horizontalRule','image');
$$;
comment on function public.activity_doc_text(jsonb) is
  'The plain text of a post document: text nodes in order, mentions as @Label, an image as its alt text or filename, blocks (paragraph, listItem, hardBreak, heading, blockquote, codeBlock, horizontalRule) separated by newlines, trimmed of all whitespace including newlines. An image emits a newline BEFORE its words so its alt text does not run into the paragraph above. btrim() alone strips spaces only — an empty paragraph came through as a bare newline until the trim set was widened.';

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
  v_mention uuid;
  v_media   uuid;
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
                            'image',
                            'bold','italic','strike','code','link','underline')
   limit 1;
  if v_bad is not null then
    raise exception 'A post may not contain "%"', v_bad;
  end if;

  -- A heading in a post is one of three sizes. Level 1 does not mean the
  -- page's title — the renderer draws it under the panel's own headings — but
  -- six sizes in a comment is five too many, and the editor offers three.
  select n->'attrs'->>'level' into v_level
    from jsonb_path_query(p_body, 'strict $.** ? (@.type == "heading")') as t(n)
   where coalesce(n->'attrs'->>'level', '') !~ '^[123]$'
   limit 1;
  if found then
    raise exception 'A heading must be level 1, 2 or 3';
  end if;

  -- A link is a web link. javascript: and data: schemes never reach a page.
  select n->'attrs'->>'href' into v_href
    from jsonb_path_query(p_body, 'strict $.** ? (@.type == "link")') as t(n)
   where coalesce(n->'attrs'->>'href', '') !~* '^https?://'
   limit 1;
  if found then
    raise exception 'A link must start with http:// or https://';
  end if;

  -- An image is named by id. An address on it is not scrubbed, it is grounds
  -- to refuse the post: nothing in this system produces one, so a document
  -- carrying one came from something that does not know the rules.
  perform 1
    from jsonb_path_query(p_body, 'strict $.** ? (@.type == "image")') as t(n)
   where n->'attrs' ?| array['src', 'srcset', 'href', 'url'];
  if found then
    raise exception 'An image in a post is named by id, never by address';
  end if;

  -- The id must be one, and the name must say something — activity_doc_text()
  -- falls back to the filename, and an image-only post whose text came out
  -- blank would be refused by the table's own constraint with a far worse
  -- message than this one.
  perform 1
    from jsonb_path_query(p_body, 'strict $.** ? (@.type == "image")') as t(n)
   where coalesce(n->'attrs'->>'id', '')
           !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      or coalesce(btrim(n->'attrs'->>'name'), '') = '';
  if found then
    raise exception 'An image must name an upload and carry its filename';
  end if;

  -- The width the writer dragged it to, in pixels, within what the composer
  -- can actually produce. Null means "as wide as it comes".
  --
  -- TWO STATEMENTS, NOT ONE OR. Postgres does not promise to short-circuit
  -- OR, so `width !~ '^[0-9]+$' or width::int not between ...` is free to
  -- evaluate the cast on "abc" and fail with a type error instead of the
  -- sentence below. Sequential statements do guarantee the order, so by the
  -- time the range is checked the value is known to be a number.
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

  -- Claim the bytes. One UPDATE per image, and the WHERE clause is the whole
  -- security argument: your own upload, on this workflow, not already posted.
  -- The row's own trigger checks the transition again from the other side.
  for v_media in
    select distinct (n->'attrs'->>'id')::uuid
      from jsonb_path_query(p_body, 'strict $.** ? (@.type == "image")') as t(n)
  loop
    update public.workflow_post_media m
       set post_id = v_id
     where m.id = v_media
       and m.workflow_id = p_workflow_id
       and m.uploaded_by = public.current_staff_id()
       and m.kind = 'image'
       and m.post_id is null
       and m.redacted_at is null;
    if not found then
      raise exception 'That image is not yours to post, or has already been posted';
    end if;
  end loop;

  return v_id;
end $fn$;

comment on function public.post_workflow_activity(uuid, uuid, jsonb) is
  'Post to a workflow''s timeline, optionally about one of its tasks (p_task_id null for the workflow itself). p_body is a document: {"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"..."}]}]}. Nodes: doc, paragraph, text, hardBreak, mention (attrs.id = staff id, attrs.label), bulletList, orderedList, listItem, heading (attrs.level 1-3), blockquote, codeBlock, horizontalRule, image (attrs.id = a workflow_post_media id you uploaded on this workflow and have not posted before, attrs.name = filename, attrs.alt optional, attrs.width optional 40-2000; an address attribute of any kind is refused). Marks: bold, italic, strike, code, underline, link (attrs.href, http(s) only). Anything else is refused. The author is the caller; mentions are recorded in workflow_post_mentions and images are claimed in workflow_post_media.';

comment on table public.workflow_posts is
  'A post on a workflow''s timeline, optionally about one of its tasks. Append-only: no application role may update or delete. body is a structured document (type "doc"; nodes doc, paragraph, text, hardBreak, mention, bulletList, orderedList, listItem, heading (level 1-3), blockquote, codeBlock, horizontalRule, image; marks bold, italic, strike, code, underline, link) validated by post_workflow_activity(). body_text is the derived plain text. An image names a workflow_post_media row by id and never by address.';

-- ---- what the feed reads --------------------------------------------------

-- Gains `media`: everything the renderer needs to draw a picture without a
-- round trip per image — the dimensions so the feed does not jump as they
-- load, and the redaction so a removed image is drawn as a sentence rather
-- than a broken image icon and a pointless request. Appending at the end is
-- what `create or replace view` permits, so every existing column is
-- untouched — the same move the reactions column made.
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
                  where f.post_id = p.id), '[]'::jsonb) as media
  from public.workflow_posts p
  left join public.staff_directory sd on sd.id = p.author_staff_id;
comment on view public.workflow_posts_summary is
  'Posts with the author named, mentions resolved to current names, reactions grouped by kind with who gave each, and the media each post carries — dimensions to reserve the space, and the redaction so a removed image is drawn as a sentence instead of a request that would fail. security_invoker: RLS on workflow_posts, and through it on workflows, decides.';
-- The view's grants survive a replace; restated so the intent is in this file too.
revoke all on public.workflow_posts_summary from public, anon, authenticated;
grant select on public.workflow_posts_summary to authenticated;
