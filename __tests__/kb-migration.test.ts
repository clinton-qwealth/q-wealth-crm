import { describe, expect, test } from 'vitest'
import { migrationSource } from './helpers/migration'

/**
 * The knowledge base migration — read from its text.
 *
 * Every assertion pins the CONDITION and its MESSAGE together, because a
 * message-only match survives `if false then raise …`. Each is paired with the
 * edit it exists to catch, in the comment beside it.
 */
const sql = migrationSource('the_firms_policies_are_searchable')
const body = (schema: string, fn: string) => {
  const start = sql.indexOf(`create or replace function ${schema}.${fn}(`)
  if (start < 0) throw new Error(`no function ${schema}.${fn}`)
  const end = sql.indexOf('$fn$;', start)
  return sql.slice(start, end)
}

describe('the feed', () => {
  test('pgvector lands in extensions, like pgcrypto', () => {
    expect(sql).toMatch(/create extension if not exists vector with schema extensions;/)
    expect(sql).toMatch(/pgvector is not installed in extensions/)
  })

  test('a source need not be a product provider, and exactly one is not', () => {
    expect(sql).toMatch(/alter table ingest\.sources alter column provider_party_id drop not null;/)
    expect(sql).toMatch(/if v_null_providers <> 1 then\s+raise exception 'Exactly one source \(confluence\) should have no provider party/)
    /* Mutation: drop the hub24/netwealth guard → this fails. */
    expect(sql).toMatch(/source_system in \('hub24', 'netwealth'\) and provider_party_id is null\) then\s+raise exception 'A provider feed lost its provider party'/)
  })

  test('scope is root page ids in the registry, walked as descendants', () => {
    expect(sql).toMatch(/'roots', jsonb_build_object\('9306113', 'Policies', '9338881', 'Procedures'\)/)
    expect(sql).toMatch(/'excluded_title_pattern', '\(Template\|\^Copy of \)'/)
    expect(sql).toMatch(/if \(select config->'roots' from ingest\.sources where source_system = 'confluence'\) is null then\s+raise exception 'The confluence source has no roots to walk'/)
  })

  test('the landing row carries the chunks WITH their vectors, and keeps every version', () => {
    expect(sql).toMatch(/create table ingest\.confluence_pages \(/)
    expect(sql).toMatch(/chunks\s+jsonb not null,/)
    expect(sql).toMatch(/unique \(page_id, version\)/)
    /* The generic re-queue trigger is REUSED. Mutation: a new function → fails. */
    expect(sql).toMatch(/before update on ingest\.confluence_pages\s+for each row execute function ingest\.landing_row_changed\(\);/)
    expect(sql).not.toMatch(/create or replace function ingest\.landing_row_changed/)
    /* No last_seen_at: it would re-promote every page every run. */
    expect(sql).not.toMatch(/last_seen_at\s+timestamptz/)
    expect(sql).toMatch(/'promoted', 'excluded', 'superseded', 'invalid', 'error'/)
  })

  test('the feed role is shaped like the provider roles, with a longer timeout and nothing on public', () => {
    expect(sql).toMatch(/create role ingest_confluence nologin noinherit connection limit 3;/)
    expect(sql).toMatch(/alter role ingest_confluence set statement_timeout = '300s';/)
    expect(sql).toMatch(/grant select, insert, update on ingest\.confluence_pages to ingest_confluence;/)
    expect(sql).toMatch(/grant select, insert, update on ingest\.confluence_runs\s+to ingest_confluence;/)
    expect(sql).toMatch(/grant execute on function ingest\.promote\(text\) to ingest_confluence;/)
    expect(sql).not.toMatch(/grant [^\n]* on public\.[a-z_]+ to ingest_confluence/)
    /* Mutation: drop the has_table_privilege guard → this fails. */
    expect(sql).toMatch(/has_table_privilege\('ingest_confluence', 'public\.kb_chunks', 'select'\)[\s\S]*?raise exception 'ingest_confluence must hold nothing on public'/)
    /* RLS on, and the feed policy that makes the grants real. */
    expect(sql).toMatch(/alter table ingest\.confluence_pages enable row level security;/)
    expect(sql).toMatch(/create policy confluence_pages_feed on ingest\.confluence_pages\s+for all to ingest_confluence using \(true\) with check \(true\);/)
    expect(sql).toMatch(/create policy confluence_runs_feed on ingest\.confluence_runs\s+for all to ingest_confluence using \(true\) with check \(true\);/)
    expect(sql).toMatch(/create policy sources_feed_read_confluence on ingest\.sources\s+for select to ingest_confluence using \(true\);/)
    expect(sql).toMatch(/revoke all on all tables\s+in schema ingest from public, anon, authenticated;/)
    expect(sql).toMatch(/grant usage, select on sequence ingest\.confluence_pages_id_seq to ingest_confluence;/)
  })

  test('the door gains its third arm and nothing else', () => {
    const fn = body('ingest', 'promote')
    expect(fn).toMatch(/when 'hub24'\s+then return ingest\.promote_hub24\(v_src\.provider_party_id\);/)
    expect(fn).toMatch(/when 'netwealth'\s+then return ingest\.promote_netwealth\(v_src\.provider_party_id\);/)
    expect(fn).toMatch(/when 'confluence' then return ingest\.promote_confluence\(\);/)
    expect(fn).toMatch(/if not v_src\.enabled then\s+raise exception 'Source % is disabled'/)
  })
})

describe('promotion', () => {
  const fn = body('ingest', 'promote_confluence')

  test('reconciles first, then promotes, so a revived page is rebuilt in the same call', () => {
    expect(fn.indexOf('-- 1. Reconcile.')).toBeLessThan(fn.indexOf('-- 2. Promote.'))
    expect(fn).toMatch(/where reconciled_at is null and finished_at is not null\s+order by id desc\s+limit 1;/)
  })

  test('an incomplete run retires nothing', () => {
    expect(fn).toMatch(/if not v_run\.complete then[\s\S]*?reconciliation_outcome = 'incomplete'/)
  })

  test("the safety valve: a manifest under 70% of the live documents retires nothing and says so", () => {
    /* Mutation: `0.7` → `0.0` or drop the branch → this fails. */
    expect(fn).toMatch(/if v_live > 0 and cardinality\(v_run\.page_ids\) < ceil\(v_live \* 0\.7\) then[\s\S]*?reconciliation_outcome = 'too_few'/)
    expect(fn).toMatch(/nothing was retired\./)
  })

  test('retirement is soft on the document and hard on the chunks', () => {
    expect(fn).toMatch(/set retired_at = now\(\),\s+retired_reason = format\('Absent from sync run %s on %s'/)
    expect(fn).toMatch(/and not \(d\.confluence_page_id = any \(v_run\.page_ids\)\)/)
    expect(fn).toMatch(/delete from public\.kb_chunks c using gone where c\.document_id = gone\.id/)
    expect(fn).not.toMatch(/delete from public\.kb_documents/)
  })

  test('a reappeared page is un-retired and its newest landing row re-queued', () => {
    expect(fn).toMatch(/set retired_at = null, retired_reason = null\s+where d\.retired_at is not null\s+and d\.confluence_page_id = any \(v_run\.page_ids\)/)
    expect(fn).toMatch(/set promoted_at = null, promotion_outcome = null, promotion_note = null[\s\S]*?and p\.version = \(select max\(version\) from ingest\.confluence_pages q where q\.page_id = p\.page_id\)/)
  })

  test('newest version first, and an older pending version of the same page is superseded', () => {
    expect(fn).toMatch(/order by page_id, version desc, id desc\s+for update skip locked/)
    expect(fn).toMatch(/if r\.page_id = v_last_page then\s+v_outcome := 'superseded';/)
  })

  test('chunks are validated before anything is written: content and a 384-number vector each', () => {
    expect(fn).toMatch(/jsonb_array_length\(c->'embedding'\) <> 384/)
    expect(fn).toMatch(/length\(trim\(c->>'content'\)\) = 0/)
    expect(fn).toMatch(/v_outcome := 'invalid';\s+v_note := format\('%s of %s chunks have no content or no 384-dimensional embedding'/)
    /* The document upsert comes AFTER validation. */
    expect(fn.indexOf("v_note := format('%s of %s chunks")).toBeLessThan(fn.indexOf('insert into public.kb_documents as d'))
  })

  test('the vector is cast from jsonb text with the schema named, because search_path is empty', () => {
    expect(fn).toMatch(/\(\(c->'embedding'\)::text\)::extensions\.vector\(384\)/)
    expect(sql).toMatch(/create or replace function ingest\.promote_confluence\(\)[\s\S]*?set search_path to ''/)
  })

  test('a template or an empty page is recorded as excluded, and its chunks removed', () => {
    expect(fn).toMatch(/if v_pattern <> '' and r\.title ~ v_pattern then\s+v_outcome := 'excluded';\s+v_note := 'Title matches the excluded pattern';/)
    expect(fn).toMatch(/elsif v_n_chunks = 0 then\s+v_outcome := 'excluded';\s+v_note := 'The page has no content';/)
    expect(fn).toMatch(/update public\.kb_documents set excluded = true, excluded_reason = v_note where id = v_doc_id;/)
    /* The delete runs for every promoted page, excluded or not. */
    expect(fn).toMatch(/delete from public\.kb_chunks where document_id = v_doc_id;\s+if v_outcome = 'excluded' then/)
  })

  test("one page's failure is that page's outcome", () => {
    expect(fn).toMatch(/exception when others then[\s\S]*?v_outcome := 'error';\s+v_note := left\(sqlerrm, 500\);/)
  })
})

describe('the searchable copy', () => {
  test('two tables, uuid keys, the vector NOT NULL and unit-length', () => {
    expect(sql).toMatch(/create table public\.kb_documents \(\s+id\s+uuid primary key default gen_random_uuid\(\)/)
    expect(sql).toMatch(/create table public\.kb_chunks \(\s+id\s+uuid primary key default gen_random_uuid\(\)/)
    expect(sql).toMatch(/embedding\s+extensions\.vector\(384\) not null/)
    /* Mutation: drop the norm check → both fail. */
    expect(sql).toMatch(/constraint kb_chunks_embedding_is_unit check \(abs\(extensions\.vector_norm\(embedding\) - 1\) < 0\.01\)/)
    expect(sql).toMatch(/if not exists \(select 1 from pg_constraint where conname = 'kb_chunks_embedding_is_unit'\) then\s+raise exception 'The unit-norm check on embeddings is missing'/)
    expect(sql).toMatch(/is_nullable = 'YES'\) then\s+raise exception 'kb_chunks\.embedding must be not null'/)
  })

  test('the breadcrumb outweighs the passage in the tsvector', () => {
    expect(sql).toMatch(/setweight\(to_tsvector\('english', breadcrumb\), 'A'\) \|\|\s+setweight\(to_tsvector\('english', content\), 'B'\)/)
    expect(sql).toMatch(/create index kb_chunks_search_idx\s+on public\.kb_chunks using gin \(search_tsv\);/)
  })

  test('no vector index, with the threshold recorded', () => {
    expect(sql).not.toMatch(/using hnsw|using ivfflat/)
    expect(sql).toMatch(/Revisit above ~20,000/)
  })

  test('readable by every active staff member, territory-blind, written by nobody through the API', () => {
    expect(sql).toMatch(/create policy kb_documents_select on public\.kb_documents\s+for select to authenticated using \(public\.is_active_staff\(\)\);/)
    expect(sql).toMatch(/create policy kb_chunks_select on public\.kb_chunks\s+for select to authenticated using \(public\.is_active_staff\(\)\);/)
    expect(sql).not.toMatch(/staff_can_access_group[\s\S]*?kb_chunks/)
    expect(sql).toMatch(/revoke all on public\.kb_chunks\s+from public, anon, authenticated;/)
    expect(sql).toMatch(/grant select on public\.kb_chunks\s+to authenticated;/)
    expect(sql).not.toMatch(/grant [^\n]*insert[^\n]* on public\.kb_(documents|chunks)/)
    expect(sql).toMatch(/raise exception 'authenticated must read the knowledge base and write none of it'/)
  })

  test('neither table is audited, as a decision', () => {
    expect(sql).not.toMatch(/execute function public\.record_audit/)
    expect(sql).toMatch(/NOT AUDITED/)
  })
})

describe('retrieval', () => {
  const fn = body('public', 'search_knowledge_base')

  test('runs as the caller with an empty search_path, and the vector operator names its schema', () => {
    expect(sql).toMatch(/create or replace function public\.search_knowledge_base\([\s\S]*?security invoker\s+set search_path to ''/)
    expect(fn).toMatch(/operator\(extensions\.<#>\)/)
    expect(fn).not.toMatch(/embedding <#>/)
  })

  test('reciprocal rank fusion with k = 20, lexical 1.2 over semantic 1.0, lists 40 deep', () => {
    /* Mutation: 60 for 20, or swap the weights → fails. */
    expect(fn).toMatch(/1\.2 \* coalesce\(1\.0 \/ \(20 \+ l\.rnk\), 0\) \+ 1\.0 \* coalesce\(1\.0 \/ \(20 \+ s\.rnk\), 0\) as score/)
    expect(fn.match(/limit 40/g)).toHaveLength(2)
    expect(fn).toMatch(/full join sem s on s\.id = l\.id/)
  })

  test('at most two passages per document, retired and excluded never match', () => {
    expect(fn).toMatch(/where r\.per_doc <= 2/)
    expect(fn).toMatch(/where d\.retired_at is null and not d\.excluded/)
  })

  test('websearch syntax, an empty query matches nothing, and a null embedding is keyword only', () => {
    expect(fn).toMatch(/websearch_to_tsquery\('english', coalesce\(p_query, ''\)\)/)
    expect(fn).toMatch(/where numnode\(q\.tsq\) > 0 and l\.search_tsv @@ q\.tsq/)
    expect(fn).toMatch(/where p_embedding is not null/)
    expect(sql).toMatch(/escapeForFilter is for PostgREST filter syntax and is deliberately NOT on\s+-- this path/)
  })

  test('granted to authenticated and proven callable with an empty search_path', () => {
    expect(sql).toMatch(/grant execute on function public\.search_knowledge_base\(text, extensions\.vector\(384\), integer\) to authenticated;/)
    expect(sql).toMatch(/perform \* from public\.search_knowledge_base\('complaint', null, 5\);/)
    expect(sql).toMatch(/perform \* from public\.search_knowledge_base\('complaint', \(select array_fill\(0\.0510310363::real, array\[384\]\)::extensions\.vector\(384\)\), 5\);/)
  })
})

describe('the record of what the assistant said', () => {
  test('three tables, append-only: select and insert, no update, no delete — policy and grant alike', () => {
    for (const t of ['kb_conversations', 'kb_messages', 'kb_message_citations']) {
      expect(sql).toMatch(new RegExp(`create policy ${t}_select on public\\.${t}`))
      expect(sql).toMatch(new RegExp(`create policy ${t}_insert on public\\.${t}`))
      expect(sql).not.toMatch(new RegExp(`for (update|delete)[^;]*public\\.${t}`))
      expect(sql).toMatch(new RegExp(`grant select, insert on public\\.${t}\\s+to authenticated;`))
    }
    expect(sql).toMatch(/cmd in \('UPDATE', 'DELETE'\)\) then\s+raise exception 'The conversation tables must carry no update or delete policy'/)
    expect(sql).toMatch(/raise exception 'A conversation is a record: no update or delete for authenticated'/)
  })

  test('readable by the person who asked or an administrator', () => {
    expect(sql).toMatch(/create policy kb_conversations_select on public\.kb_conversations\s+for select to authenticated\s+using \(staff_id = public\.current_staff_id\(\) or public\.current_staff_has\('manage_staff'\)\);/)
  })

  test('a citation is a snapshot, not a chunk id', () => {
    expect(sql).toMatch(/create table public\.kb_message_citations \([\s\S]*?document_id\s+uuid not null references public\.kb_documents\(id\) on delete restrict,[\s\S]*?excerpt\s+text not null,/)
    expect(sql).not.toMatch(/kb_message_citations \([\s\S]*?references public\.kb_chunks/)
  })

  test('the hourly cap lives in the database and refuses with a sentence', () => {
    const fn = body('public', 'kb_begin_turn')
    /* Mutation: `>= 30` → `>= 300`, or drop the interval → fails. */
    expect(fn).toMatch(/and m\.created_at > now\(\) - interval '1 hour';\s+if v_recent >= 30 then\s+raise exception 'You have asked thirty questions in the last hour\. Try again a little later\.';/)
    expect(fn).toMatch(/raise exception 'That conversation is not yours to continue'/)
    expect(fn).toMatch(/if v_staff is null or not public\.is_active_staff\(\) then\s+raise exception 'Only an active staff member can ask the assistant'/)
    expect(sql).toMatch(/create or replace function public\.kb_begin_turn\(uuid, text\)|create or replace function public\.kb_begin_turn\(p_conversation_id uuid, p_question text\)[\s\S]*?security invoker/)
  })

  test('the refusal is recorded with no model and no tokens, and a user message can carry none', () => {
    expect(sql).toMatch(/refused\s+boolean not null default false,/)
    expect(sql).toMatch(/constraint kb_messages_user_has_no_model check \(role = 'assistant' or \(model is null and input_tokens is null and output_tokens is null and not refused\)\)/)
  })

  test('recording an answer checks the conversation is the caller’s', () => {
    const fn = body('public', 'kb_record_answer')
    expect(fn).toMatch(/where k\.id = p_conversation_id and k\.staff_id = public\.current_staff_id\(\)\) then\s+raise exception 'That conversation is not yours'/)
    expect(fn).toMatch(/left\(c->>'excerpt', 1200\)/)
  })
})
