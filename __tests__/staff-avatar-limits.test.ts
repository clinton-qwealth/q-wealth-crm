import { describe, expect, test } from 'vitest'
import { migrationSource } from './helpers/migration'
import { avatarExtension, isStaffAvatarType, STAFF_AVATAR_MIME_TYPES, STAFF_AVATAR_SIZE_LIMIT, staffAvatarPath, staffAvatarUrl } from '@/lib/avatar'

/**
 * The bucket is the rule; the client's checks are the courtesy. The two must
 * name the same types and the same size, and the only way to know that
 * without a browser is to read the migration.
 */
const sql = migrationSource('staff_can_be_managed')

describe('the photo limits', () => {
  test('every type the client accepts is in the bucket’s list, and the size matches', () => {
    for (const mime of STAFF_AVATAR_MIME_TYPES) expect(sql).toContain(`'${mime}'`)
    expect(sql).toContain(`select ${STAFF_AVATAR_SIZE_LIMIT}::bigint`)
    /* And nothing that can carry script. */
    expect(sql).not.toContain('image/svg+xml')
    expect(isStaffAvatarType('image/svg+xml')).toBe(false)
  })

  test('the path is the staff id, a uuid and an extension from the MIME type', () => {
    const path = staffAvatarPath('s1', 'image/jpeg')
    expect(path).toMatch(/^s1\/[0-9a-f-]{36}\.jpg$/)
    expect(avatarExtension('image/png')).toBe('png')
    expect(avatarExtension('image/webp')).toBe('webp')
  })

  /* The `?v=` is the cache key: without it a replaced photo shows stale for the cache window. */
  test('the URL is the app’s own route, keyed by the object name', () => {
    expect(staffAvatarUrl('s1', 's1/abc.png')).toBe('/api/staff-avatar/s1?v=abc.png')
  })
})
