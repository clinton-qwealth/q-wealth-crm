-- The account drawer's migrations landed on the seventeenth (17 Sep 2026)
--
-- A correction, not a change. The two migrations before this one were drafted
-- as 18 September and applied on the 17th, and their object comments said the
-- 18th in six places: financial_accounts_summary, group_account_posts,
-- workflow_posts_summary, the workflow_posts table and its account_id column,
-- and validate_post_body().
--
-- Restated here rather than edited into those files alone, because the comment
-- in the database is the one the next person reads — `\d+` and the schema
-- browser show it, the file does not. Both were corrected; this migration is
-- what makes the database agree with the repository.
--
-- Nothing else differs. No structure, no policy, no grant.

comment on view public.financial_accounts_summary is
  'One row per account: owners rolled up, the latest valuation and its thirty-day baseline, and since 16 Sep 2026 the current state a provider feed maintains — cash, product, allocation — plus the provenance of the figure and the owners as id/name pairs. Since 17 Sep 2026 it also carries value_series, the valuations of the thirty days up to and including the latest one, for the drawer''s chart. The valuation columns are looked up per account with LATERAL, not through financial_account_latest_valuation; see the 10 September migration for why.';

comment on view public.group_account_posts is
  'Every post on an account owned by a CURRENT member of the group, keyed by group so the group page reads it in its first wave. security_invoker throughout: workflow_posts_summary defers to workflow_posts, which defers to staff_can_access_account(). Added 17 Sep 2026 with the account drawer''s Activity tab.';

comment on view public.workflow_posts_summary is
  'Posts with the author named, mentions resolved to current names, reactions grouped by kind with who gave each, the media each post carries, the entities it names, and its place in a thread — parent_post_id, root_post_id and the name of the person being answered. Carries account_id since 17 Sep 2026; exactly one of workflow_id and account_id is set. security_invoker: RLS on workflow_posts decides, deferring to the workflow or to staff_can_access_account().';

comment on table public.workflow_posts is
  'A post on a workflow''s timeline — optionally about one of its tasks — or, since 17 Sep 2026, on a financial account. Exactly one of workflow_id and account_id is set, by check constraint. Optionally in reply to another post. Append-only. body is a structured document validated by validate_post_body(); a heading in a post is level 1 and there is only one size. body_text is the derived plain text. The name is historical: it carries account posts too.';

comment on column public.workflow_posts.account_id is
  'The financial account this post is about, when it is about one. Exactly one of this and workflow_id is set. An account post carries no task, no files and no entity chips in v1 — see the migration of 17 Sep 2026.';

comment on function public.validate_post_body(jsonb) is
  'Everything a post document must be, and nothing about where it lives: the node and mark whitelist, one heading size, callout tones, http(s) links, chip shape, files named by id and never by address, image widths, and some actual words. Raises with the sentence the writer should read. Lifted out of post_workflow_activity on 17 Sep 2026 so the account write path could not hold a second copy. Pure — it writes nothing.';
