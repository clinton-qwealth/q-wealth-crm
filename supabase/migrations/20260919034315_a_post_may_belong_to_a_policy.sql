-- A post may belong to a policy (19 Sep 2026)
--
-- The insurance-policy drawer gets the account drawer's Activity tab, and the
-- posts table gets its THIRD scope. The second — accounts, 17 September — is
-- the template, and its migration said this would be "one number": the check
-- constraint counts non-null scope columns and insists on exactly one, so a new
-- scope is a new column and a new count.
--
-- Everything that made the second scope safe carries over unchanged:
--
-- * The posts are the same object. Mentions, reactions and replies key off
--   post_id alone, so a policy post can be reacted to, replied to and mention a
--   colleague with no change to any of those tables or functions.
-- * The rules about what a post may CONTAIN are `validate_post_body()`, shared;
--   the rules about where it may LIVE are the write path's, per scope. So this
--   adds `post_policy_activity()` as a SIBLING of `post_account_activity()`,
--   not a generalised function with three nullable ids — each scope has its own
--   access function, its own reply sentence and its own page to revalidate,
--   and a general one would re-implement in plpgsql the exactly-one rule the
--   constraint already states.
-- * Access is one branch per scope in the two RLS policies, each deferring to
--   the function that already means "can this staff member see this record":
--   `staff_can_access_policy()`, which the policies table's own policies use.
-- * The summary view appends its new column LAST. `create or replace view`
--   keeps every existing column at its name, type and position; the 17 Sep
--   draft learned that by putting a column in the middle and being refused.
-- * The group-keyed read joins the page's first wave. `group_policy_posts` is
--   `group_account_posts` with `insurance_policy_parties` in place of
--   `financial_account_owners` — any role, owner or life insured, because the
--   policy is on the page through either.
--
-- THE NO-TASK CHECK IS RESTATED, NOT EXTENDED. It was `account_id is null or
-- task_id is null`; it becomes `task_id is null or workflow_id is not null`,
-- which says the same thing for this and every later scope without editing: a
-- task belongs to a workflow, so only a workflow post may name one.
--
-- The existing account and workflow write paths need NO change. Their parent
-- checks compare with `is distinct from`, so a policy post as a parent — whose
-- account_id and workflow_id are both null — is refused as "a reply belongs to
-- the same …" exactly as an account parent is refused by the workflow path.
-- That is the 17 Sep `<>` lesson paying out a second time.
--
-- NO MCP RIPPLE: the edge function reads neither `workflow_posts_summary` nor
-- any posts view, and its insurance read touches only the policies, their
-- parties and their covers. Recorded so the next person does not re-check.

-- ---------------------------------------------------------------------------
-- 1. The third scope
-- ---------------------------------------------------------------------------

alter table public.workflow_posts
  add column policy_id uuid references public.insurance_policies(id) on delete cascade,
  drop constraint workflow_posts_has_one_scope,
  add constraint workflow_posts_has_one_scope
    check (num_nonnulls(workflow_id, account_id, policy_id) = 1),
  drop constraint workflow_posts_account_has_no_task,
  add constraint workflow_posts_only_workflow_has_task
    check (task_id is null or workflow_id is not null);

create index workflow_posts_policy_created_idx
  on public.workflow_posts (policy_id, created_at desc, id desc)
  where policy_id is not null;

comment on table public.workflow_posts is
  'A post on a workflow''s timeline — optionally about one of its tasks — or, since 17 Sep 2026, on a financial account, or, since 19 Sep 2026, on an insurance policy. Exactly one of workflow_id, account_id and policy_id is set, by check constraint; only a workflow post may name a task. Optionally in reply to another post. Append-only. body is a structured document validated by validate_post_body(); a heading in a post is level 1 and there is only one size. body_text is the derived plain text. The name is historical: it carries account and policy posts too.';
comment on column public.workflow_posts.policy_id is
  'The insurance policy this post is about, when it is about one. Exactly one of this, account_id and workflow_id is set. A policy post carries no task, no files and no entity chips in v1 — see the migration of 19 Sep 2026.';

-- ---------------------------------------------------------------------------
-- 2. Row-level security: a third branch, not a weaker rule
-- ---------------------------------------------------------------------------

