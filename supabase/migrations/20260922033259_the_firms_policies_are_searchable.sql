-- The firm's policies are searchable in the CRM (22 Sep 2026)
--
-- Twenty-odd compliance policies and a handful of procedures live in the
-- OPERATIONS Confluence space. Until today an adviser left the CRM to read one
-- and could not search them from where they were working; /help said so on
-- screen ("Written procedures live in Confluence. This page is a stub") and the
-- ⌘K palette carried a dashed Knowledgebase section reading "Not built yet".
-- This migration is the database half of closing both: the pages arrive
-- through the ingest pattern, are promoted into a searchable copy, and are
-- retrieved by one function that fuses keyword and vector search.
--
--   n8n, as ingest_confluence  ->  kb-prepare (edge fn)   ->  ingest.confluence_pages  ->  ingest.promote('confluence')  ->  public.kb_documents / kb_chunks
--   walks the roots, fetches      ADF -> markdown, chunks,     one row per page VERSION,     retires what the last complete    what search_knowledge_base()
--   each changed page as ADF      embeds each chunk            chunks WITH their vectors    run did not see; explodes chunks   reads, as the caller
--
-- THE FEED CARRIES THE VECTORS, AND THAT IS LOAD-BEARING. The first sketch had
-- n8n write embeddings back into public.kb_chunks after promotion. It cannot:
-- the feed role holds NOTHING on public — that is the pattern, not a gap — and
-- a grant of update(embedding) would make ingest no longer the only door.
-- Embedding before promotion means no second pass, no write-back, no window in
-- which a chunk exists without its vector, and lets the column be NOT NULL,
-- which makes the worst silent failure (a chunk that is returned by keyword
-- and never by meaning) unrepresentable rather than merely monitored.
--
-- A jsonb array of numbers serialises to exactly pgvector's input syntax, so
-- promotion casts `((c->'embedding')::text)::extensions.vector(384)` and the
-- feed never has to know a vector type exists.
--
-- CHUNKING IS NOT DONE HERE. A regexp split on "\n## " was probed and works,
-- and it is still the wrong home: there is no SQL test harness, a fenced code
-- block's `##` is not a heading, and a table split mid-way needs its header
-- re-emitted. The chunker is `supabase/functions/_shared/chunk.ts`, run by
-- kb-prepare and by vitest against every real page. promote_confluence()
-- holds the CRM's rules — supersession, exclusion, retirement — not a parser.
--
-- THE TWO TABLES IN public ARE NOT AUDITED, as a decision: derived copies of a
-- system of record elsewhere, rebuilt by a feed, and record_audit() would
-- write two 384-float arrays into the trail for every chunk of every
-- re-promotion. The landing table keeps every version of every page, which
-- is the history an AFSL wants. The conversation tables at the end are not
-- audited either: append-only, own-record, and their content IS the record.
--
-- ACCESS IS is_active_staff(), NOT TERRITORY-SCOPED, on purpose. These are the
-- firm's own rules, not client data; every other table added this week is
-- scoped to a household's user groups and this one is deliberately not.
--
-- `set search_path to ''` BREAKS VECTOR EXPRESSIONS. Operators and types
-- resolve through the search path too, so `a <#> b` raises "operator does not
-- exist" and `::vector(384)` raises "type does not exist". Every vector
-- expression below is written `operator(extensions.<#>)`,
-- `::extensions.vector(384)`, `extensions.vector_norm(...)`.

-- ---------------------------------------------------------------------------
-- 1. pgvector, in extensions like pgcrypto
-- ---------------------------------------------------------------------------

create extension if not exists vector with schema extensions;

-- ---------------------------------------------------------------------------
-- 2. The registry learns that a source need not be a product provider
-- ---------------------------------------------------------------------------
-- Confluence is not a party. Inventing an "Atlassian" organisation would be
-- worse than it looks: lib/search.ts lists every product_provider party under
-- "Service provider" in the ⌘K palette, so Atlassian would appear beside HUB24
-- in a client search. A party with no role is a ghost nobody can explain.
-- The column becomes nullable; the closing block asserts HUB24 and Netwealth
-- still have theirs and exactly one row does not.

alter table ingest.sources alter column provider_party_id drop not null;
comment on column ingest.sources.provider_party_id is
  'The product_provider party this source''s accounts belong to — what a landing row''s account_number is matched against. NULL for a source that is not a product feed (confluence, since 22 Sep 2026).';

-- Per-source settings the feed reads and the promotion applies, so the scope
-- of the sync is a row to edit rather than a workflow to redeploy.
alter table ingest.sources add column config jsonb not null default '{}'::jsonb;
comment on column ingest.sources.config is
  'Per-source settings. confluence: {"roots": {"<page id>": "<section name>"}, "space_key": "...", "excluded_title_pattern": "<regex>"}. n8n reads roots to know what to walk; promote_confluence() reads roots for the section name and the pattern for pages to record but not index.';

insert into ingest.sources (source_system, provider_party_id, role_name, config)
values (
  'confluence',
  null,
  'ingest_confluence',
  jsonb_build_object(
    -- Measured 22 Sep 2026: 23 policies under 9306113, 2 procedures with 2
    -- children under 9338881. Membership is decided by WALKING DESCENDANTS of
    -- these roots, not by parent_id — the procedures nest one level deep.
    'roots', jsonb_build_object('9306113', 'Policies', '9338881', 'Procedures'),
    'space_key', 'OPERATIONS',
    -- Two of the procedure pages are templates: legitimately in the folder,
    -- useless as an answer. Recorded as excluded, never silently dropped.
    'excluded_title_pattern', '(Template|^Copy of )'
  )
);

