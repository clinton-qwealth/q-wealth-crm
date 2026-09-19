-- The directory names a person in two parts (19 Sep 2026)
--
-- M2 of three. M1 added `first_name` and `last_name` alongside `full_name` and
-- changed nothing that reads. This file takes `full_name` OUT OF THE VIEWS —
-- and only the views. The COLUMN survives until M3, so a Vercel rollback to the
-- previous build still has a populated `staff_users.full_name` to write to and
-- the transition trigger still reconciles it.
--
--   M1 → deploy the MCP function → deploy the app → M2 (this file) → M3
--
-- DO NOT APPLY THIS BEFORE THE APP IS DEPLOYED. The deployed app selects
-- `staff_directory.full_name`; this file removes that column.
--
-- ---------------------------------------------------------------------------
-- Why this is a DROP and not a REPLACE
-- ---------------------------------------------------------------------------
-- `create or replace view` can only APPEND columns. Removing one needs a drop,
-- and a dropped view loses four things a replace would have kept: its grants,
-- its `security_invoker` setting, its comment, and — for the two children that
-- were created from `select s.*` — the column list frozen at their creation.
-- All four are restored explicitly below. Migration 20260831114103 exists
-- because a rebuilt view silently became definer-rights.
--
-- THE NINE DEPENDENTS ARE DROPPED BY NAME, AND THE DIRECTORY WITH `restrict`.
-- Not `cascade`. The dependency set was read out of `pg_depend` rather than
-- inferred from the migrations: seven at depth 1 and two at depth 2, each
-- holding exactly SELECT for `authenticated`. If anything outside that list
-- depends on the directory — a view somebody made by hand, something left on a
-- branch — `restrict` fails and NAMES it, where `cascade` would destroy it
-- silently and nothing here would put it back.
--
-- ---------------------------------------------------------------------------
-- What does NOT change
-- ---------------------------------------------------------------------------
-- The DISPLAY COLUMNS KEEP THEIR NAMES. `owner_name`, `author_name`,
-- `actor_name`, `assigned_to_name`, `requested_by_name`, `outcome_by_name`,
-- `parent_author_name` and `redacted_by_name` are projections that already have
-- their own names; each simply reads `staff_display_name(first, last)` instead
-- of a column. No application select changes because of this file.
--
-- `workflow_posts_summary` goes on emitting BOTH JSON keys, `full_name` and
-- `name`. The key is not flipped until M3, so a rollback degrades to a missing
-- name rather than a crash.

-- ---------------------------------------------------------------------------
-- 1. Down, deepest first
-- ---------------------------------------------------------------------------

drop view if exists public.group_policy_posts;
drop view if exists public.group_account_posts;

drop view if exists public.audit_entries;
drop view if exists public.group_notes_summary;
drop view if exists public.identity_verification_summary;
drop view if exists public.workflow_board;
drop view if exists public.workflow_posts_summary;
drop view if exists public.workflow_task_actions_summary;
drop view if exists public.workflow_tasks_summary;

-- RESTRICT, deliberately. See the header.
drop view public.staff_directory restrict;

-- ---------------------------------------------------------------------------
-- 2. The directory, in two parts
-- ---------------------------------------------------------------------------

create view public.staff_directory
with (security_invoker = true) as
  select su.id, su.email, su.status, su.avatar_path, su.first_name, su.last_name
  from public.staff_users su;

comment on view public.staff_directory is
  'A least-exposure convenience over staff_users, not an access boundary; security_invoker so the caller''s own RLS applies. Carries avatar_path since 19 Sep 2026 so a name anywhere can grow a photo later without a migration. Names a person in two parts since 19 Sep 2026; compose with staff_display_name(), which is what every view below does.';

revoke all on public.staff_directory from public, anon;
grant select on public.staff_directory to authenticated;

-- ---------------------------------------------------------------------------
-- 3. The seven that read it directly
-- ---------------------------------------------------------------------------

