-- The activity feed: what a person WRITES on a workflow's timeline.
--
-- A post always belongs to a workflow and may also be about one of its tasks.
-- That is the whole shape: the task panel's feed is the posts where task_id is
-- this task; the workflow's timeline (to come) is every post on the workflow,
-- with or without a task. One table, one write path, two views of it.
--
-- workflow_id is stored on every post even though a task already knows its
-- workflow. That is deliberate denormalisation, and the composite foreign key
-- below is what stops it drifting: a post that names a task can only name a
-- task on the workflow it also names. RLS defers to the workflow's policies
-- through that column, exactly as workflow_tasks does.
--
-- Posts are append-only. There is no UPDATE or DELETE grant for any application
-- role and no policy for either, so no client can change what was said. The
-- same stance as notes: a correction is a new post.

-- The key the composite foreign key needs. Trivially satisfied — id alone is
-- the primary key — so this changes no data; it only lets a child name both.
alter table public.workflow_tasks
  add constraint workflow_tasks_id_workflow_id_key unique (id, workflow_id);

-- The plain text of a post: every text node in document order, mentions as
-- @Label, block boundaries as newlines. For previews, for search later, and
-- for the connector, which should never have to walk a document to read one.
-- IMMUTABLE because it is, and because a generated column needs it to be.
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
    and n->>'type' in ('text','mention','paragraph','listItem','hardBreak');
$$;
comment on function public.activity_doc_text(jsonb) is
  'The plain text of a post document: text nodes in order, mentions as @Label, blocks separated by newlines, trimmed of all whitespace including newlines. btrim() alone strips spaces only — an empty paragraph came through as a bare newline until the trim set was widened.';

create table public.workflow_posts (
  id              uuid primary key default gen_random_uuid(),
  workflow_id     uuid not null references public.workflows(id) on delete cascade,
  task_id         uuid,
  author_staff_id uuid not null references public.staff_users(id),
  -- A structured document, never HTML. The allowed node and mark types are
  -- enforced by post_workflow_activity(), so every stored document is one the
  -- renderer knows how to draw, and nothing that reaches the screen is ever
  -- interpreted as markup.
  body            jsonb not null,
  body_text       text generated always as (public.activity_doc_text(body)) stored,
  created_at      timestamptz not null default now(),
  constraint workflow_posts_task_on_same_workflow
    foreign key (task_id, workflow_id) references public.workflow_tasks(id, workflow_id) on delete cascade,
  constraint workflow_posts_body_is_doc
    check (jsonb_typeof(body) = 'object' and body->>'type' = 'doc'),
  constraint workflow_posts_body_not_blank
    check (btrim(public.activity_doc_text(body)) <> '')
);
comment on table public.workflow_posts is
  'A post on a workflow''s timeline, optionally about one of its tasks. Append-only: no application role may update or delete. body is a structured document (type "doc"; nodes doc, paragraph, text, hardBreak, mention, bulletList, orderedList, listItem; marks bold, italic, strike, code, link) validated by post_workflow_activity(). body_text is the derived plain text.';
comment on column public.workflow_posts.task_id is
  'Null for a post on the workflow as a whole. When set, the composite foreign key guarantees the task belongs to workflow_id.';
comment on column public.workflow_posts.workflow_id is
  'Always set, even when task_id is: the timeline reads by workflow, and RLS defers to the workflow''s policies through this column.';

create index workflow_posts_workflow_created_idx
  on public.workflow_posts (workflow_id, created_at desc, id desc);
create index workflow_posts_task_created_idx
  on public.workflow_posts (task_id, created_at desc, id desc) where task_id is not null;

-- Who a post names, as rows. "Posts that mention me" is then a query on a
-- column rather than a scan through JSON, and it is where a notification will
-- one day come from.
create table public.workflow_post_mentions (
  post_id  uuid not null references public.workflow_posts(id) on delete cascade,
  staff_id uuid not null references public.staff_users(id),
  primary key (post_id, staff_id)
);
comment on table public.workflow_post_mentions is
  'The staff members a post mentions, extracted from its document by post_workflow_activity(). Normalised so "posts mentioning me" is a lookup, not a JSON scan.';
create index workflow_post_mentions_staff_idx on public.workflow_post_mentions (staff_id);