-- ---------------------------------------------------------------------------
-- 3. The landing table: one row per page VERSION, with its chunks and vectors
-- ---------------------------------------------------------------------------

create table ingest.confluence_pages (
  id                 bigint generated always as identity primary key,
  page_id            text not null
    constraint confluence_pages_page_id_not_blank check (length(trim(page_id)) > 0),
  version            integer not null
    constraint confluence_pages_version_positive check (version > 0),
  title              text not null,
  space_key          text,
  parent_id          text,
  -- Which root the walk reached this page from. Re-parenting is a changed row.
  scope_root         text not null,
  url                text not null,
  author             text,
  last_modified_at   timestamptz,
  -- What kb-prepare made of the page: the markdown the reader shows, and the
  -- passages with their vectors — [{ordinal, heading_path, anchor, breadcrumb,
  -- content, embedding: [384 numbers]}]. Never shaped here.
  body_md            text not null,
  chunks             jsonb not null,
  -- ADF node types kb-prepare had no rule for. Empty is the expectation; a
  -- name here is a Confluence macro eating a policy's words.
  unsupported        text[] not null default '{}',
  -- The page as Confluence served it, whole.
  payload            jsonb not null,

  fetched_at         timestamptz not null default now(),
  promoted_at        timestamptz,
  promotion_outcome  text
    constraint confluence_pages_outcome_known check (promotion_outcome is null or promotion_outcome in
      ('promoted', 'excluded', 'superseded', 'invalid', 'error')),
  promotion_note     text,

  unique (page_id, version)
);

create index confluence_pages_page_idx    on ingest.confluence_pages (page_id, version desc);
create index confluence_pages_pending_idx on ingest.confluence_pages (page_id, version desc) where promoted_at is null;

alter table ingest.confluence_pages enable row level security;

comment on table ingest.confluence_pages is
  'One Confluence page version, as kb-prepare returned it to n8n: the page''s markdown, its chunks WITH their 384-dimensional embeddings, and the ADF it came from. Written by n8n as ingest_confluence; read by ingest.promote(''confluence''). Every version is kept — this is the version history of the firm''s policy text.';
comment on column ingest.confluence_pages.chunks is
  'Array of {ordinal, heading_path[], anchor, breadcrumb, content, embedding[384]}. Embedded BEFORE landing so a chunk never exists without its vector and the feed role needs nothing on public.';
comment on column ingest.confluence_pages.promotion_outcome is
  'promoted: kb_documents/kb_chunks written. excluded: recorded but not indexed — a template, or an empty page. superseded: a newer version of the same page landed before this one was promoted. invalid: the chunks did not pass validation (see promotion_note). error: this row raised and was rolled back alone.';

-- The same changed-row rule the provider feeds have: an UPDATE that changes
-- anything but the outcome stamps re-queues the row. The strip list is
-- hardcoded in that function, which is why this table carries no
-- `last_seen_at` — touching it every run would re-promote every page.
create trigger trg_confluence_pages_changed
  before update on ingest.confluence_pages
  for each row execute function ingest.landing_row_changed();

-- ---------------------------------------------------------------------------
-- 4. The manifest: what a run SAW, so a page that vanishes can be retired
-- ---------------------------------------------------------------------------
-- A landing table only knows what was fetched. Deletion, moving a page out of
-- scope and re-parenting all look the same from here — absence — and can only
-- be told from an outage by the run saying it finished.

create table ingest.confluence_runs (
  id                      bigint generated always as identity primary key,
  started_at              timestamptz not null default now(),
  finished_at             timestamptz,
  root_page_ids           text[] not null,
  -- Every page id the walk returned, in scope, templates included.
  page_ids                text[] not null default '{}',
  -- Set by n8n only after the walk AND every body fetch succeeded. A run that
  -- is not complete retires nothing.
  complete                boolean not null default false,
  note                    text,
  reconciled_at           timestamptz,
  reconciliation_outcome  text
    constraint confluence_runs_reconciliation_known check (reconciliation_outcome is null or reconciliation_outcome in
      ('reconciled', 'too_few', 'incomplete')),
  reconciliation_note     text
);

create index confluence_runs_unreconciled_idx on ingest.confluence_runs (id desc) where reconciled_at is null;

alter table ingest.confluence_runs enable row level security;

comment on table ingest.confluence_runs is
  'One row per sync run: the roots walked and every page id seen. promote_confluence() reconciles kb_documents against the newest complete, unreconciled run — a live document absent from it is retired, a retired one present is brought back. A manifest holding fewer than 70% of the live documents retires nothing and is stamped too_few, so an outage or an expired token cannot blank the knowledge base.';

-- ---------------------------------------------------------------------------
-- 5. The searchable copy, in public
-- ---------------------------------------------------------------------------

create table public.kb_documents (
  id                  uuid primary key default gen_random_uuid(),
  confluence_page_id  text not null unique,
  title               text not null,
  -- "Policies" or "Procedures": the section the page's root names in the registry.
  section             text not null,
  scope_root          text not null,
  url                 text not null,
  version             integer not null,
  body_md             text not null,
  -- Recorded but not indexed: a template, an empty page.
  excluded            boolean not null default false,
  excluded_reason     text,
  -- Soft: absent from the last complete run. The chunks are hard-deleted; the
  -- row stays so a recorded answer can still name what it cited.
  retired_at          timestamptz,
  retired_reason      text,
  synced_at           timestamptz not null default now(),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint kb_documents_excluded_has_reason check (not excluded or excluded_reason is not null)
);