create view public.audit_entries
with (security_invoker = true) as
  select a.id,
         a.occurred_at,
         a.table_name,
         a.record_id,
         a.action,
         a.changed_fields,
         a.old_data,
         a.new_data,
         a.actor_staff_id,
         a.actor_context,
         public.staff_display_name(sd.first_name, sd.last_name) as actor_name,
         coalesce(public.audit_record_label(a.table_name, coalesce(a.new_data, a.old_data)),
                  (select public.audit_record_label(b.table_name, coalesce(b.new_data, b.old_data))
                     from public.audit_log b
                    where b.table_name = public.audit_label_table(a.table_name)
                      and b.record_id = a.record_id
                      and b.occurred_at <= a.occurred_at
                      and public.audit_record_label(b.table_name, coalesce(b.new_data, b.old_data)) is not null
                    order by b.occurred_at desc, b.id desc
                    limit 1)) as record_label
    from public.audit_log a
    left join public.staff_directory sd on sd.id = a.actor_staff_id;

comment on view public.audit_entries is
  'audit_log with the actor named from staff_directory and the record labelled from the trail itself — this row''s payload, else the latest earlier row on the same record or its parent that carried a name. security_invoker: admin_read_audit_log on audit_log decides. Newest-first pages read this with a (occurred_at, id) cursor. Added 19 Sep 2026 for the Administration page.';

revoke all on public.audit_entries from public, anon;
grant select on public.audit_entries to authenticated;

create view public.group_notes_summary
with (security_invoker = true) as
  select n.id as note_id,
         g.group_id,
         n.note_type,
         n.title,
         n.occurred_at,
         n.created_at,
         n.source,
         n.match_status,
         public.staff_display_name(sd.first_name, sd.last_name) as author_name,
         n.workflow_id,
         w.name as workflow_name,
         w.workflow_type,
         w.status as workflow_status,
         public.note_excerpt(n.body) as body_excerpt,
         public.note_excerpt(n.body) <> public.note_flat(n.body) as body_is_truncated
    from public.notes n
    join lateral (select ns.group_id
                    from public.note_subjects ns
                   where ns.note_id = n.id and ns.group_id is not null
                  union
                  select m.group_id
                    from public.note_subjects ns
                    join public.client_group_members m on m.party_id = ns.party_id and m.end_date is null
                   where ns.note_id = n.id) g on true
    left join public.staff_directory sd on sd.id = n.author_staff_id
    left join public.workflows w on w.id = n.workflow_id;

comment on view public.group_notes_summary is
  'Note headers for a client group, reached either directly or through a member party. security_invoker, so notes RLS decides what is visible. Carries a 255-character excerpt of the body since 10 Sep 2026; carries no transcript and no full body by design.';

revoke all on public.group_notes_summary from public, anon;
grant select on public.group_notes_summary to authenticated;

create view public.identity_verification_summary
with (security_invoker = true) as
  select v.id,
         v.party_id,
         v.group_id,
         v.channel,
         v.provider,
         public.mask_phone(v.destination) as destination_masked,
         v.status,
         v.attempts,
         v.failure_reason,
         v.requested_at,
         v.requested_by_staff_id,
         public.staff_display_name(rq.first_name, rq.last_name) as requested_by_name,
         v.outcome_source,
         v.outcome_at,
         v.outcome_by_staff_id,
         public.staff_display_name(oc.first_name, oc.last_name) as outcome_by_name
    from public.identity_verification v
    left join public.staff_directory rq on rq.id = v.requested_by_staff_id
    left join public.staff_directory oc on oc.id = v.outcome_by_staff_id;

comment on view public.identity_verification_summary is
  'Verification history for the Activity tab. The destination is masked, so the full mobile number never leaves identity_verification itself. provider distinguishes a real send from a stubbed one.';

