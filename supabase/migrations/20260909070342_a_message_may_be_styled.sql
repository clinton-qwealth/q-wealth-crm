-- A message may carry a FONT and a COLOUR.
--
-- A WIDENING, so the migration goes first and the editor is configured to
-- match — the standing direction rule. It adds one mark to the email list,
-- `textStyle`, which is the single mark TipTap hangs both attributes off; that
-- is why a font selector and a colour picker are one change and not two.
--
-- ---- THE ONE PLACE THIS SCHEMA STORES A COLOUR ---------------------------
--
-- Everywhere else the rule is the opposite. A callout's tone is `warning`, not
-- an amber, precisely so the tint stays the client's decision and every stored
-- row follows when it changes; a reaction is `heart`, not the character.
--
-- A message is the deliberate exception. It is prose sent to somebody outside
-- the firm, so how it looks is a decision the writer is making about that
-- message rather than a state this application renders. The cost is accepted
-- rather than hidden: a colour in a message can never be restyled, because it
-- was never ours to restyle.
--
-- The FONT is still a closed set, and for a reason specific to email rather
-- than tidiness: a font the recipient's mail client does not have falls back
-- to something nobody chose. Six stacks, none of them quoted — `font-family:
-- Courier New, monospace` is valid CSS unquoted, and keeping it that way makes
-- this check a plain string comparison instead of an escaping problem.
--
-- The colour reaches a `style` attribute in the History tab, so the shape is
-- checked here and checked again by the renderer: six hex digits, nothing
-- else. No rgb(), no named colours, no currentColor.
--
-- Verified on a throwaway branch, nine ways: an offered font with a valid hex
-- accepted, each attribute alone accepted, an uppercase hex accepted; a font
-- off the list, rgb(), a three-digit hex, `currentColor` and a
-- `red;background:url(...)` injection all refused by name; and a `mention`
-- still refused, confirming the widening did not loosen the rest of the list.

create or replace function public.record_task_action(
  p_workflow_id uuid,
  p_task_id     uuid,
  p_kind        text,
  p_recipient   text,
  p_sender      text,
  p_subject     text,
  p_body        jsonb default null
) returns uuid
language plpgsql
security invoker
set search_path = ''
as $fn$
declare
  v_id  uuid;
  v_bad text;
begin
  if public.current_staff_id() is null then
    raise exception 'Not an active staff member';
  end if;
  if p_workflow_id is null or p_task_id is null then
    raise exception 'An action belongs to a task on a workflow';
  end if;
  if p_kind is null or p_kind not in ('email') then
    raise exception 'Not an action this task can record';
  end if;

  if not exists (
       select 1 from public.workflow_tasks t
        where t.id = p_task_id and t.workflow_id = p_workflow_id) then
    raise exception 'No such task on this workflow, or not within your access';
  end if;

  if p_kind = 'email' and coalesce(btrim(p_recipient), '') = '' then
    raise exception 'An email needs a recipient';
  end if;

  if p_body is not null then
    if jsonb_typeof(p_body) <> 'object' or p_body->>'type' <> 'doc' then
      raise exception 'A message must be a document';
    end if;

    -- NARROWER than a post's list: no mention, entity, image or attachment.
    -- `textStyle` added 9 September for the font and colour selectors.
    select n->>'type' into v_bad
      from jsonb_path_query(p_body, 'strict $.**') as t(n)
     where jsonb_typeof(n) = 'object' and n ? 'type'
       and n->>'type' not in ('doc','paragraph','text','hardBreak',
                              'bulletList','orderedList','listItem',
                              'heading','blockquote','codeBlock','horizontalRule',
                              'bold','italic','strike','code','link','underline',
                              'textStyle')
     limit 1;
    if v_bad is not null then
      raise exception 'A message may not contain "%"', v_bad;
    end if;

    -- A font must be one of the six offered. An unknown stack is refused
    -- rather than stripped: it did not come from this application.
    select n->'attrs'->>'fontFamily' into v_bad
      from jsonb_path_query(p_body, 'strict $.** ? (@.type == "textStyle")') as t(n)
     where n->'attrs'->>'fontFamily' is not null
       and n->'attrs'->>'fontFamily' not in ('Arial, Helvetica, sans-serif',
                                             'Georgia, serif',
                                             'Times New Roman, serif',
                                             'Courier New, monospace',
                                             'Verdana, sans-serif',
                                             'Tahoma, sans-serif')
     limit 1;
    if v_bad is not null then
      raise exception 'Not a font a message may use: "%"', v_bad;
    end if;

    -- Six hex digits, nothing else. This value reaches a style attribute.
    select n->'attrs'->>'color' into v_bad
      from jsonb_path_query(p_body, 'strict $.** ? (@.type == "textStyle")') as t(n)
     where n->'attrs'->>'color' is not null
       and n->'attrs'->>'color' !~* '^#[0-9a-f]{6}$'
     limit 1;
    if v_bad is not null then
      raise exception 'A colour must be six hex digits, like #1a4d8f — got "%"', v_bad;
    end if;

    -- One heading size, as a post has.
    perform 1
      from jsonb_path_query(p_body, 'strict $.** ? (@.type == "heading")') as t(n)
     where coalesce(n->'attrs'->>'level', '') <> '1';
    if found then
      raise exception 'A message has one heading size; a heading must be level 1';
    end if;

    perform 1
      from jsonb_path_query(p_body, 'strict $.** ? (@.type == "link")') as t(n)
     where coalesce(n->'attrs'->>'href', '') !~* '^https?://';
    if found then
      raise exception 'A link must start with http:// or https://';
    end if;
  end if;

  insert into public.workflow_task_actions
         (workflow_id, task_id, kind, actor_staff_id, recipient, sender, subject, body)
  values (p_workflow_id, p_task_id, p_kind, public.current_staff_id(),
          btrim(p_recipient), nullif(btrim(p_sender), ''), nullif(btrim(p_subject), ''), p_body)
  returning id into v_id;

  return v_id;
end $fn$;

comment on function public.record_task_action(uuid, uuid, text, text, text, text, jsonb) is
  'Record an action taken from a task''s Tools tab. Today p_kind is ''email'' only. The actor is stamped from the session and never accepted as a parameter. p_body is an optional document on a NARROWER node list than a post''s: no mention, entity, image or attachment. It MAY carry a `textStyle` mark whose fontFamily is one of six offered stacks and whose color is six hex digits — the one place this schema stores a colour rather than a key, because a message''s appearance is the writer''s decision about that message and not a state this app renders. Nothing is sent by this function — it records what a person did.';
