/**
 * A staff member's photo: where it lives, what it may be, how it is named.
 *
 * Pure, so both the browser (which uploads) and the server (which signs) read
 * the same constants. The database holds the same limits in
 * `staff_avatar_size_limit()` / `staff_avatar_mime_types()`, and a test reads
 * the migration to keep the two lists identical — the bucket is the rule, these
 * are the courtesy check that says so before a round trip.
 */
export const STAFF_AVATAR_BUCKET = 'staff-avatars'
export const STAFF_AVATAR_SIZE_LIMIT = 2 * 1024 * 1024
export const STAFF_AVATAR_MIME_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const

export type StaffAvatarMime = (typeof STAFF_AVATAR_MIME_TYPES)[number]

export function isStaffAvatarType(mime: string): mime is StaffAvatarMime {
  return (STAFF_AVATAR_MIME_TYPES as readonly string[]).includes(mime)
}

/** From the MIME type, never the filename: the filename is whatever the user called it. */
export function avatarExtension(mime: StaffAvatarMime): 'png' | 'jpg' | 'webp' {
  return mime === 'image/png' ? 'png' : mime === 'image/jpeg' ? 'jpg' : 'webp'
}

/** `<staff id>/<uuid>.<ext>` — the shape the column's check constraint pins. */
export function staffAvatarPath(staffId: string, mime: StaffAvatarMime): string {
  return `${staffId}/${crypto.randomUUID()}.${avatarExtension(mime)}`
}

/**
 * Where the browser fetches the photo from. The route re-checks access and
 * redirects to a signed URL with a short browser cache; `?v=` is the CACHE
 * KEY — without it a replaced photo would show stale for the cache window.
 * The route ignores the query.
 */
export function staffAvatarUrl(staffId: string, avatarPath: string): string {
  const basename = avatarPath.slice(avatarPath.lastIndexOf('/') + 1)
  return `/api/staff-avatar/${staffId}?v=${encodeURIComponent(basename)}`
}