revoke all on public.identity_verification_summary from public, anon;
grant select on public.identity_verification_summary to authenticated;

create view public.workflow_board
with (security_invoker = true) as
  select w.id,
         w.group_id,
         g.name as group_name,
         w.workflow_type,
         w.name,
         w.status,
         w.owner_staff_id,
         public.staff_display_name(sd.first_name, sd.last_name) as owner_name,
         w.started_at,
         w.completed_at,
         w.created_at,
         w.updated_at,
         w.priority,
         w.due_at,
         w.description
    from public.workflows w
    join public.client_groups g on g.id = w.group_id
    left join public.staff_directory sd on sd.id = w.owner_staff_id;

comment on view public.workflow_board is
  'Workflows across all groups the caller can see, with group and owner named, for the Kanban board. security_invoker.';

revoke all on public.workflow_board from public, anon;
grant select on public.workflow_board to authenticated;

-- The feed. Both JSON keys until M3, and the mention order now reads as a
-- directory: surname, then given name. That is a deliberate change to the order
-- names appear in, not a side effect of the rewrite — `order by d.full_name`
-- has no successor once the column is gone, and sorting on the composed string
-- would sort by first name.
create view public.workflow_posts_summary
with (security_invoker = true) as
select p.id, p.workflow_id, p.task_id, p.author_staff_id,
       public.staff_display_name(sd.first_name, sd.last_name) as author_name,
       p.body, p.body_text, p.created_at,
       coalesce((select jsonb_agg(jsonb_build_object(
                          'staff_id', m.staff_id,
                          'full_name', public.staff_display_name(d.first_name, d.last_name),
                          'name', public.staff_display_name(d.first_name, d.last_name))
                        order by d.last_name, d.first_name)
                   from public.workflow_post_mentions m
                   join public.staff_directory d on d.id = m.staff_id
                  where m.post_id = p.id), '[]'::jsonb) as mentioned,
       coalesce((select jsonb_agg(jsonb_build_object('reaction', r.reaction, 'by', r.by) order by r.first_at)
                   from (select x.reaction,
                                min(x.created_at) as first_at,
                                jsonb_agg(jsonb_build_object(
                                  'staff_id', x.staff_id,
                                  'full_name', public.staff_display_name(d.first_name, d.last_name),
                                  'name', public.staff_display_name(d.first_name, d.last_name)) order by x.created_at) as by
                           from public.workflow_post_reactions x
                           join public.staff_directory d on d.id = x.staff_id
                          where x.post_id = p.id
                          group by x.reaction) r), '[]'::jsonb) as reactions,
       coalesce((select jsonb_agg(jsonb_build_object(
                          'id', f.id, 'kind', f.kind, 'name', f.original_name,
                          'mime_type', f.mime_type, 'byte_size', f.byte_size,
                          'width', f.width, 'height', f.height,
                          'redacted_at', f.redacted_at,
                          'redacted_by_name', public.staff_display_name(rb.first_name, rb.last_name)) order by f.created_at)
                   from public.workflow_post_media f
                   left join public.staff_directory rb on rb.id = f.redacted_by
                  where f.post_id = p.id), '[]'::jsonb) as media,
       coalesce((select jsonb_agg(jsonb_build_object(
                          'kind', e.kind,
                          'entity_id', e.entity_id,
                          'label', case e.kind
                                     when 'client'   then (select c.display_name from public.clients c where c.party_id = e.entity_id)
                                     when 'group'    then (select g.name from public.group_summary g where g.group_id = e.entity_id)
                                     when 'workflow' then (select w.name from public.workflows w where w.id = e.entity_id)
                                   end) order by e.kind, e.entity_id)
                   from public.workflow_post_entities e
                  where e.post_id = p.id), '[]'::jsonb) as entities,
       p.parent_post_id,
       p.root_post_id,
       public.staff_display_name(pa.first_name, pa.last_name) as parent_author_name,
       p.account_id,
       p.policy_id
  from public.workflow_posts p
  left join public.staff_directory sd on sd.id = p.author_staff_id
  left join public.workflow_posts pp on pp.id = p.parent_post_id
  left join public.staff_directory pa on pa.id = pp.author_staff_id;

