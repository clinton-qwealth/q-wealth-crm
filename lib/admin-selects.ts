/**
 * The PostgREST select strings the Administration page depends on.
 *
 * They live in their own module, with no imports, for one reason: a select
 * string containing an embed is a QUERY AGAINST THE DATABASE SCHEMA, and
 * whether it is valid depends on foreign keys that a migration elsewhere can
 * change without touching a line of application code. `e2e/postgrest-embeds.spec.ts`
 * probes each of these against the live API, and it can only import them if
 * importing them does not drag in `next/headers`.
 *
 * ## The failure this exists to prevent
 *
 * On 24 September 2026 the whole Administration page threw in production:
 *
 *     The user groups could not be read: Could not embed because more than one
 *     relationship was found for 'user_groups' and 'client_groups'
 *
 * Three foreign-key paths connect those two tables, and PostgREST refuses to
 * choose. The second was added on 22 September by a migration that changed no
 * TypeScript at all; nothing failed until PostgREST reloaded its schema cache
 * two days later. Every test passed throughout, because a mocked Supabase
 * client cannot know what the schema says.
 */

/**
 * User groups, with their members and how many households each holds.
 *
 * The household count goes through `client_group_user_groups` — the junction —
 * and NOT through `client_groups`. Both would compile; only one is right.
 * Nothing writes `client_groups.user_group_id` any more (the write path is
 * `set_client_group_user_groups()`), so counting that would read zero for ever
 * and look like "no households assigned" rather than like a bug.
 */
export const USER_GROUPS_SELECT =
  'id, name, status, created_at, user_group_members(staff_users(id, first_name, last_name)), client_group_user_groups(group_id)'

/** Templates, with the counts the list shows beside each one. */
export const TEMPLATES_SELECT =
  'id, name, description, status, workflow_type, published_at, workflow_template_tasks(id), workflow_template_roles(id), workflow_template_deployments(id)'

/**
 * One template, with everything the editor draws.
 *
 * `workflow_template_roles(... workflow_roles(name))` is a TWO-LEVEL embed, and
 * the second level is new as of 24 September 2026 — the name moved off the
 * junction row and onto the firm's list. That is exactly the shape of change
 * that broke the user groups select: one migration, no TypeScript, a failure
 * that appears when PostgREST next reloads. Hence its place here.
 */
export const TEMPLATE_DETAIL_SELECT =
  'id, name, description, status, workflow_type, published_at, workflow_template_roles(id, workflow_role_id, workflow_roles(name)), workflow_template_tasks(id, ordinal, subject, description, priority, role_id, due_offset_days), workflow_template_task_dependencies(task_id, depends_on_task_id), workflow_template_deployments(id)'

/**
 * The firm's roles, with how many templates use each.
 *
 * The embed runs BACK down the same foreign key the select above runs up. One
 * key, so it resolves — but it is the pair of them that makes that true, which
 * is why both are probed rather than just the one that is read more often.
 *
 * The nested `workflow_template_tasks(id)` rides the tasks' own key to the
 * junction row, the same two-level shape as the template detail above, and is
 * what lets the admin list say "7 tasks" beside "2 templates" without a second
 * read.
 */
export const WORKFLOW_ROLES_SELECT =
  'id, name, status, workflow_template_roles(template_id, workflow_template_tasks(id))'

/**
 * The published templates the deploy dialog offers.
 *
 * Not on the Administration page — it is read by `/workflows` — but it lives
 * here for the same reason the rest do, and because it names the SAME embed
 * the template editor does. It was the last place still selecting
 * `workflow_template_roles.name`, a column dropped on 24 September; nothing in
 * TypeScript said so, and only a probe against the live schema would have.
 */
export const DEPLOYABLE_TEMPLATES_SELECT =
  'id, name, description, workflow_type, workflow_template_roles(id, workflow_roles(name)), workflow_template_tasks(id, ordinal, subject, role_id, due_offset_days), workflow_template_task_dependencies(task_id, depends_on_task_id)'

/** Every select above, named, so a test can walk them without repeating them. */
export const ADMIN_SELECTS: Readonly<Record<string, { from: string; select: string }>> = {
  'user groups': { from: 'user_groups', select: USER_GROUPS_SELECT },
  'workflow templates': { from: 'workflow_templates', select: TEMPLATES_SELECT },
  'one template': { from: 'workflow_templates', select: TEMPLATE_DETAIL_SELECT },
  'the firm’s roles': { from: 'workflow_roles', select: WORKFLOW_ROLES_SELECT },
  'deployable templates': { from: 'workflow_templates', select: DEPLOYABLE_TEMPLATES_SELECT },
}
