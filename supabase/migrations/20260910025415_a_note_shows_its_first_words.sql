-- A note shows its first words (10 Sep 2026)
--
-- The file notes list has shown a title, a date and an author since 6 September
-- and nothing of what the note SAYS. The view refused to carry the body, and
-- the reason it gave was a good one: "the content of a client meeting has no
-- business travelling to the browser to render a date and an author."
--
-- It is about to render more than a date and an author. The list gains a
-- disclosure that opens onto the note's first words, so that reason no longer
-- covers an EXCERPT -- but it still covers the whole body, and that is the line
-- this migration draws.
--
-- WHAT TRAVELS: 255 characters of the body, whitespace collapsed, cut at a word
-- boundary. WHAT DOES NOT: the rest of the body, and the transcript, which is
-- untouched and still absent from every view. A group with sixty meeting
-- summaries now ships sixty excerpts rather than sixty meetings. Reading a note
-- in full remains its own path and remains unbuilt; the list says so rather
-- than pretending the excerpt is the note.
--
-- ACCESS IS UNCHANGED. `notes` is protected per ROW by staff_can_access_note(),
-- never per column, so anybody who could already see one of these rows could
-- already have read its body by asking for it. This is a decision about what
-- the application SENDS, not about who may read what.

-- ---- two helpers, so the rule lives in one place --------------------------
--
-- Immutable and separate, which keeps the view readable and means the excerpt
-- rule can be tested on its own. The same reasoning as activity_doc_text() for
-- a post body.

create or replace function public.note_flat(p_body text)
returns text
language sql
immutable
set search_path = ''
as $$
  -- COLLAPSE FIRST, TRIM SECOND, and the order is the whole point.
  --
  -- `btrim(text)` with no second argument strips SPACES ONLY. Written the other
  -- way round -- btrim then collapse -- a body beginning with a newline keeps
  -- it, the collapse turns it into a space, and every such excerpt comes back
  -- with a leading blank. That is exactly the defect activity_doc_text() was
  -- caught with on 8 September, found there the same way: a dry run on a
  -- branch. Collapsing first means everything is a space by the time btrim
  -- runs, so its space-only default is correct by construction rather than by
  -- remembering to widen the trim set.
  select btrim(regexp_replace(coalesce(p_body, ''), '\s+', ' ', 'g'))
$$;

comment on function public.note_flat(text) is
  'A note body as one line: runs of whitespace collapsed to a single space, THEN the ends trimmed. Order matters -- btrim() strips spaces only, so trimming first would leave a leading space wherever a body opened with a newline. Exists so an excerpt counts characters of readable text rather than of newlines.';

create or replace function public.note_excerpt(p_body text, p_limit int default 255)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when length(f.flat) <= p_limit then f.flat
    -- Cut at a word boundary rather than mid-word. The coalesce is the guard
    -- for a single word longer than the whole limit: stripping its trailing
    -- fragment would leave an empty string, so that case keeps the hard cut.
    else coalesce(
      nullif(rtrim(regexp_replace(left(f.flat, p_limit), '\S+$', '')), ''),
      left(f.flat, p_limit)
    )
  end
  from (select public.note_flat(p_body) as flat) f
$$;

comment on function public.note_excerpt(text, int) is
  'The first p_limit characters of a note body, whitespace collapsed and cut at a word boundary. Lets a list show what a note says without carrying what it says in full. 255 by default, which is the length the file notes list shows.';

-- security_invoker on the view means these run as the CALLER, so the caller
-- needs execute. Supabase grants every new function to public by default.
revoke all on function public.note_flat(text) from public, anon;
revoke all on function public.note_excerpt(text, int) from public, anon;
grant execute on function public.note_flat(text) to authenticated, service_role;
grant execute on function public.note_excerpt(text, int) to authenticated, service_role;

-- ---- the view, with two columns APPENDED ----------------------------------
--
-- Appended, because that is all `create or replace view` permits: removing or
-- reordering a column would need a drop, and dropping this one would drop the
-- grants with it.
create or replace view public.group_notes_summary
with (security_invoker = true) as
select
  n.id           as note_id,
  g.group_id     as group_id,
  n.note_type    as note_type,
  n.title        as title,
  n.occurred_at  as occurred_at,
  n.created_at   as created_at,
  n.source       as source,
  n.match_status as match_status,
  sd.full_name   as author_name,
  n.workflow_id  as workflow_id,
  w.name         as workflow_name,
  w.workflow_type as workflow_type,
  w.status       as workflow_status,
  public.note_excerpt(n.body) as body_excerpt,
  -- Truncated exactly when the excerpt is not the whole flattened body. Derived
  -- rather than a second `length(...) > 255`, so the number 255 lives in one
  -- place -- the function's own default -- and the flag cannot disagree with
  -- the text beside it.
  public.note_excerpt(n.body) <> public.note_flat(n.body) as body_is_truncated
from public.notes n
join lateral (
  select ns.group_id
    from public.note_subjects ns
   where ns.note_id = n.id and ns.group_id is not null
  union
  select m.group_id
    from public.note_subjects ns
    join public.client_group_members m
      on m.party_id = ns.party_id and m.end_date is null
   where ns.note_id = n.id
) g on true
left join public.staff_directory sd on sd.id = n.author_staff_id
left join public.workflows w on w.id = n.workflow_id;

comment on view public.group_notes_summary is
  'Note headers for a client group, reached either directly or through a member party. security_invoker, so notes RLS decides what is visible. Carries a 255-character excerpt of the body since 10 Sep 2026; carries no transcript and no full body by design.';

-- Re-asserted rather than assumed, following the 7 September privilege audit.
-- `create or replace view` keeps existing grants, so this changes nothing --
-- which is the point of writing it down.
revoke all on public.group_notes_summary from anon, public;
grant select on public.group_notes_summary to authenticated;
