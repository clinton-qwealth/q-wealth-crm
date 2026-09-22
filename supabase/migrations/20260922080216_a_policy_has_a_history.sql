-- A policy has a history, and the reader should show it (22 Sep 2026)
--
-- Clinton, of the reader page: "Can we make it three columns and put the
-- article column in the middle. Lets have a profile component on the left side
-- with the meta data. ie. date created and updated."
--
-- The three columns are the app's business. The DATES are this migration's,
-- because neither one was anywhere a page could read it.
--
-- WHAT WAS THERE, AND WHY IT WOULD HAVE BEEN A LIE. `kb_documents` already has
-- `created_at` and `updated_at`. They are the ROW's timestamps — when the sync
-- first landed this page and when promotion last touched it — so every one of
-- the twenty-seven policies was "created" on 22 September 2026, the afternoon
-- the pipeline first ran. Rendering that under the heading "Created" on a
-- compliance policy written years earlier is not a rounding error; it is the
-- page asserting something false about a document an auditor may be reading.
-- Hence `page_created_at` and `page_updated_at`, named so that the next person
-- to reach for `created_at` here has to notice there are two of them.
--
-- WHERE THE VALUES COME FROM. The last-modified date was ALREADY being landed,
-- in `ingest.confluence_pages.last_modified_at`, and simply never carried
-- across — so it backfills from the landing rows for all twenty-seven with no
-- re-sync. The created date was not landed at all: Confluence REST v2 returns
-- `createdAt` on the page object and the walk dropped it, so this adds the
-- landing column and n8n starts sending it. Until a page is re-fetched its
-- created date is NULL, and the reader shows nothing rather than a guess.

-- ---------------------------------------------------------------------------
-- 1. The columns
-- ---------------------------------------------------------------------------
alter table ingest.confluence_pages
  add column if not exists created_at_source timestamptz;

comment on column ingest.confluence_pages.created_at_source is
  'When Confluence says the PAGE was created (its createdAt), not when this row landed — that is fetched_at. Null on rows landed before 22 Sep 2026.';

alter table public.kb_documents
  add column if not exists page_created_at timestamptz,
  add column if not exists page_updated_at timestamptz;

comment on column public.kb_documents.page_created_at is
  'When the policy was created in Confluence. NOT created_at, which is when this row first landed here — the two differ by years and only one of them is true about the document.';
comment on column public.kb_documents.page_updated_at is
  'When the policy was last edited in Confluence. NOT updated_at (this row) and NOT synced_at (when we last looked).';

-- ---------------------------------------------------------------------------
-- 2. Backfill what was already landed
-- ---------------------------------------------------------------------------
-- The landing row at the document's CURRENT version — not the newest row for
-- the page, which may be a version that failed to promote.
update public.kb_documents d
   set page_updated_at = p.last_modified_at
  from ingest.confluence_pages p
 where p.page_id = d.confluence_page_id
   and p.version = d.version
   and p.last_modified_at is not null
   and d.page_updated_at is distinct from p.last_modified_at;

-- ---------------------------------------------------------------------------
-- 3. Promotion carries both from here on
-- ---------------------------------------------------------------------------
-- Restated whole, as the house does. Two lines differ: the upsert's column
-- list and its conflict clause.

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
          (confluence_page_id, title, section, scope_root, url, version, body_md, excluded, excluded_reason, retired_at, retired_reason,
           page_created_at, page_updated_at, synced_at)
        values
          (r.page_id, r.title, v_section, r.scope_root, r.url, r.version, r.body_md, false, null, null, null,
           r.created_at_source, r.last_modified_at, now())
        on conflict (confluence_page_id) do update
          set title = excluded.title, section = excluded.section, scope_root = excluded.scope_root,
              url = excluded.url, version = excluded.version, body_md = excluded.body_md,
              excluded = false, excluded_reason = null, retired_at = null, retired_reason = null,
              -- COALESCE, not assignment. A page whose landing row predates the
              -- created-date column carries NULL, and a re-promotion must not
              -- erase a date an earlier run already learned.
              page_created_at = coalesce(excluded.page_created_at, d.page_created_at),
              page_updated_at = coalesce(excluded.page_updated_at, d.page_updated_at),
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
  'Reconciles kb_documents against the newest complete sync run (retire the absent, revive the reappeared — refusing when the run saw under 70% of the live documents), then promotes pending landing rows newest-version-first into kb_documents and kb_chunks, superseding older pending versions, carrying the page''s own Confluence created and last-edited dates. Reached only through ingest.promote(''confluence'').';

-- ---------------------------------------------------------------------------
-- 4. Prove it
-- ---------------------------------------------------------------------------
do $$
declare
  v_missing int;
  v_wrong   int;
begin
  -- The columns exist and are timestamps, not text someone will have to parse.
  if (select count(*) from information_schema.columns
       where table_schema = 'public' and table_name = 'kb_documents'
         and column_name in ('page_created_at', 'page_updated_at')
         and data_type = 'timestamp with time zone') <> 2 then
    raise exception 'kb_documents is missing a page date column, or it is not a timestamptz';
  end if;
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'ingest' and table_name = 'confluence_pages'
                    and column_name = 'created_at_source') then
    raise exception 'the landing table cannot carry a created date';
  end if;

  -- Every live document learned its last-edited date from the backfill.
  select count(*) into v_missing
    from public.kb_documents
   where retired_at is null and page_updated_at is null;
  if v_missing > 0 then
    raise exception 'the backfill left % live documents with no last-edited date', v_missing;
  end if;

  -- And it is the PAGE's date, not the row's. If these matched we would have
  -- copied the wrong column: every row landed on 22 Sep, the pages did not.
  select count(*) into v_wrong
    from public.kb_documents
   where retired_at is null and page_updated_at = created_at;
  if v_wrong > 0 then
    raise exception '% documents were edited in Confluence at the exact instant their row landed, which means the backfill read the wrong column', v_wrong;
  end if;

  -- A created date is not expected yet; it arrives with the next full sync.
  -- Asserted as null so that a value appearing here without the n8n change
  -- would be a surprise worth investigating rather than a silent default.
  if exists (select 1 from public.kb_documents where page_created_at is not null) then
    raise notice 'some documents already carry a created date — the sync has run since this migration was written';
  end if;

  -- Retrieval is untouched.
  perform * from public.search_knowledge_base('complaint', null, 5);
end $$;