create index kb_documents_live_idx on public.kb_documents (section, title) where retired_at is null and not excluded;

alter table public.kb_documents enable row level security;

comment on table public.kb_documents is
  'A Confluence policy or procedure page, as last promoted: the markdown the /help reader shows. NOT AUDITED — a derived copy rebuilt by the feed; ingest.confluence_pages keeps every version. Readable by every active staff member: the firm''s own rules are not territory-scoped.';
comment on column public.kb_documents.retired_at is
  'Set when the page was absent from the newest complete sync run. Its chunks are deleted, so it cannot be found; the row remains because kb_message_citations points at it.';

create table public.kb_chunks (
  id            uuid primary key default gen_random_uuid(),
  document_id   uuid not null references public.kb_documents(id) on delete cascade,
  ordinal       integer not null,
  heading_path  text[] not null default '{}',
  -- The reader's id for the deepest heading, for /help/{page}#anchor.
  anchor        text,
  -- "{title} › {heading path}" — weighted A in the tsvector, so the Privacy
  -- Policy is found by its name before by a passage that mentions privacy.
  breadcrumb    text not null,
  -- The passage, breadcrumb included, as it was embedded.
  content       text not null
    constraint kb_chunks_content_not_blank check (length(trim(content)) > 0),
  search_tsv    tsvector generated always as (
    setweight(to_tsvector('english', breadcrumb), 'A') ||
    setweight(to_tsvector('english', content), 'B')
  ) stored,
  -- NOT NULL: a chunk without a vector is a recall hole that keyword search
  -- would paper over. The norm check guards the operator below: <#> ranks by
  -- inner product, which equals cosine only for unit vectors. gte-small with
  -- normalize:true returns them; if that flag were ever dropped the ranking
  -- would silently become "by magnitude", so an off-unit vector is refused.
  embedding     extensions.vector(384) not null
    constraint kb_chunks_embedding_is_unit check (abs(extensions.vector_norm(embedding) - 1) < 0.01),
  unique (document_id, ordinal)
);

create index kb_chunks_search_idx   on public.kb_chunks using gin (search_tsv);
create index kb_chunks_document_idx on public.kb_chunks (document_id);
-- NO VECTOR INDEX, deliberately. ~600 chunks × 384 floats ≈ 920 KB is scanned
-- exhaustively in well under a millisecond and the result is EXACT. HNSW is
-- approximate, would trade recall for speed it cannot deliver at this size,
-- and once it exists the planner may use it and apply the retired filter
-- afterwards, so retired chunks eat candidate slots. Revisit above ~20,000.

alter table public.kb_chunks enable row level security;

comment on table public.kb_chunks is
  'A passage of a kb_document, at most 1,100 characters, with its gte-small embedding. Built by supabase/functions/_shared/chunk.ts, not here. NOT AUDITED. No vector index on purpose: exhaustive scan is exact and fast below ~20,000 rows.';

-- Read by every active staff member; written by nobody through the API. The
-- promotion function owns the write path and bypasses RLS.
create policy kb_documents_select on public.kb_documents
  for select to authenticated using (public.is_active_staff());
create policy kb_chunks_select on public.kb_chunks
  for select to authenticated using (public.is_active_staff());

-- THE GRANT TRAP: search_knowledge_base() below is SECURITY INVOKER, so
-- without these every staff call fails with "permission denied for table
-- kb_chunks". Grant select and let RLS be the boundary, as audit_entries does.
revoke all on public.kb_documents from public, anon, authenticated;
revoke all on public.kb_chunks    from public, anon, authenticated;
grant select on public.kb_documents to authenticated;
grant select on public.kb_chunks    to authenticated;

create trigger trg_kb_documents_updated_at
  before update on public.kb_documents
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 6. Promotion: the CRM's rules for a landed page
-- ---------------------------------------------------------------------------
-- In this order, on purpose:
--   1. RECONCILE against the newest complete, unreconciled run — retire the
--      absent, re-queue the reappeared — so a page that came back with the
--      SAME version (its landing row already promoted, its chunks deleted at
--      retirement) is rebuilt by step 2 of this same call.
--   2. PROMOTE pending rows, newest version of each page first, stamping any
--      older pending version of the same page superseded.

create or replace function ingest.promote_confluence()
returns jsonb
language plpgsql
security definer
set search_path to ''
as $fn$
declare
  v_src        ingest.sources%rowtype;
  v_run        ingest.confluence_runs%rowtype;
  v_live       int;
  v_retired    int := 0;
  v_revived    int := 0;
  v_requeued   int := 0;
  r            record;
  v_last_page  text := null;
  v_outcome    text;
  v_note       text;
  v_doc_id     uuid;
  v_section    text;
  v_pattern    text;
  v_n_chunks   int;
  v_bad        int;
  v_promoted   int := 0;
  v_excluded   int := 0;
  v_superseded int := 0;
  v_invalid    int := 0;
  v_errors     int := 0;
