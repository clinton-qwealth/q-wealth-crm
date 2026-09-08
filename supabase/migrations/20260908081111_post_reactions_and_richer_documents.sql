-- Two things the activity feed grew on 8 September, in one migration because
-- both change what a post may hold.
--
-- 1. Richer documents. The composer's editor ships with headings, block quotes,
--    code blocks, horizontal rules and underline, and all five were switched
--    off because the whitelist here did not allow them. It now does. The list
--    is still closed — a table, an image, an iframe, a heading deeper than
--    three are refused exactly as before — and it is still the one place the
--    list is enforced; the editor is merely configured to match it.
--
-- 2. Reactions. A fixed set of six, one row per person per post per reaction,
--    stored as a short KEY rather than the character: "heart" cannot arrive
--    with and without a variation selector and become two rows, and the key is
--    what an accessible label is built from. Unlike a post, a reaction can be
--    taken back — a reaction is a state you toggle, not a statement you made —
--    so this is the one table under the feed with a DELETE grant, and the
--    policy limits it to your own rows.

-- ---- 1. Richer documents -------------------------------------------------

-- The block set gains the four new block nodes, so a heading or a quote ends a
-- line in the plain text the way a paragraph does. Existing rows keep their
-- stored body_text — Postgres does not recompute a generated column when the
-- function behind it changes — and that is correct: no stored document
-- contains a node this did not already know.
create or replace function public.activity_doc_text(doc jsonb) returns text
language sql immutable strict set search_path = '' as $$
  select btrim(regexp_replace(coalesce(string_agg(
    case n->>'type'
      when 'text'    then n->>'text'
      when 'mention' then '@' || coalesce(n->'attrs'->>'label', '')
      else E'\n'
    end, '' order by ord), ''), E'\n{2,}', E'\n', 'g'), E' \t\r\n')
  from jsonb_path_query(doc, 'strict $.**') with ordinality as t(n, ord)
  where jsonb_typeof(n) = 'object'
    and n->>'type' in ('text','mention','paragraph','listItem','hardBreak',
                       'heading','blockquote','codeBlock','horizontalRule');