drop policy workflow_posts_select on public.workflow_posts;
create policy workflow_posts_select on public.workflow_posts
  for select to authenticated
  using (
    (workflow_posts.workflow_id is not null
      and exists (select 1 from public.workflows w where w.id = workflow_posts.workflow_id))
    or
    (workflow_posts.account_id is not null
      and public.staff_can_access_account(workflow_posts.account_id))
    or
    (workflow_posts.policy_id is not null
      and public.staff_can_access_policy(workflow_posts.policy_id))
  );

drop policy workflow_posts_insert on public.workflow_posts;
create policy workflow_posts_insert on public.workflow_posts
  for insert to authenticated
  with check (
    public.is_active_staff()
    and author_staff_id = public.current_staff_id()
    and (
      (workflow_posts.workflow_id is not null
        and exists (select 1 from public.workflows w where w.id = workflow_posts.workflow_id))
      or
      (workflow_posts.account_id is not null
        and public.staff_can_access_account(workflow_posts.account_id))
      or
      (workflow_posts.policy_id is not null
        and public.staff_can_access_policy(workflow_posts.policy_id))
    )
  );

-- ---------------------------------------------------------------------------
-- 3. The policy write path — a sibling of post_account_activity
-- ---------------------------------------------------------------------------

create or replace function public.post_policy_activity(
  p_policy_id      uuid,
  p_body           jsonb,
  p_parent_post_id uuid default null
) returns uuid
language plpgsql
security invoker
set search_path = ''
as $fn$
declare
  v_id      uuid;
  v_mention uuid;
  v_root    uuid;
  v_p_pol   uuid;
begin
  if public.current_staff_id() is null then
    raise exception 'Not an active staff member';
  end if;
  if p_policy_id is null then
    raise exception 'No policy given';
  end if;

  perform public.validate_post_body(p_body);

  -- Refused HERE rather than left to fail at a claim step that does not exist:
  -- media is keyed and path-derived by workflow, and an unclaimed reference
  -- would insert cleanly and render as a broken file forever.
  perform 1
    from jsonb_path_query(p_body, 'strict $.** ? (@.type == "image" || @.type == "attachment")') as t(n);
  if found then
    raise exception 'A post on a policy cannot carry files yet';
  end if;

  -- Likewise: a chip on a policy has no group to be checked against until
  -- somebody decides which of a policy's parties' groups counts.
  perform 1
    from jsonb_path_query(p_body, 'strict $.** ? (@.type == "entity")') as t(n);
  if found then
    raise exception 'A post on a policy cannot name a client, group or workflow yet';
  end if;

  -- The policy must be one this staff member can see. RLS on the insert would
  -- refuse it anyway; this is the readable sentence in front of that.
  if not public.staff_can_access_policy(p_policy_id) then
    raise exception 'No such policy, or not within your access';
  end if;

  if p_parent_post_id is not null then
    select p.policy_id, coalesce(p.root_post_id, p.id)
      into v_p_pol, v_root
      from public.workflow_posts p
     where p.id = p_parent_post_id;
    if v_root is null then
      raise exception 'No such post to reply to, or not within your access';
    end if;
    -- `is distinct from`, not `<>`: a workflow or account parent has a NULL
    -- policy_id, and `<>` against NULL is NULL, which would let the reply
    -- through. The 17 Sep lesson, applied on the day it was written down.
    if v_p_pol is distinct from p_policy_id then
      raise exception 'A reply belongs to the same policy as the post it answers';
    end if;
  end if;

  insert into public.workflow_posts
         (policy_id, author_staff_id, body, parent_post_id, root_post_id)
  values (p_policy_id, public.current_staff_id(), p_body,
          p_parent_post_id, v_root)
  returning id into v_id;

  for v_mention in
    select distinct (n->'attrs'->>'id')::uuid
      from jsonb_path_query(p_body, 'strict $.** ? (@.type == "mention")') as t(n)
     where n->'attrs'->>'id' is not null
  loop
    if not exists (select 1 from public.staff_directory d where d.id = v_mention) then
      raise exception 'Mentioned person is not a staff member';
    end if;
    insert into public.workflow_post_mentions (post_id, staff_id) values (v_id, v_mention);
  end loop;

  return v_id;
end $fn$;

