-- The notes belonging to a client group (6 Sep 2026)
--
-- A note reaches a group two ways: it names the group directly, or it names a
-- party who is a current member of it. Both count, and a note that does both
-- must appear once — hence the UNION inside the lateral, which dedupes.
--
-- THE BODY AND THE TRANSCRIPT ARE DELIBERATELY ABSENT. This view backs a list
-- of note headers; the content of a client meeting has no business travelling
-- to the browser to render a date and an author. Reading a note in full will be
-- its own path, with its own decision about what is shown.
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
  w.status       as workflow_status
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
  'Note headers for a client group, reached either directly or through a member party. security_invoker, so notes RLS decides what is visible. Carries no body or transcript by design.';

-- Supabase's default privileges grant every new object in schema public to
-- anon; a view is no exception and the WHERE guards inside would not save it.
revoke all on public.group_notes_summary from anon, public;
grant select on public.group_notes_summary to authenticated;
