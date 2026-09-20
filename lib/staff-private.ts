/**
 * The one-row embed from `staff_private_details`, read the same way by
 * `getCurrentStaff()` (the person's own row) and `getStaffForAdmin()` (every
 * row, for an administrator).
 *
 * Tolerated as an object, an array or nothing — nothing for a person whose
 * details were never written, and nothing for a reader row-level security keeps
 * out, which is the whole reason the table exists apart from `staff_users`.
 *
 * A plain module with no dependencies, so it can be imported by both readers
 * without either importing the other, and so a test that mocks one of them
 * wholesale is not obliged to re-export this.
 */
export function privateDateOfBirth(embed: unknown): string | null {
  const one = (Array.isArray(embed) ? embed[0] : embed) as { date_of_birth?: string | null } | null | undefined
  return one?.date_of_birth ?? null
}
