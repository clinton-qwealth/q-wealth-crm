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

/** Every select above, named, so a test can walk them without repeating them. */
export const ADMIN_SELECTS: Readonly<Record<string, { from: string; select: string }>> = {
  'user groups': { from: 'user_groups', select: USER_GROUPS_SELECT },
  'workflow templates': { from: 'workflow_templates', select: TEMPLATES_SELECT },
}