comment on function public.post_policy_activity(uuid, jsonb, uuid) is
  'Post to an insurance policy''s activity, optionally in reply to another post on the same policy. Same document rules as every other post — validate_post_body() is shared — minus files and entity chips, which are refused with a sentence saying not yet. Mentions, reactions and replies work exactly as they do on a workflow or an account, because all three key off post_id alone. A sibling of post_account_activity, not a generalisation of it; see the migration of 19 Sep 2026 for why.';

revoke all on function public.post_policy_activity(uuid, jsonb, uuid) from public, anon;
grant execute on function public.post_policy_activity(uuid, jsonb, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. The summary view carries the third scope — appended LAST
-- ---------------------------------------------------------------------------

create or replace view public.workflow_posts_summary with (security_invoker = true) as
select p.id, p.workflow_id, p.task_id, p.author_staff_id,
       sd.full_name as author_name,
       p.body, p.body_text, p.created_at,
       coalesce((select jsonb_agg(jsonb_build_object('staff_id', m.staff_id, 'full_name', d.full_name) order by d.full_name)
                   from public.workflow_post_mentions m
                   join public.staff_directory d on d.id = m.staff_id
                  where m.post_id = p.id), '[]'::jsonb) as mentioned,
       coalesce((select jsonb_agg(jsonb_build_object('reaction', r.reaction, 'by', r.by) order by r.first_at)
                   from (select x.reaction,
                                min(x.created_at) as first_at,
                                jsonb_agg(jsonb_build_object('staff_id', x.staff_id, 'full_name', d.full_name) order by x.created_at) as by
                           from public.workflow_post_reactions x
                           join public.staff_directory d on d.id = x.staff_id
                          where x.post_id = p.id
                          group by x.reaction) r), '[]'::jsonb) as reactions,
       coalesce((select jsonb_agg(jsonb_build_object(
                          'id', f.id, 'kind', f.kind, 'name', f.original_name,
                          'mime_type', f.mime_type, 'byte_size', f.byte_size,
                          'width', f.width, 'height', f.height,
                          'redacted_at', f.redacted_at,
                          'redacted_by_name', rb.full_name) order by f.created_at)
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
       pa.full_name as parent_author_name,
       p.account_id,

       -- ── appended 19 September 2026, LAST ───────────────────────────────
       p.policy_id
  from public.workflow_posts p
  left join public.staff_directory sd on sd.id = p.author_staff_id
  left join public.workflow_posts pp on pp.id = p.parent_post_id
  left join public.staff_directory pa on pa.id = pp.author_staff_id;

comment on view public.workflow_posts_summary is
  'Posts with the author named, mentions resolved to current names, reactions grouped by kind with who gave each, the media each post carries, the entities it names, and its place in a thread — parent_post_id, root_post_id and the name of the person being answered. Carries account_id since 17 Sep 2026 and policy_id since 19 Sep 2026; exactly one of workflow_id, account_id and policy_id is set. security_invoker: RLS on workflow_posts decides, deferring to the workflow, to staff_can_access_account() or to staff_can_access_policy().';

revoke all on public.workflow_posts_summary from public, anon, authenticated;
grant select on public.workflow_posts_summary to authenticated;

-- ---------------------------------------------------------------------------
-- 5. The group's policy posts, in one read
-- ---------------------------------------------------------------------------
-- `group_account_posts` with the policy parties in place of the account owners,
-- for the reason written there: the group page is held to two waves, and a
-- read keyed by the policy ids would be a third. ANY role links the policy to
-- the group — a policy is on the page whether the member owns it or is the
-- life insured — so no role filter here, exactly as `group_insurance_policies`
-- has none.

create view public.group_policy_posts
with (security_invoker = true) as
select g.group_id, s.*
from (
  select distinct m.group_id, pp.policy_id
    from public.client_group_members m
    join public.insurance_policy_parties pp on pp.party_id = m.party_id
   where m.end_date is null
) g
join public.workflow_posts_summary s on s.policy_id = g.policy_id;

comment on view public.group_policy_posts is
  'Every post on a policy that a CURRENT member of the group is a party to, in any role, keyed by group so the group page reads it in its first wave. security_invoker throughout: workflow_posts_summary defers to workflow_posts, which defers to staff_can_access_policy(). Added 19 Sep 2026 with the policy drawer''s Activity tab.';

revoke all on public.group_policy_posts from public, anon, authenticated;
grant select on public.group_policy_posts to authenticated;
