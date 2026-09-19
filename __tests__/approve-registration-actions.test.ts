import { beforeEach, describe, expect, test, vi } from 'vitest'

/**
 * `approveStaffRegistration` and `declineStaffRegistration`.
 *
 * Approve is its own database function — status and assignment in one
 * transaction. Decline is Phase 2's patch function with one key, so the
 * rules that already refuse a return to pending govern it. Both refuse a
 * malformed id at the door and pass the database's sentence back unchanged.
 */
const log: { call: string; args: unknown }[] = []
let failure: string | null = null

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('next/headers', () => ({ cookies: async () => ({ getAll: () => [], set: () => {} }) }))
vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: async () => ({
    rpc: async (name: string, args: unknown) => {
      log.push({ call: name, args })
      return { data: null, error: failure ? { message: failure } : null }
    },
    auth: { getClaims: async () => ({ data: null }) },
  }),
}))

const { approveStaffRegistration, declineStaffRegistration } = await import('@/app/(shell)/admin/actions')
const { revalidatePath } = await import('next/cache')

const STAFF = '11111111-1111-4111-8111-111111111111'
const PROFILE = '22222222-2222-4222-8222-222222222222'

beforeEach(() => {
  log.length = 0
  failure = null
  vi.mocked(revalidatePath).mockClear()
})

describe('approveStaffRegistration', () => {
  test('calls the approval function with both ids and refreshes the page', async () => {
    await expect(approveStaffRegistration(STAFF, PROFILE)).resolves.toEqual({ ok: true })
    expect(log).toEqual([{ call: 'approve_staff_registration', args: { p_staff_id: STAFF, p_profile_id: PROFILE } }])
    expect(revalidatePath).toHaveBeenCalledWith('/admin')
  })

  test('refuses a missing profile and a malformed id before any round trip', async () => {
    await expect(approveStaffRegistration(STAFF, '')).resolves.toEqual({ error: 'Choose an access profile.' })
    await expect(approveStaffRegistration('nope', PROFILE)).resolves.toEqual({ error: 'No request selected.' })
    expect(log).toEqual([])
  })

  test('the database’s sentence is the answer, and nothing is refreshed', async () => {
    failure = 'This request has already been decided'
    await expect(approveStaffRegistration(STAFF, PROFILE)).resolves.toEqual({ error: 'This request has already been decided' })
    expect(revalidatePath).not.toHaveBeenCalled()
  })
})

describe('declineStaffRegistration', () => {
  test('is the patch function with exactly one key', async () => {
    await expect(declineStaffRegistration(STAFF)).resolves.toEqual({ ok: true })
    expect(log).toEqual([{ call: 'update_staff_patch', args: { p_staff_id: STAFF, p_patch: { status: 'inactive' } } }])
    expect(revalidatePath).toHaveBeenCalledWith('/admin')
  })

  test('refuses a malformed id before any round trip', async () => {
    await expect(declineStaffRegistration('x')).resolves.toEqual({ error: 'No request selected.' })
    expect(log).toEqual([])
  })
})
