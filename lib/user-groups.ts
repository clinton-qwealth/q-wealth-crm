/**
 * User groups — territories — as the app names them.
 *
 * A staff member belongs to any number; a household to at most one. **Membership
 * grants, the toggle restricts**: being in a group adds its households to what a
 * person sees, and `staff_users.limited_to_user_groups` takes away the firm-wide
 * sight their profile would otherwise give. The database decides all of that
 * (`staff_can_access_group`); nothing here does.
 *
 * "User groups" rather than Clinton's word "groups", everywhere on screen and in
 * code, because a group is already a client household in this app.
 *
 * **Pure: no Supabase, no `next/headers`, no directive**, so the client
 * components that draw a territory can import it — the same split `lib/audit.ts`
 * keeps from `lib/admin.ts`, and the rule the board's `next/headers` incident
 * set. The reader that fetches the list is `getActiveUserGroups` in
 * `lib/groups.ts`, beside the other client-group reads. Putting the label map
 * here with a server import broke `npm run build` on 20 Sep 2026, which is the
 * check that catches it.
 */
export type UserGroupChoice = { id: string; name: string; status: string }

export const USER_GROUP_STATUS_LABEL: Record<string, string> = {
  active: 'Active',
  archived: 'Archived',
}