begin
  select * into v_src from ingest.sources where source_system = 'confluence';
  v_pattern := coalesce(v_src.config->>'excluded_title_pattern', '');

  -- 1. Reconcile.
  select * into v_run
    from ingest.confluence_runs
   where reconciled_at is null and finished_at is not null
   order by id desc
   limit 1;

  if found then
    if not v_run.complete then
      update ingest.confluence_runs
         set reconciled_at = now(), reconciliation_outcome = 'incomplete',
             reconciliation_note = 'The run did not finish cleanly; nothing was retired.'
       where id = v_run.id;
    else
      select count(*) into v_live from public.kb_documents where retired_at is null;
      -- THE SAFETY VALVE. A short manifest — an outage, an expired token, a 429
      -- mid-walk — must not blank the knowledge base; the next good run would
      -- silently rebuild it and nobody would ever know.
      if v_live > 0 and cardinality(v_run.page_ids) < ceil(v_live * 0.7) then
        update ingest.confluence_runs
           set reconciled_at = now(), reconciliation_outcome = 'too_few',
               reconciliation_note = format('The run saw %s pages against %s live documents; nothing was retired.',
                                            cardinality(v_run.page_ids), v_live)
         where id = v_run.id;
      else
        -- Retire the absent: soft on the document, hard on the chunks.
        with gone as (
          update public.kb_documents d
             set retired_at = now(),
                 retired_reason = format('Absent from sync run %s on %s', v_run.id, to_char(now(), 'YYYY-MM-DD'))
           where d.retired_at is null
             and not (d.confluence_page_id = any (v_run.page_ids))
          returning d.id
        ), dropped as (
          delete from public.kb_chunks c using gone where c.document_id = gone.id
        )
        select count(*) into v_retired from gone;

        -- Revive the reappeared: clear the stamp and re-queue the newest
        -- landing row, so step 2 rebuilds the chunks now.
        with back as (
          update public.kb_documents d
             set retired_at = null, retired_reason = null
           where d.retired_at is not null
             and d.confluence_page_id = any (v_run.page_ids)
          returning d.confluence_page_id
        ), requeue as (
          update ingest.confluence_pages p
             set promoted_at = null, promotion_outcome = null, promotion_note = null
            from back
           where p.page_id = back.confluence_page_id
             and p.version = (select max(version) from ingest.confluence_pages q where q.page_id = p.page_id)
          returning p.id
        )
        select (select count(*) from back), (select count(*) from requeue) into v_revived, v_requeued;

        update ingest.confluence_runs
           set reconciled_at = now(), reconciliation_outcome = 'reconciled',
               reconciliation_note = format('%s retired, %s revived', v_retired, v_revived)
         where id = v_run.id;
      end if;
    end if;
  end if;

  -- 2. Promote. Newest version of each page first; an older pending version
  --    of the same page is superseded rather than promoted after it.
  for r in
    select * from ingest.confluence_pages
     where promoted_at is null
     order by page_id, version desc, id desc
     for update skip locked
  loop
    v_outcome := null;
    v_note    := null;

    if r.page_id = v_last_page then
      v_outcome := 'superseded';
      v_note    := 'A newer version of this page was promoted in the same run.';
      v_superseded := v_superseded + 1;
      update ingest.confluence_pages
         set promoted_at = now(), promotion_outcome = v_outcome, promotion_note = v_note
       where id = r.id;
      continue;
    end if;
    v_last_page := r.page_id;

    begin
      v_section := coalesce(v_src.config->'roots'->>r.scope_root, 'Other');

      -- Validate before writing anything: every chunk has words and a
      -- 384-number vector. A page that fails is recorded, not partly indexed.
      if jsonb_typeof(r.chunks) <> 'array' then
        v_outcome := 'invalid';
        v_note := 'chunks is not an array';
      else
        select count(*) filter (where
                 jsonb_typeof(c->'content') <> 'string'
                 or length(trim(c->>'content')) = 0
                 or jsonb_typeof(c->'embedding') <> 'array'
                 or jsonb_array_length(c->'embedding') <> 384
                 or jsonb_typeof(c->'breadcrumb') <> 'string'),
               count(*)
          into v_bad, v_n_chunks
          from jsonb_array_elements(r.chunks) c;
        if v_bad > 0 then
          v_outcome := 'invalid';
          v_note := format('%s of %s chunks have no content or no 384-dimensional embedding', v_bad, v_n_chunks);
        end if;
      end if;

      if v_outcome is null then
        -- The document row, live and current. A re-landed page un-retires.
        insert into public.kb_documents as d
          (confluence_page_id, title, section, scope_root, url, version, body_md, excluded, excluded_reason, retired_at, retired_reason, synced_at)
        values
          (r.page_id, r.title, v_section, r.scope_root, r.url, r.version, r.body_md, false, null, null, null, now())
        on conflict (confluence_page_id) do update
          set title = excluded.title, section = excluded.section, scope_root = excluded.scope_root,
              url = excluded.url, version = excluded.version, body_md = excluded.body_md,
              excluded = false, excluded_reason = null, retired_at = null, retired_reason = null,
              synced_at = now()
        returning d.id into v_doc_id;

        -- Excluded: a template by title, or a page with nothing in it. The
        -- row is kept so the exclusion is visible; nothing is indexed.
        if v_pattern <> '' and r.title ~ v_pattern then
          v_outcome := 'excluded';
          v_note := 'Title matches the excluded pattern';
        elsif v_n_chunks = 0 then
          v_outcome := 'excluded';
          v_note := 'The page has no content';
        end if;

        delete from public.kb_chunks where document_id = v_doc_id;

        if v_outcome = 'excluded' then
          update public.kb_documents set excluded = true, excluded_reason = v_note where id = v_doc_id;
          v_excluded := v_excluded + 1;
        else
          insert into public.kb_chunks (document_id, ordinal, heading_path, anchor, breadcrumb, content, embedding)
          select v_doc_id,
                 coalesce((c->>'ordinal')::int, (o - 1)::int),
                 coalesce(array(select jsonb_array_elements_text(c->'heading_path')), '{}'::text[]),
                 nullif(c->>'anchor', ''),
                 c->>'breadcrumb',
                 c->>'content',
                 ((c->'embedding')::text)::extensions.vector(384)
            from jsonb_array_elements(r.chunks) with ordinality as t(c, o);
          v_outcome := 'promoted';
          v_note := format('%s chunks', v_n_chunks);
          v_promoted := v_promoted + 1;
        end if;
      else
        v_invalid := v_invalid + 1;
      end if;
    exception when others then
      -- One page's failure is that page's outcome, not the run's.
      v_outcome := 'error';
      v_note := left(sqlerrm, 500);
      v_errors := v_errors + 1;
    end;

    update ingest.confluence_pages
       set promoted_at = now(), promotion_outcome = v_outcome, promotion_note = v_note
     where id = r.id;
  end loop;

  return jsonb_build_object(
    'promoted', v_promoted, 'excluded', v_excluded, 'superseded', v_superseded,
    'invalid', v_invalid, 'errors', v_errors,
    'retired', v_retired, 'revived', v_revived, 'requeued', v_requeued,
    'reconciled_run', v_run.id, 'reconciliation', v_run.reconciliation_outcome);
