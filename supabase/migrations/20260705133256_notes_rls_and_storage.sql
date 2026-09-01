-- extend permission lookup with the new flag
create or replace function public.current_staff_has(p_permission text)
returns boolean
language plpgsql
security definer
stable
set search_path = ''
as $$
declare
  v_ok boolean;
begin
  if public.is_elevated_context() then
    return true;
  end if;
  select case p_permission
           when 'view_sensitive' then ap.view_sensitive
           when 'view_all_groups' then ap.view_all_groups
           when 'manage_groups' then ap.manage_groups
           when 'manage_staff' then ap.manage_staff
           when 'admin' then ap.manage_staff
           when 'file_unmatched_notes' then ap.file_unmatched_notes
           else false
         end
    into v_ok
  from public.staff_users su
  join public.access_profiles ap on ap.id = su.profile_id
  where su.auth_user_id = (select auth.uid())
    and su.status = 'active';
  return coalesce(v_ok, false);
end;
$$;

-- Can the caller see a given note?
-- matched: any linked subject is accessible, or caller authored it
-- unmatched: caller is the host, or holds file_unmatched_notes (Services/Admin)
create or replace function public.staff_can_access_note(p_note_id uuid)
returns boolean
language plpgsql
security definer
stable
set search_path = ''
as $$
declare
  v_staff uuid;
  v_note record;
begin
  if public.is_elevated_context() then
    return true;
  end if;
  v_staff := public.current_staff_id();
  if v_staff is null then
    return false;
  end if;
  select match_status, author_staff_id, host_staff_id into v_note
  from public.notes where id = p_note_id;
  if not found then
    return false;
  end if;
  if v_note.author_staff_id = v_staff then
    return true;
  end if;
  if v_note.match_status = 'unmatched' then
    return v_note.host_staff_id = v_staff or public.current_staff_has('file_unmatched_notes');
  end if;
  return exists (
    select 1 from public.note_subjects ns
    where ns.note_id = p_note_id
      and (
        (ns.party_id is not null and public.staff_can_access_party(ns.party_id))
        or (ns.group_id is not null and public.staff_can_access_group(ns.group_id))
      )
  );
end;
$$;
revoke all on function public.staff_can_access_note(uuid) from public, anon;
grant execute on function public.staff_can_access_note(uuid) to authenticated, service_role;
revoke all on function public.enforce_note_append_only() from public, anon, authenticated;

-- RLS
alter table public.notes enable row level security;
alter table public.note_subjects enable row level security;
alter table public.note_attachments enable row level security;

create policy notes_select on public.notes
  for select to authenticated using (public.staff_can_access_note(id));
create policy notes_insert on public.notes
  for insert to authenticated
  with check (
    public.is_active_staff()
    and source = 'manual'
    and author_staff_id = public.current_staff_id()
  );
-- update permitted only for filing (trigger restricts to match_status); no delete policy
create policy notes_update_filing on public.notes
  for update to authenticated
  using (public.staff_can_access_note(id))
  with check (public.staff_can_access_note(id));

create policy note_subjects_select on public.note_subjects
  for select to authenticated using (public.staff_can_access_note(note_id));
create policy note_subjects_insert on public.note_subjects
  for insert to authenticated
  with check (
    public.staff_can_access_note(note_id)
    and (party_id is null or public.staff_can_access_party(party_id))
    and (group_id is null or public.staff_can_access_group(group_id))
  );

create policy note_attachments_select on public.note_attachments
  for select to authenticated using (public.staff_can_access_note(note_id));
-- attachments are created by the integration webhook (service role) only: no insert policy for staff

-- Private storage bucket for recordings
insert into storage.buckets (id, name, public)
values ('note-media', 'note-media', false)
on conflict (id) do nothing;

-- Staff may read files only for notes they can access (web app uses signed URLs / authenticated reads)
create policy note_media_read on storage.objects
  for select to authenticated
  using (
    bucket_id = 'note-media'
    and exists (
      select 1 from public.note_attachments na
      where na.storage_path = storage.objects.name
        and public.staff_can_access_note(na.note_id)
    )
  );
-- no insert/update/delete policies for staff: uploads come from the webhook via service role