comment on view public.workflow_posts_summary is
  'Posts with the author named, mentions resolved to current names, reactions grouped by kind with who gave each, the media each post carries, the entities it names, and its place in a thread — parent_post_id, root_post_id and the name of the person being answered. Carries account_id since 17 Sep 2026 and policy_id since 19 Sep 2026; exactly one of workflow_id, account_id and policy_id is set. Mentions and reactions carry both a full_name and a name key until M3, so the previous build keeps working. security_invoker: RLS on workflow_posts decides, deferring to the workflow, to staff_can_access_account() or to staff_can_access_policy().';

revoke all on public.workflow_posts_summary from public, anon;
grant select on public.workflow_posts_summary to authenticated;

create view public.workflow_task_actions_summary
with (security_invoker = true) as
  select a.id,
         a.workflow_id,
         a.task_id,
         a.kind,
         a.actor_staff_id,
         public.staff_display_name(sd.first_name, sd.last_name) as actor_name,
         a.recipient,
         a.sender,
         a.subject,
         a.body,
         a.body_text,
         a.occurred_at
    from public.workflow_task_actions a
    left join public.staff_directory sd on sd.id = a.actor_staff_id;

comment on view public.workflow_task_actions_summary is
  'A task''s recorded actions with the actor named. security_invoker, so RLS on workflow_task_actions — and through it the workflow''s — decides. Behind the task panel''s History tab.';

revoke all on public.workflow_task_actions_summary from public, anon;
grant select on public.workflow_task_actions_summary to authenticated;

create view public.workflow_tasks_summary
with (security_invoker = true) as
  select t.id,
         t.workflow_id,
         t.task_type,
         t.subject,
         t.description,
         t.comment,
         t.due_at,
         t.status,
         t.assigned_to_staff_id,
         public.staff_display_name(sd.first_name, sd.last_name) as assigned_to_name,
         t.completed_at,
         t.created_at,
         t.updated_at,
         t.priority
    from public.workflow_tasks t
    left join public.staff_directory sd on sd.id = t.assigned_to_staff_id;

comment on view public.workflow_tasks_summary is
  'A workflow''s tasks with the assignee named. security_invoker: RLS on workflow_tasks — and through it on workflows — decides.';

revoke all on public.workflow_tasks_summary from public, anon;
grant select on public.workflow_tasks_summary to authenticated;

-- ---------------------------------------------------------------------------
-- 4. The two that read workflow_posts_summary — LAST, and column by column
-- ---------------------------------------------------------------------------
-- Both were written as `select s.*`, which freezes the parent's column list at
-- CREATE time. `group_account_posts` was created before `policy_id` existed and
-- therefore does not carry it; `group_policy_posts` was created after and does.
-- Written out here so that difference is deliberate and survives the rebuild,
-- rather than depending on what `s.*` happens to expand to today.

create view public.group_account_posts
with (security_invoker = true) as
  select g.group_id,
         s.id,
         s.workflow_id,
         s.task_id,
         s.author_staff_id,
         s.author_name,
         s.body,
         s.body_text,
         s.created_at,
         s.mentioned,
         s.reactions,
         s.media,
         s.entities,
         s.parent_post_id,
         s.root_post_id,
         s.parent_author_name,
         s.account_id
    from (select distinct m.group_id, o.account_id
            from public.client_group_members m
            join public.financial_account_owners o on o.party_id = m.party_id
           where m.end_date is null) g
    join public.workflow_posts_summary s on s.account_id = g.account_id;