end $fn$;

revoke all on function ingest.promote_confluence() from public, anon, authenticated;

comment on function ingest.promote_confluence() is
  'Reconciles kb_documents against the newest complete sync run (retire the absent, revive the reappeared — refusing when the run saw under 70% of the live documents), then promotes pending landing rows newest-version-first into kb_documents and kb_chunks, superseding older pending versions. Reached only through ingest.promote(''confluence'').';

-- The one door, with its third arm. Restated whole, as the 17 Sep migration
-- restated it for Netwealth. A source with no provider party passes NULL to a
-- function that never asks for one.
create or replace function ingest.promote(p_source text)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $fn$
declare
  v_src ingest.sources%rowtype;
begin
  select * into v_src from ingest.sources where source_system = p_source;
  if not found then
    raise exception 'Unknown source %', p_source;
  end if;
  if not v_src.enabled then
    raise exception 'Source % is disabled', p_source;
  end if;

  case p_source
    when 'hub24'      then return ingest.promote_hub24(v_src.provider_party_id);
    when 'netwealth'  then return ingest.promote_netwealth(v_src.provider_party_id);
    when 'confluence' then return ingest.promote_confluence();
    else raise exception 'No promotion is written for %', p_source;
  end case;
end $fn$;

revoke all on function ingest.promote(text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 7. The role n8n connects as for Confluence
-- ---------------------------------------------------------------------------
-- NOLOGIN until a password is set, once, out of band, in the SQL editor:
--   alter role ingest_confluence login password '...' valid until '2027-03-22';
-- The password appears in no file. Guarded, because roles live at the cluster
-- and survive a branch reset. 300s rather than the provider feeds' 60s: a full
-- rebuild after a chunker change re-promotes every page in one call.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'ingest_confluence') then
    create role ingest_confluence nologin noinherit connection limit 3;
  end if;
end $$;
alter role ingest_confluence set statement_timeout = '300s';
alter role ingest_confluence set search_path = 'ingest';

grant usage on schema ingest to ingest_confluence;
grant select, insert, update on ingest.confluence_pages to ingest_confluence;
grant select, insert, update on ingest.confluence_runs  to ingest_confluence;
grant select on ingest.sources to ingest_confluence;
grant execute on function ingest.promote(text) to ingest_confluence;
-- And NOTHING on public, and nothing on the provider feeds' tables. The closing
-- block asserts the first; the branch probe the second.

-- RLS is on; this role is the one principal that needs through it, and the
-- promotion function is the owner and bypasses it.
create policy confluence_pages_feed on ingest.confluence_pages
  for all to ingest_confluence using (true) with check (true);
create policy confluence_runs_feed on ingest.confluence_runs
  for all to ingest_confluence using (true) with check (true);
create policy sources_feed_read_confluence on ingest.sources
  for select to ingest_confluence using (true);

-- Nothing in ingest.* for the API roles, restated for the new objects.
revoke all on all tables    in schema ingest from public, anon, authenticated;
revoke all on all sequences in schema ingest from public, anon, authenticated;
revoke all on all functions in schema ingest from public, anon, authenticated;

-- Each feed role holds exactly its own sequences.
grant usage, select on sequence ingest.confluence_pages_id_seq to ingest_confluence;
grant usage, select on sequence ingest.confluence_runs_id_seq  to ingest_confluence;

comment on schema ingest is
  'Landing zone for external feeds. Not exposed through PostgREST. One table per source, written by that source''s own database role; promoted into public.* only through ingest.promote(). HUB24 since 15 Sep 2026, Netwealth since 17 Sep 2026, Confluence (the knowledge base) since 22 Sep 2026.';

-- ---------------------------------------------------------------------------
-- 8. Retrieval: one function, keyword and meaning fused
-- ---------------------------------------------------------------------------
-- Reciprocal Rank Fusion, not a weighted sum of scores: ts_rank_cd is
-- unbounded and query-dependent, inner product is bounded and dense, and a
-- sum is dominated by whichever has more spread that query. Ranks are
-- comparable; scores are not.
--
--   k = 20, not the textbook 60. The candidate lists are 40 deep, not TREC's
--   thousand. At k=60 the whole list spans a 1.65× ratio and two mediocre
--   ranks outrank one strong one; at k=20 it spans 2.9× and "found by both"
--   still wins.
--   Lexical 1.2, semantic 1.0. This corpus is jargon and acronyms — DDO, TMD,
--   FASEA, "within 30 days" — where a small general model is weakest and the
--   keyword arm is strongest.
--   per_doc <= 2, or a sixteen-chunk policy fills the whole palette.
--   p_embedding NULL degrades to pure keyword search, so the ⌘K palette (no
--   embed hop) and /help and the MCP (with one) call ONE function with one
--   set of constants.
--
-- websearch_to_tsquery, matching search_notes. Pure punctuation makes an
-- empty query that matches nothing, which is right; lib/search.ts's
-- escapeForFilter is for PostgREST filter syntax and is deliberately NOT on
-- this path — the text is a bound parameter, not filter grammar.
--
-- SECURITY INVOKER: runs as the caller, so RLS (is_active_staff) is the
-- boundary and the function adds no reach of its own.

