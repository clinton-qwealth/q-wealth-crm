import { describe, expect, test } from 'vitest'
import { migrationSource } from './helpers/migration'

/**
 * A policy has a history — read from the migration text.
 *
 * The migration exists because `kb_documents.created_at` is the ROW's date and
 * rendering it as the policy's would have been false. Every assertion here
 * guards that distinction; each is paired with the edit it exists to catch.
 */
const sql = migrationSource('a_policy_has_a_history')

describe('the columns', () => {
  test('the page’s own dates are separate columns, on both tables', () => {
    expect(sql).toMatch(/alter table ingest\.confluence_pages\s+add column if not exists created_at_source timestamptz/)
    expect(sql).toMatch(/add column if not exists page_created_at timestamptz,\s+add column if not exists page_updated_at timestamptz/)
  })

  /**
   * The comment is the defence against the next reader reaching for
   * `created_at`. Mutation: drop the comments → nothing tells them there are
   * two dates with almost the same name.
   */
  test('each says plainly which date it is not', () => {
    expect(sql).toMatch(/comment on column public\.kb_documents\.page_created_at is\s+'[^']*NOT created_at/)
    expect(sql).toMatch(/comment on column public\.kb_documents\.page_updated_at is\s+'[^']*NOT updated_at[^']*NOT synced_at/)
  })
})

describe('the backfill', () => {
  /**
   * The landing row at the document's CURRENT version, not the newest row for
   * the page — a newer version may have failed to promote, and its date would
   * describe text nobody can read. Mutation: drop `p.version = d.version` →
   * the assertion fails.
   */
  test('reads the landing row at the version the document is actually on', () => {
    expect(sql).toMatch(/^\s*update public\.kb_documents d\s*\n\s*set page_updated_at = p\.last_modified_at/m)
    expect(sql).toMatch(/where p\.page_id = d\.confluence_page_id\s*\n\s*and p\.version = d\.version/)
  })

  /**
   * The prove-it block has to fail if the backfill copied `created_at` instead
   * of `last_modified_at` — the exact mistake this migration exists to avoid.
   * Every row landed on 22 Sep and no page was edited at that instant, so
   * equality means the wrong column was read. Mutation: drop the check → a
   * migration that wrote the row's own timestamp would pass.
   */
  test('the proof catches the wrong column, not merely a missing value', () => {
    expect(sql).toMatch(/where retired_at is null and page_updated_at = created_at/)
    expect(sql).toMatch(/raise exception '% documents were edited in Confluence at the exact instant their row landed/)
    expect(sql).toMatch(/raise exception 'the backfill left % live documents with no last-edited date'/)
  })
})

describe('promotion', () => {
  /**
   * COALESCE, not assignment. Until every page has been re-fetched some
   * landing rows carry no created date, and a re-promotion must not erase one
   * an earlier run already learned. Mutation: `page_created_at =
   * excluded.page_created_at` → a nightly run wipes the dates the first
   * re-sync collected.
   */
  test('a re-promotion cannot erase a date already learned', () => {
    expect(sql).toMatch(/page_created_at = coalesce\(excluded\.page_created_at, d\.page_created_at\)/)
    expect(sql).toMatch(/page_updated_at = coalesce\(excluded\.page_updated_at, d\.page_updated_at\)/)
  })

  test('the upsert carries both dates from the landing row', () => {
    expect(sql).toMatch(/page_created_at, page_updated_at, synced_at\)/)
    expect(sql).toMatch(/r\.created_at_source, r\.last_modified_at, now\(\)\)/)
  })
})