-- Visibility is the workflow's visibility, derived rather than restated.
alter table public.workflow_posts enable row level security;
alter table public.workflow_post_mentions enable row level security;

create policy workflow_posts_select on public.workflow_posts
  for select to authenticated
  using (exists (select 1 from public.workflows w where w.id = workflow_posts.workflow_id));

create policy workflow_posts_insert on public.workflow_posts
  for insert to authenticated
  with check (
    public.is_active_staff()
    and exists (select 1 from public.workflows w where w.id = workflow_posts.workflow_id)
    and author_staff_id = public.current_staff_id()
  );

create policy workflow_post_mentions_select on public.workflow_post_mentions
  for select to authenticated
  using (exists (select 1 from public.workflow_posts p where p.id = workflow_post_mentions.post_id));

create policy workflow_post_mentions_insert on public.workflow_post_mentions
  for insert to authenticated
  with check (exists (
    select 1 from public.workflow_posts p
     where p.id = workflow_post_mentions.post_id
       and p.author_staff_id = public.current_staff_id()));

-- Supabase's default privileges hand every new table to authenticated in full.
-- Tightened here, in the migration that creates them, to what the policies
-- justify: read, and insert. Nothing may update or delete a post.
revoke all on public.workflow_posts from public, anon, authenticated;
revoke all on public.workflow_post_mentions from public, anon, authenticated;
grant select, insert on public.workflow_posts to authenticated;
grant select, insert on public.workflow_post_mentions to authenticated;

-- What the feed reads: the post with its author named and the people it
-- mentions resolved to their CURRENT names — the document keeps the label as
-- typed, the view says who that is today.
create view public.workflow_posts_summary with (security_invoker = true) as
select p.id, p.workflow_id, p.task_id, p.author_staff_id,
       sd.full_name as author_name,
       p.body, p.body_text, p.created_at,
       coalesce((select jsonb_agg(jsonb_build_object('staff_id', m.staff_id, 'full_name', d.full_name) order by d.full_name)
                   from public.workflow_post_mentions m
                   join public.staff_directory d on d.id = m.staff_id
                  where m.post_id = p.id), '[]'::jsonb) as mentioned
  from public.workflow_posts p
  left join public.staff_directory sd on sd.id = p.author_staff_id;
comment on view public.workflow_posts_summary is
  'Posts with the author named and mentions resolved to current names. security_invoker: RLS on workflow_posts, and through it on workflows, decides.';
revoke all on public.workflow_posts_summary from public, anon, authenticated;
grant select on public.workflow_posts_summary to authenticated;

-- The one write path. Validates the document so nothing the renderer cannot
-- draw is ever stored, stamps the author from the session rather than the
-- caller, and records the mentions.
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

  -- Every node and mark type must be one the renderer knows. A heading, a
  -- table, an image: refused here, so no client can store what the screen
  -- cannot show — and the screen never has to fall back to raw markup.
  select n->>'type' into v_bad
    from jsonb_path_query(p_body, 'strict $.**') as t(n)
   where jsonb_typeof(n) = 'object' and n ? 'type'
     and n->>'type' not in ('doc','paragraph','text','hardBreak','mention',
                            'bulletList','orderedList','listItem',
                            'bold','italic','strike','code','link')
   limit 1;
  if v_bad is not null then
    raise exception 'A post may not contain "%"', v_bad;
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
  'Post to a workflow''s timeline, optionally about one of its tasks (p_task_id null for the workflow itself). p_body is a document: {"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"..."}]}]}. Nodes: doc, paragraph, text, hardBreak, mention (attrs.id = staff id, attrs.label), bulletList, orderedList, listItem. Marks: bold, italic, strike, code, link (attrs.href, http(s) only). Anything else is refused. The author is the caller; mentions are recorded in workflow_post_mentions.';

-- Load-bearing, never boilerplate: Postgres grants EXECUTE on every new
-- function to PUBLIC, and every role inherits from PUBLIC.
revoke all on function public.post_workflow_activity(uuid, uuid, jsonb) from public, anon;
grant execute on function public.post_workflow_activity(uuid, uuid, jsonb) to authenticated;
revoke all on function public.activity_doc_text(jsonb) from public, anon;
grant execute on function public.activity_doc_text(jsonb) to authenticated;