comment on view public.group_account_posts is
  'Every post on an account owned by a CURRENT member of the group, keyed by group so the group page reads it in its first wave. security_invoker throughout: workflow_posts_summary defers to workflow_posts, which defers to staff_can_access_account(). Added 17 Sep 2026 with the account drawer''s Activity tab.';

revoke all on public.group_account_posts from public, anon;
grant select on public.group_account_posts to authenticated;

create view public.group_policy_posts
with (security_invoker = true) as
  select g.group_id,
         s.id,
         s.workflow_id,
         s.task_id,
         s.author_staff_id,
         s.author_name,
         s.body,
         s.body_text,
         s.created_at,
         s.mentioned,
         s.reactions,
         s.media,
         s.entities,
         s.parent_post_id,
         s.root_post_id,
         s.parent_author_name,
         s.account_id,
         s.policy_id
    from (select distinct m.group_id, pp.policy_id
            from public.client_group_members m
            join public.insurance_policy_parties pp on pp.party_id = m.party_id
           where m.end_date is null) g
    join public.workflow_posts_summary s on s.policy_id = g.policy_id;

comment on view public.group_policy_posts is
  'Every post on a policy that a CURRENT member of the group is a party to, in any role, keyed by group so the group page reads it in its first wave. security_invoker throughout: workflow_posts_summary defers to workflow_posts, which defers to staff_can_access_policy(). Added 19 Sep 2026 with the policy drawer''s Activity tab.';

revoke all on public.group_policy_posts from public, anon;
grant select on public.group_policy_posts to authenticated;

-- ---------------------------------------------------------------------------
-- 5. Prove it, or abort
-- ---------------------------------------------------------------------------
-- Ten views back, each invoker-rights, each readable by `authenticated` and by
-- nobody else, and none of them still naming the column this file removed. The
-- grant and the reloption are the two a drop silently loses, so they are the
-- two asserted rather than assumed.

do $$
declare
  v_names text[] := array['staff_directory','audit_entries','group_notes_summary',
                          'identity_verification_summary','workflow_board','workflow_posts_summary',
                          'workflow_task_actions_summary','workflow_tasks_summary',
                          'group_account_posts','group_policy_posts'];
  v_name   text;
  v_oid    oid;
  v_bad    text := '';
begin
  foreach v_name in array v_names loop
    -- Reset, because `select ... into` LEAVES THE OLD VALUE when it finds no
    -- row: without this, a missing view would be checked against the previous
    -- one's oid and pass.
    v_oid := null;
    select c.oid into v_oid
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relname = v_name and c.relkind = 'v';
    if v_oid is null then
      raise exception 'View public.% did not come back', v_name;
    end if;

    if not exists (select 1 from pg_class c2
                    where c2.oid = v_oid
                      and c2.reloptions @> array['security_invoker=true']) then
      v_bad := v_bad || v_name || ' (not security_invoker); ';
    end if;

    if not has_table_privilege('authenticated', v_oid, 'select') then
      v_bad := v_bad || v_name || ' (authenticated cannot select); ';
    end if;
    if has_table_privilege('anon', v_oid, 'select') then
      v_bad := v_bad || v_name || ' (anon can select); ';
    end if;
  end loop;

  if v_bad <> '' then
    raise exception 'Views came back wrong: %', v_bad;
  end if;

  -- The directory no longer names it, and the feed's JSON key still does — the
  -- key is flipped in M3, not here.
  if pg_get_viewdef('public.staff_directory'::regclass, true) like '%full_name%' then
    raise exception 'staff_directory still projects full_name';
  end if;
  if pg_get_viewdef('public.workflow_posts_summary'::regclass, true) not like '%full_name%' then
    raise exception 'workflow_posts_summary must keep emitting the full_name JSON key until M3';
  end if;

  -- M2 must NOT drop the column. A rollback to the previous build still writes it.
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'staff_users' and column_name = 'full_name') then
    raise exception 'staff_users.full_name must survive M2 — it is dropped in M3';
  end if;
end $$;
