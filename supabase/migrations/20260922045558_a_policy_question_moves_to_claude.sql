-- A policy question moves to Claude (22 Sep 2026)
--
-- Hours after the knowledge base landed, Clinton: "i think it would be a better
-- option to move the conversation to the desktop app if they ask a question."
-- So /help stops generating answers. It searches the policies and shows the
-- passages — instant, free, and enough for most questions — and hands the
-- question to Claude when somebody wants more.
--
-- THE REASON IT IS BETTER, AND IT IS NOT COST. Claude already holds the CRM
-- connector, so a question asked there reaches `search_knowledge_base`
-- ALONGSIDE `get_client_accounts`, `get_notes` and the rest. "Does this file
-- meet the seven best-interests steps" needs the policy AND the client, and
-- that combination is one /help could never have: the knowledge base is
-- deliberately the only thing it can see.
--
-- WHAT IS GIVEN UP, STATED RATHER THAN GLOSSED. The answer is no longer the
-- firm's to keep: it is written in the asker's own Claude account, under
-- whatever prompt Claude is running, and this database never sees it. The
-- system prompt that confined an answer to firm policy goes with it — Claude
-- will answer from what it knows about Australian financial services law if the
-- passages run out, which the in-CRM assistant refused to do by construction.
-- The hand-off prompt asks it not to; a prompt is a request, not a boundary.
--
-- WHAT IS KEPT, AND WHY IT IS STILL WORTH KEEPING. The question, who asked it,
-- when — and THE PASSAGES THE CRM PUT IN FRONT OF THEM. That last part is what
-- makes this a record rather than a log: "they asked about breach timeframes
-- and were shown these three extracts of the Breaches and Incidents Policy at
-- version 4" answers an audit question. "They asked something" does not.
--
-- The 30-an-hour cap was a BUDGET: every question spent Anthropic tokens.
-- Nothing is spent here now, so it becomes a runaway guard and loosens to a
-- number nobody working will ever meet.

-- ---------------------------------------------------------------------------
-- 1. Recording a hand-off
-- ---------------------------------------------------------------------------
-- One question is one conversation: the follow-ups happen in Claude, so there
-- is no second turn to record. INVOKER, like the functions it replaces — the
-- caller's own rows, written as the caller, under the same append-only
-- policies.

create or replace function public.kb_record_handoff(
  p_question  text,
  p_passages  jsonb default '[]'::jsonb
)
returns uuid
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

  -- A runaway guard, not a budget. See the header: there is no spend to cap,
  -- and the only thing worth stopping is a loop filling the table.
  select count(*) into v_recent
    from public.kb_conversations k
   where k.staff_id = v_staff and k.created_at > now() - interval '1 hour';
  if v_recent >= 200 then
    raise exception 'That is a lot of questions in one hour. Try again shortly.';
  end if;

  insert into public.kb_conversations (staff_id, title)
  values (v_staff, left(v_question, 120))
  returning id into v_conv;

  insert into public.kb_messages (conversation_id, role, content)
  values (v_conv, 'user', v_question);

  -- Explicit rather than an absence: a conversation with a question and no
  -- answer reads as a fault, and this is not one.
  insert into public.kb_messages (conversation_id, role, content)
  values (v_conv, 'assistant',
          'Handed to Claude. The answer was given there, in the asker''s own Claude account, and is not held by the firm.')
  returning id into v_msg;

  -- What the person actually had in front of them at the moment they handed it
  -- over. A snapshot, as before: chunks are deleted when a policy is retired
  -- and the record must outlive that.
  insert into public.kb_message_citations (message_id, ordinal, document_id, title, heading_path, anchor, version, excerpt)
  select v_msg,
         (o)::int,
         (c->>'document_id')::uuid,
         c->>'title',
         coalesce(array(select jsonb_array_elements_text(c->'heading_path')), '{}'::text[]),
         nullif(c->>'anchor', ''),
         (c->>'version')::int,
         left(c->>'excerpt', 1200)
    from jsonb_array_elements(coalesce(p_passages, '[]'::jsonb)) with ordinality as t(c, o);

  return v_conv;
end $fn$;

revoke all on function public.kb_record_handoff(text, jsonb) from public, anon;
grant execute on function public.kb_record_handoff(text, jsonb) to authenticated;

comment on function public.kb_record_handoff(text, jsonb) is
  'Records that a staff member asked a policy question and took it to Claude: the question, a marker that the answer was given elsewhere, and the passages the CRM showed them. One question is one conversation — the follow-ups happen in Claude and are not the firm''s to hold.';

-- ---------------------------------------------------------------------------
-- 2. The in-CRM answering path is removed, not left lying about
-- ---------------------------------------------------------------------------
-- Neither was ever called by a deployed build — the app that used them has not
-- been pushed — so there is nothing to keep them alive for, and a dead write
-- path is exactly the thing a later reader mistakes for a live one. The
-- migration that created them is still in git if the decision reverses.

drop function if exists public.kb_begin_turn(uuid, text);
drop function if exists public.kb_record_answer(uuid, text, text, integer, integer, boolean, jsonb);

comment on table public.kb_conversations is
  'One policy question a staff member asked on /help, and where it went. Append-only: no update or delete policy exists. Readable by its owner and by manage_staff. NOT AUDITED — the rows are the record.';
comment on table public.kb_messages is
  'The question as typed, and one assistant row saying the question was handed to Claude. The model, token and refused columns are from the in-CRM answering path removed on 22 Sep 2026 and are null throughout; they survive because re-adding a column costs more than keeping one.';
comment on table public.kb_message_citations is
  'The passages the CRM showed when the question was handed over, as a snapshot (title, heading, version, excerpt) rather than a chunk id, so the record survives the policy being retired or re-chunked.';

-- ---------------------------------------------------------------------------
-- 3. Prove it
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
              where n.nspname = 'public' and p.proname in ('kb_begin_turn', 'kb_record_answer')) then
    raise exception 'The superseded in-CRM answering functions are still here';
  end if;
  if not has_function_privilege('authenticated', 'public.kb_record_handoff(text, jsonb)', 'execute') then
    raise exception 'authenticated cannot record a hand-off';
  end if;
  if has_function_privilege('anon', 'public.kb_record_handoff(text, jsonb)', 'execute') then
    raise exception 'anon must hold nothing here';
  end if;

  -- Still append-only, and still nobody's to edit.
  if exists (select 1 from pg_policies where schemaname = 'public'
              and tablename in ('kb_conversations', 'kb_messages', 'kb_message_citations')
              and cmd in ('UPDATE', 'DELETE')) then
    raise exception 'The conversation tables must carry no update or delete policy';
  end if;
  if has_table_privilege('authenticated', 'public.kb_messages', 'update')
     or has_table_privilege('authenticated', 'public.kb_messages', 'delete') then
    raise exception 'A recorded question is a record: no update or delete for authenticated';
  end if;

  -- The retrieval the hand-off screen runs is untouched.
  perform * from public.search_knowledge_base('complaint', null, 5);
end $$;
