import { describe, expect, test } from 'vitest'
import { migrationSource } from './helpers/migration'

/**
 * A policy question moves to Claude — read from the migration text.
 *
 * Every assertion pins the CONDITION and its MESSAGE together, because a
 * message-only match survives `if false then raise …`. Each is paired with the
 * edit it exists to catch, in the comment beside it.
 */
const sql = migrationSource('a_policy_question_moves_to_claude')
const fn = (() => {
  const start = sql.indexOf('create or replace function public.kb_record_handoff(')
  return sql.slice(start, sql.indexOf('$fn$;', start))
})()

describe('what is recorded', () => {
  test('one question is one conversation, with the question and a marker', () => {
    expect(fn).toMatch(/insert into public\.kb_conversations \(staff_id, title\)\s+values \(v_staff, left\(v_question, 120\)\)/)
    expect(fn).toMatch(/values \(v_conv, 'user', v_question\)/)
    expect(fn).toMatch(/values \(v_conv, 'assistant',\s+'Handed to Claude\./)
  })

  /**
   * **The passages are the point.** "They asked something" answers no audit
   * question; "they asked about breach timeframes and were shown these three
   * extracts at version 4" does. Mutation: drop the citation insert → fails.
   */
  test('the passages that were on screen are stored, as a snapshot', () => {
    /* Anchored at the start of a line: `-- insert into …` contains the same
       words, so an unanchored match survives the statement being commented
       out — which is exactly the mutation this exists to catch. */
    expect(fn).toMatch(/^\s*insert into public\.kb_message_citations \(message_id, ordinal, document_id, title, heading_path, anchor, version, excerpt\)$/m)
    expect(fn).toMatch(/from jsonb_array_elements\(coalesce\(p_passages, '\[\]'::jsonb\)\) with ordinality/)
    expect(fn).toMatch(/left\(c->>'excerpt', 1200\)/)
    /* A chunk id would not survive the policy being retired. */
    expect(fn).not.toMatch(/chunk_id/)
  })

  test('it runs as the caller, and refuses anyone who is not active staff', () => {
    expect(sql).toMatch(/create or replace function public\.kb_record_handoff\([\s\S]*?security invoker\s+set search_path to ''/)
    expect(fn).toMatch(/if v_staff is null or not public\.is_active_staff\(\) then\s+raise exception 'Only an active staff member can ask the assistant'/)
    expect(sql).toMatch(/grant execute on function public\.kb_record_handoff\(text, jsonb\) to authenticated;/)
    expect(sql).toMatch(/revoke all on function public\.kb_record_handoff\(text, jsonb\) from public, anon;/)
  })

  /**
   * The 30-an-hour cap was a budget for Anthropic tokens. Nothing is spent
   * now, so the guard loosens and says why. Mutation: keep 30 → fails, and the
   * comment would be a lie.
   */
  test('the cap becomes a runaway guard, and is named as one', () => {
    expect(fn).toMatch(/if v_recent >= 200 then\s+raise exception 'That is a lot of questions in one hour/)
    expect(fn).toMatch(/A runaway guard, not a budget/)
    expect(sql).toMatch(/was a BUDGET: every question spent Anthropic tokens/)
  })
})

describe('what is removed', () => {
  /* A dead write path is what a later reader mistakes for a live one. Neither
     was ever called by a deployed build. Mutation: drop the drops → fails. */
  test('the in-CRM answering functions are dropped, and proven gone', () => {
    expect(sql).toMatch(/drop function if exists public\.kb_begin_turn\(uuid, text\);/)
    expect(sql).toMatch(/drop function if exists public\.kb_record_answer\(uuid, text, text, integer, integer, boolean, jsonb\);/)
    expect(sql).toMatch(/proname in \('kb_begin_turn', 'kb_record_answer'\)\) then\s+raise exception 'The superseded in-CRM answering functions are still here'/)
  })

  test('the tables are not dropped with them: the record survives the change', () => {
    for (const t of ['kb_conversations', 'kb_messages', 'kb_message_citations']) {
      expect(sql).not.toMatch(new RegExp(`drop table[^;]*${t}`))
    }
  })

  test('still append-only, in policy and in grant', () => {
    expect(sql).toMatch(/cmd in \('UPDATE', 'DELETE'\)\) then\s+raise exception 'The conversation tables must carry no update or delete policy'/)
    expect(sql).toMatch(/raise exception 'A recorded question is a record: no update or delete for authenticated'/)
    expect(sql).not.toMatch(/create policy[^;]*for (update|delete)/)
  })
})

describe('what it says about itself', () => {
  /* The two things given up are stated where the next reader will find them,
     rather than living only in a chat log. */
  test('the header names the loss, not just the gain', () => {
    expect(sql).toMatch(/the answer is no longer the firm's to keep|answer is no longer the\s+--\s+firm's to keep/i)
    expect(sql).toMatch(/a prompt is a request, not a boundary/)
    expect(sql).toMatch(/search_knowledge_base[\s\S]{0,200}get_client_accounts/)
  })

  test('retrieval is proven untouched', () => {
    expect(sql).toMatch(/perform \* from public\.search_knowledge_base\('complaint', null, 5\);/)
  })
})