$$;
comment on function public.activity_doc_text(jsonb) is
  'The plain text of a post document: text nodes in order, mentions as @Label, blocks (paragraph, listItem, hardBreak, heading, blockquote, codeBlock, horizontalRule) separated by newlines, trimmed of all whitespace including newlines. btrim() alone strips spaces only — an empty paragraph came through as a bare newline until the trim set was widened.';

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
  -- image, an iframe: refused here, so no client can store what the screen
  -- cannot show — and the screen never has to fall back to raw markup.
  select n->>'type' into v_bad
    from jsonb_path_query(p_body, 'strict $.**') as t(n)
   where jsonb_typeof(n) = 'object' and n ? 'type'
     and n->>'type' not in ('doc','paragraph','text','hardBreak','mention',
                            'bulletList','orderedList','listItem',
                            'heading','blockquote','codeBlock','horizontalRule',
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

  return v_id;
end $fn$;

comment on function public.post_workflow_activity(uuid, uuid, jsonb) is
  'Post to a workflow''s timeline, optionally about one of its tasks (p_task_id null for the workflow itself). p_body is a document: {"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"..."}]}]}. Nodes: doc, paragraph, text, hardBreak, mention (attrs.id = staff id, attrs.label), bulletList, orderedList, listItem, heading (attrs.level 1-3), blockquote, codeBlock, horizontalRule. Marks: bold, italic, strike, code, underline, link (attrs.href, http(s) only). Anything else is refused. The author is the caller; mentions are recorded in workflow_post_mentions.';

comment on table public.workflow_posts is
  'A post on a workflow''s timeline, optionally about one of its tasks. Append-only: no application role may update or delete. body is a structured document (type "doc"; nodes doc, paragraph, text, hardBreak, mention, bulletList, orderedList, listItem, heading (level 1-3), blockquote, codeBlock, horizontalRule; marks bold, italic, strike, code, underline, link) validated by post_workflow_activity(). body_text is the derived plain text.';

-- ---- 2. Reactions ---------------------------------------------------------

create table public.workflow_post_reactions (
  post_id    uuid not null references public.workflow_posts(id) on delete cascade,
  staff_id   uuid not null references public.staff_users(id),
  reaction   text not null,
  created_at timestamptz not null default now(),
  -- One row per person per reaction per post: the key IS the rule.
  primary key (post_id, staff_id, reaction),
  -- A closed set. Validating arbitrary Unicode in the database and rendering
  -- whatever anyone sends is the problem the post body was built to avoid.
  constraint workflow_post_reactions_reaction_allowed
    check (reaction in ('thumbs_up', 'tick', 'eyes', 'party', 'heart', 'thanks'))
);
comment on table public.workflow_post_reactions is
  'A staff member''s reaction to a post, one row per person per reaction. reaction is a key from a closed set (thumbs_up, tick, eyes, party, heart, thanks); the client maps it to a glyph and a label. Toggled by toggle_post_reaction(); a person may delete only their own rows.';

alter table public.workflow_post_reactions enable row level security;

-- Visible when the post is — which is when its workflow is.
create policy workflow_post_reactions_select on public.workflow_post_reactions
  for select to authenticated
  using (exists (select 1 from public.workflow_posts p where p.id = workflow_post_reactions.post_id));

-- Only as yourself, only on a post you can see.
create policy workflow_post_reactions_insert on public.workflow_post_reactions
  for insert to authenticated
  with check (
    public.is_active_staff()
    and staff_id = public.current_staff_id()
    and exists (select 1 from public.workflow_posts p where p.id = workflow_post_reactions.post_id)
  );

-- The one delete under the feed. Your own reaction, and nobody else's.
create policy workflow_post_reactions_delete on public.workflow_post_reactions
  for delete to authenticated
  using (staff_id = public.current_staff_id());

-- Supabase's defaults hand the table to authenticated in full; what the
-- policies justify is read, insert and delete. No update — a reaction is
-- added or taken away, never edited.
revoke all on public.workflow_post_reactions from public, anon, authenticated;
grant select, insert, delete on public.workflow_post_reactions to authenticated;

-- The toggle. Returns whether the reaction is now ON for the caller, so the
-- client can confirm its optimistic guess rather than infer it.
create or replace function public.toggle_post_reaction(
  p_post_id  uuid,
  p_reaction text
) returns boolean
language plpgsql
security invoker
set search_path = ''
as $fn$
declare
  v_me uuid := public.current_staff_id();
begin
  if v_me is null then
    raise exception 'Not an active staff member';
  end if;
  if p_reaction is null or p_reaction not in ('thumbs_up', 'tick', 'eyes', 'party', 'heart', 'thanks') then
    raise exception 'Not a reaction this feed offers';
  end if;
  -- RLS on workflow_posts decides what "exists" means here.
  if not exists (select 1 from public.workflow_posts p where p.id = p_post_id) then
    raise exception 'No such post, or not within your access';
  end if;

  delete from public.workflow_post_reactions
   where post_id = p_post_id and staff_id = v_me and reaction = p_reaction;
  if found then
    return false;
  end if;

  insert into public.workflow_post_reactions (post_id, staff_id, reaction)
  values (p_post_id, v_me, p_reaction);
  return true;
end $fn$;
comment on function public.toggle_post_reaction(uuid, text) is
  'Add the caller''s reaction to a post, or remove it if already there. p_reaction is one of thumbs_up, tick, eyes, party, heart, thanks. Returns true when the reaction is now on, false when it has been taken away.';

-- Load-bearing, never boilerplate: Postgres grants EXECUTE on every new
-- function to PUBLIC, and every role inherits from PUBLIC.
revoke all on function public.toggle_post_reaction(uuid, text) from public, anon;
grant execute on function public.toggle_post_reaction(uuid, text) to authenticated;

-- The feed's view gains the reactions, grouped by kind in the order each kind
-- first appeared, each naming who — resolved to CURRENT names, as mentions
-- are. Adding a column at the end is what `create or replace view` permits, so
-- the existing columns stay exactly as they were.
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
                          group by x.reaction) r), '[]'::jsonb) as reactions
  from public.workflow_posts p
  left join public.staff_directory sd on sd.id = p.author_staff_id;
comment on view public.workflow_posts_summary is
  'Posts with the author named, mentions resolved to current names, and reactions grouped by kind with who gave each. security_invoker: RLS on workflow_posts, and through it on workflows, decides.';
-- The view's grants survive a replace; restated so the intent is in this file too.
revoke all on public.workflow_posts_summary from public, anon, authenticated;
grant select on public.workflow_posts_summary to authenticated;