create or replace function public.search_knowledge_base(
  p_query     text,
  p_embedding extensions.vector(384) default null,
  p_limit     integer default 10
)
returns table (
  chunk_id      uuid,
  document_id   uuid,
  page_id       text,
  title         text,
  section       text,
  heading_path  text[],
  anchor        text,
  content       text,
  version       integer,
  score         double precision,
  lexical_rank  integer,
  semantic_rank integer
)
language sql
stable
security invoker
set search_path to ''
as $fn$
  with q as (
    select websearch_to_tsquery('english', coalesce(p_query, '')) as tsq
  ),
  live as (
    select c.id, c.document_id, c.search_tsv, c.embedding
      from public.kb_chunks c
      join public.kb_documents d on d.id = c.document_id
     where d.retired_at is null and not d.excluded
  ),
  lex as (
    select id, row_number() over (order by rank desc, id) as rnk
      from (
        select l.id, ts_rank_cd(l.search_tsv, q.tsq) as rank
          from live l, q
         where numnode(q.tsq) > 0 and l.search_tsv @@ q.tsq
         order by rank desc, l.id
         limit 40
      ) s
  ),
  sem as (
    select id, row_number() over (order by dist asc, id) as rnk
      from (
        select l.id, l.embedding operator(extensions.<#>) p_embedding as dist
          from live l
         where p_embedding is not null
         order by dist asc, l.id
         limit 40
      ) s
  ),
  fused as (
    select coalesce(l.id, s.id) as id,
           l.rnk as lexical_rank,
           s.rnk as semantic_rank,
           1.2 * coalesce(1.0 / (20 + l.rnk), 0) + 1.0 * coalesce(1.0 / (20 + s.rnk), 0) as score
      from lex l
      full join sem s on s.id = l.id
  ),
  ranked as (
    select f.*, row_number() over (partition by c.document_id order by f.score desc, f.id) as per_doc
      from fused f
      join public.kb_chunks c on c.id = f.id
  )
  select c.id, c.document_id, d.confluence_page_id, d.title, d.section,
         c.heading_path, c.anchor, c.content, d.version,
         r.score, r.lexical_rank::integer, r.semantic_rank::integer
    from ranked r
    join public.kb_chunks c on c.id = r.id
    join public.kb_documents d on d.id = c.document_id
   where r.per_doc <= 2
   order by r.score desc, c.id
   limit greatest(1, least(coalesce(p_limit, 10), 40));
$fn$;

revoke all on function public.search_knowledge_base(text, extensions.vector(384), integer) from public, anon;
grant execute on function public.search_knowledge_base(text, extensions.vector(384), integer) to authenticated;

comment on function public.search_knowledge_base(text, extensions.vector(384), integer) is
  'Passages of the firm''s policies matching a question: full-text (websearch syntax) fused with vector similarity by reciprocal rank (k=20; lexical 1.2, semantic 1.0), at most two passages per document. p_embedding null = keyword only, which is what the ⌘K palette sends. Runs as the caller; retired and excluded documents never match.';

-- ---------------------------------------------------------------------------
-- 9. Ask: every conversation with the assistant is a record
-- ---------------------------------------------------------------------------
-- Append-only, in the spirit of notes: a question asked and an answer given
-- are facts, not drafts. Readable by the person who asked and by an
-- administrator (manage_staff); insertable by the person; NO update and NO
-- delete policy, and no grant to match, so neither the function nor a direct
-- call can change what was said. Citations are a SNAPSHOT — document id,
-- heading, version and excerpt — not a chunk id: chunks are hard-deleted when
-- a policy is retired, and the record of what the assistant told someone must
-- outlive that.

create table public.kb_conversations (
  id          uuid primary key default gen_random_uuid(),
  staff_id    uuid not null references public.staff_users(id) on delete restrict,
  -- The first question, trimmed, so the history list reads as questions.
  title       text not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index kb_conversations_staff_idx on public.kb_conversations (staff_id, updated_at desc);
alter table public.kb_conversations enable row level security;

create table public.kb_messages (
  id               uuid primary key default gen_random_uuid(),
  conversation_id  uuid not null references public.kb_conversations(id) on delete restrict,
  role             text not null constraint kb_messages_role_known check (role in ('user', 'assistant')),
  content          text not null,
  -- The assistant's side only. `refused` is the fixed sentence given without a
  -- model call when nothing in the policies covered the question; its token
  -- counts are null because no tokens were spent.
  model            text,
  input_tokens     integer,
  output_tokens    integer,
  refused          boolean not null default false,
  created_at       timestamptz not null default now(),
  constraint kb_messages_user_has_no_model check (role = 'assistant' or (model is null and input_tokens is null and output_tokens is null and not refused))
);
create index kb_messages_conversation_idx on public.kb_messages (conversation_id, created_at);
alter table public.kb_messages enable row level security;

create table public.kb_message_citations (
  message_id    uuid not null references public.kb_messages(id) on delete restrict,
  ordinal       integer not null,
  document_id   uuid not null references public.kb_documents(id) on delete restrict,
  title         text not null,
  heading_path  text[] not null default '{}',
  anchor        text,
  version       integer not null,
  excerpt       text not null,
  primary key (message_id, ordinal)
);
alter table public.kb_message_citations enable row level security;

comment on table public.kb_conversations is
  'A staff member''s conversation with the policy assistant on /help. Append-only: no update or delete policy exists. Readable by its owner and by manage_staff. NOT AUDITED — the rows are the record.';
comment on table public.kb_messages is
  'One turn. role=user is the question as typed; role=assistant is the answer, with the model that wrote it and the tokens it cost, or refused=true for the fixed sentence given when no policy covered the question.';
comment on table public.kb_message_citations is
  'The passages an answer drew on, as a snapshot (title, heading, version, excerpt) rather than a chunk id, so the record survives the policy being retired or re-chunked.';

create policy kb_conversations_select on public.kb_conversations
  for select to authenticated
  using (staff_id = public.current_staff_id() or public.current_staff_has('manage_staff'));
create policy kb_conversations_insert on public.kb_conversations
  for insert to authenticated
  with check (staff_id = public.current_staff_id() and public.is_active_staff());

create policy kb_messages_select on public.kb_messages
  for select to authenticated
  using (exists (select 1 from public.kb_conversations k where k.id = conversation_id
                   and (k.staff_id = public.current_staff_id() or public.current_staff_has('manage_staff'))));
create policy kb_messages_insert on public.kb_messages
  for insert to authenticated
  with check (exists (select 1 from public.kb_conversations k where k.id = conversation_id
                        and k.staff_id = public.current_staff_id()));

create policy kb_message_citations_select on public.kb_message_citations
  for select to authenticated
  using (exists (select 1 from public.kb_messages m join public.kb_conversations k on k.id = m.conversation_id
                  where m.id = message_id
                    and (k.staff_id = public.current_staff_id() or public.current_staff_has('manage_staff'))));
create policy kb_message_citations_insert on public.kb_message_citations
  for insert to authenticated
  with check (exists (select 1 from public.kb_messages m join public.kb_conversations k on k.id = m.conversation_id
                       where m.id = message_id and k.staff_id = public.current_staff_id()));

-- A conversation must carry no update or delete policy; the grants say the same.
revoke all on public.kb_conversations     from public, anon, authenticated;
revoke all on public.kb_messages          from public, anon, authenticated;
revoke all on public.kb_message_citations from public, anon, authenticated;
grant select, insert on public.kb_conversations     to authenticated;
grant select, insert on public.kb_messages          to authenticated;
grant select, insert on public.kb_message_citations to authenticated;

-- The conversation's updated_at follows its newest message. DEFINER, because
-- the caller has no update right on conversations and must not gain one.
create or replace function public.kb_touch_conversation()
returns trigger
language plpgsql
security definer
set search_path to ''
as $fn$
begin
  update public.kb_conversations set updated_at = now() where id = new.conversation_id;
  return new;
end $fn$;
revoke all on function public.kb_touch_conversation() from public, anon, authenticated;

create trigger trg_kb_messages_touch
  after insert on public.kb_messages
  for each row execute function public.kb_touch_conversation();

-- The rate limit lives HERE, not in the edge function — the lesson of identity
-- verification, measured 31 Aug 2026: a limit inside a stateless function
-- never accumulates. Thirty questions an hour a person is generous for
-- someone working and a wall for a loop. INVOKER: the caller's own rows are
-- what is counted, the caller's own conversation is what is written.
create or replace function public.kb_begin_turn(p_conversation_id uuid, p_question text)
returns table (conversation_id uuid, message_id uuid)
language plpgsql
security invoker
set search_path to ''
as $fn$
declare
  v_staff    uuid := public.current_staff_id();
  v_question text := btrim(coalesce(p_question, ''));
  v_recent   int;
  v_conv     uuid;
  v_msg      uuid;
begin
  if v_staff is null or not public.is_active_staff() then
    raise exception 'Only an active staff member can ask the assistant';
  end if;
  if length(v_question) < 3 then
    raise exception 'Type a question first';
  end if;
  if length(v_question) > 2000 then
    raise exception 'Keep a question under 2,000 characters';
  end if;

  select count(*) into v_recent
    from public.kb_messages m
    join public.kb_conversations k on k.id = m.conversation_id
   where k.staff_id = v_staff and m.role = 'user' and m.created_at > now() - interval '1 hour';
  if v_recent >= 30 then
    raise exception 'You have asked thirty questions in the last hour. Try again a little later.';
  end if;

  if p_conversation_id is null then
    insert into public.kb_conversations (staff_id, title)
    values (v_staff, left(v_question, 120))
    returning id into v_conv;
  else
    select k.id into v_conv from public.kb_conversations k
     where k.id = p_conversation_id and k.staff_id = v_staff;
    if v_conv is null then
      raise exception 'That conversation is not yours to continue';
    end if;
  end if;

  insert into public.kb_messages (conversation_id, role, content)
  values (v_conv, 'user', v_question)
  returning id into v_msg;

  return query select v_conv, v_msg;
end $fn$;

revoke all on function public.kb_begin_turn(uuid, text) from public, anon;
grant execute on function public.kb_begin_turn(uuid, text) to authenticated;

-- The answer, recorded after it was given. Citations arrive as
-- [{document_id, title, heading_path, anchor, version, excerpt}] in the order
-- the answer numbered them.
create or replace function public.kb_record_answer(
  p_conversation_id uuid,
  p_content         text,
  p_model           text,
  p_input_tokens    integer,
  p_output_tokens   integer,
  p_refused         boolean,
  p_citations       jsonb
)
returns uuid
language plpgsql
security invoker
set search_path to ''
as $fn$
declare
  v_msg uuid;
begin
  if not exists (select 1 from public.kb_conversations k
                  where k.id = p_conversation_id and k.staff_id = public.current_staff_id()) then
    raise exception 'That conversation is not yours';
  end if;

  insert into public.kb_messages (conversation_id, role, content, model, input_tokens, output_tokens, refused)
  values (p_conversation_id, 'assistant', coalesce(p_content, ''), p_model, p_input_tokens, p_output_tokens, coalesce(p_refused, false))
  returning id into v_msg;

  insert into public.kb_message_citations (message_id, ordinal, document_id, title, heading_path, anchor, version, excerpt)
  select v_msg,
         (o)::int,
         (c->>'document_id')::uuid,
         c->>'title',
         coalesce(array(select jsonb_array_elements_text(c->'heading_path')), '{}'::text[]),
         nullif(c->>'anchor', ''),
         (c->>'version')::int,
         left(c->>'excerpt', 1200)
    from jsonb_array_elements(coalesce(p_citations, '[]'::jsonb)) with ordinality as t(c, o);

  return v_msg;
end $fn$;

revoke all on function public.kb_record_answer(uuid, text, text, integer, integer, boolean, jsonb) from public, anon;
grant execute on function public.kb_record_answer(uuid, text, text, integer, integer, boolean, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- 10. Prove it
-- ---------------------------------------------------------------------------
do $$
declare
  v_null_providers int;
begin
  if not exists (select 1 from pg_extension e join pg_namespace n on n.oid = e.extnamespace
                  where e.extname = 'vector' and n.nspname = 'extensions') then
    raise exception 'pgvector is not installed in extensions';
  end if;

  select count(*) into v_null_providers from ingest.sources where provider_party_id is null;
  if v_null_providers <> 1 then
    raise exception 'Exactly one source (confluence) should have no provider party, found %', v_null_providers;
  end if;
  if exists (select 1 from ingest.sources where source_system in ('hub24', 'netwealth') and provider_party_id is null) then
    raise exception 'A provider feed lost its provider party';
  end if;
  if (select config->'roots' from ingest.sources where source_system = 'confluence') is null then
    raise exception 'The confluence source has no roots to walk';
  end if;

  if not exists (select 1 from pg_roles where rolname = 'ingest_confluence') then
    raise exception 'The ingest_confluence role was not created';
  end if;
  -- NOTHING on public for the feed role.
  if has_table_privilege('ingest_confluence', 'public.kb_chunks', 'select')
     or has_table_privilege('ingest_confluence', 'public.kb_documents', 'select')
     or has_table_privilege('ingest_confluence', 'public.kb_chunks', 'update') then
    raise exception 'ingest_confluence must hold nothing on public';
  end if;
  if not has_table_privilege('ingest_confluence', 'ingest.confluence_pages', 'insert')
     or not has_function_privilege('ingest_confluence', 'ingest.promote(text)', 'execute') then
    raise exception 'ingest_confluence is missing its own grants';
  end if;
  if has_table_privilege('ingest_confluence', 'ingest.netwealth_accounts', 'select')
     or has_table_privilege('ingest_netwealth', 'ingest.confluence_pages', 'select') then
    raise exception 'Feed roles must be blind to each other''s tables';
  end if;

  -- The vector column is NOT NULL, with the unit-norm guard.
  if exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'kb_chunks' and column_name = 'embedding' and is_nullable = 'YES') then
    raise exception 'kb_chunks.embedding must be not null';
  end if;
  if not exists (select 1 from pg_constraint where conname = 'kb_chunks_embedding_is_unit') then
    raise exception 'The unit-norm check on embeddings is missing';
  end if;

  -- The API roles: select only on the copy, select+insert only on the record.
  if not has_table_privilege('authenticated', 'public.kb_chunks', 'select')
     or has_table_privilege('authenticated', 'public.kb_chunks', 'insert')
     or has_table_privilege('authenticated', 'public.kb_documents', 'update') then
    raise exception 'authenticated must read the knowledge base and write none of it';
  end if;
  if has_table_privilege('authenticated', 'public.kb_messages', 'update')
     or has_table_privilege('authenticated', 'public.kb_messages', 'delete')
     or has_table_privilege('authenticated', 'public.kb_conversations', 'delete') then
    raise exception 'A conversation is a record: no update or delete for authenticated';
  end if;
  if exists (select 1 from pg_policies where schemaname = 'public'
              and tablename in ('kb_conversations', 'kb_messages', 'kb_message_citations')
              and cmd in ('UPDATE', 'DELETE')) then
    raise exception 'The conversation tables must carry no update or delete policy';
  end if;
  if has_table_privilege('anon', 'public.kb_chunks', 'select') or has_function_privilege('anon', 'public.search_knowledge_base(text, extensions.vector(384), integer)', 'execute') then
    raise exception 'anon must hold nothing here';
  end if;

  -- The vector expressions resolve with an empty search_path (the trap named
  -- in the header): a real call, against an empty table.
  perform * from public.search_knowledge_base('complaint', null, 5);
  perform * from public.search_knowledge_base('complaint', (select array_fill(0.0510310363::real, array[384])::extensions.vector(384)), 5);
end $$;
