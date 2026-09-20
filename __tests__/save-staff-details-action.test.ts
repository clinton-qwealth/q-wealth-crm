import { beforeEach, describe, expect, test, vi } from 'vitest'

/**
 * `saveStaffDetails` and `setStaffAvatar`.
 *
 * Thin by design: the database holds every rule. What is worth pinning is
 * the patch — key presence is the meaning, only the known keys travel, the
 * email is lowercased and trimmed before it does — and, for the photo, the
 * ORDER: the row first, then the bytes, and no bytes touched when the row
 * refused.
 */
const log: { call: string; args: unknown[] }[] = []
let failure: string | null = null
let rpcData: unknown = null

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('next/headers', () => ({ cookies: async () => ({ getAll: () => [], set: () => {} }) }))
vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: async () => ({
    rpc: async (name: string, args: Record<string, unknown>) => {
      log.push({ call: `rpc:${name}`, args: [args] })
      return { data: failure ? null : rpcData, error: failure ? { message: failure } : null }
    },
    storage: {
      from: (bucket: string) => ({
        remove: async (paths: string[]) => {
          log.push({ call: `remove:${bucket}`, args: [paths] })
          return { error: null }
        },
      }),
    },
  }),
}))

const { saveStaffDetails, setStaffAvatar } = await import('@/app/(shell)/admin/actions')
const { revalidatePath } = await import('next/cache')

const form = (entries: Record<string, string>) => {
  const fd = new FormData()
  for (const [k, v] of Object.entries(entries)) fd.set(k, v)
  return fd
}
const patch = () => (log.find((l) => l.call === 'rpc:update_staff_patch')!.args[0] as { p_patch: Record<string, unknown> }).p_patch

beforeEach(() => {
  log.length = 0
  failure = null
  rpcData = null
  vi.mocked(revalidatePath).mockClear()
})

describe('saveStaffDetails', () => {
  test('forwards only the keys the form carried, and only the ones the function knows', async () => {
    const res = await saveStaffDetails(null, form({ staff_id: 's2', first_name: '  Reece ', last_name: ' Testlee ', colour: 'blue' }))
    expect(res).toEqual({ ok: true })
    const args = log[0].args[0] as Record<string, unknown>
    expect(args.p_staff_id).toBe('s2')
    expect(patch()).toEqual({ first_name: 'Reece', last_name: 'Testlee' })
  })

  /* The name is two boxes since 19 Sep 2026, and each one travels on its own:
     renaming only the surname must not blank the first name. */
  test('one half of the name travels alone', async () => {
    await saveStaffDetails(null, form({ staff_id: 's2', last_name: 'Testlee-Brown' }))
    expect(patch()).toEqual({ last_name: 'Testlee-Brown' })
    log.length = 0
    await saveStaffDetails(null, form({ staff_id: 's2', first_name: 'Reece' }))
    expect(patch()).toEqual({ first_name: 'Reece' })
  })

  test('lowercases and trims the email before it travels', async () => {
    await saveStaffDetails(null, form({ staff_id: 's2', email: '  Reece@QWealth.com.au ' }))
    expect(patch()).toEqual({ email: 'reece@qwealth.com.au' })
  })

  test('a blank name part, a blank email, a bad status and an empty profile are refused before any round trip', async () => {
    expect(await saveStaffDetails(null, form({ staff_id: 's2', first_name: '  ' }))).toEqual({ error: 'Enter a first name.' })
    expect(await saveStaffDetails(null, form({ staff_id: 's2', last_name: '  ' }))).toEqual({ error: 'Enter a last name.' })
    expect(await saveStaffDetails(null, form({ staff_id: 's2', email: ' ' }))).toEqual({ error: 'Enter an email address.' })
    expect(await saveStaffDetails(null, form({ staff_id: 's2', status: 'pending' }))).toEqual({ error: 'Choose a status.' })
    expect(await saveStaffDetails(null, form({ staff_id: 's2', profile_id: '' }))).toEqual({ error: 'Choose an access profile.' })
    expect(log).toEqual([])
  })

  /**
   * The toggle's three shapes. Both inputs arrive when it is on, the hidden
   * `false` alone when it is off, and nothing at all when the box was not on
   * the form — which must leave the flag untouched, not switch it off.
   */
  test('the verify-identity toggle travels as a real boolean, and only when it was on the form', async () => {
    const both = new FormData()
    both.set('staff_id', 's2')
    both.append('verify_identity', 'false')
    both.append('verify_identity', 'true')
    await saveStaffDetails(null, both)
    expect(patch()).toEqual({ verify_identity: true })

    log.length = 0
    await saveStaffDetails(null, form({ staff_id: 's2', verify_identity: 'false' }))
    expect(patch()).toEqual({ verify_identity: false })

    log.length = 0
    await saveStaffDetails(null, form({ staff_id: 's2', email: 'x@qwealth.com.au' }))
    expect(patch(), 'absent from the form means absent from the patch').toEqual({ email: 'x@qwealth.com.au' })
  })

  /**
   * The territory toggle, 20 Sep 2026 — the same three shapes as verify-identity.
   */
  test('the limit toggle travels as a real boolean, and only when it was on the form', async () => {
    const both = new FormData()
    both.set('staff_id', 's2')
    both.append('limited_to_user_groups', 'false')
    both.append('limited_to_user_groups', 'true')
    await saveStaffDetails(null, both)
    expect(patch()).toEqual({ limited_to_user_groups: true })

    log.length = 0
    await saveStaffDetails(null, form({ staff_id: 's2', limited_to_user_groups: 'false' }))
    expect(patch()).toEqual({ limited_to_user_groups: false })

    log.length = 0
    await saveStaffDetails(null, form({ staff_id: 's2', title: 'Dr' }))
    expect(patch(), 'absent from the form means absent from the patch').toEqual({ title: 'Dr' })
  })

  /**
   * The person's user groups are a SET behind a sentinel. `getAll` returns `[]`
   * both for a picker that was never shown and for one with every box unticked;
   * the sentinel is what tells "leave them alone" from "remove them all".
   */
  test('user groups travel as a set: absent without the sentinel, empty with it alone, the ids when ticked', async () => {
    await saveStaffDetails(null, form({ staff_id: 's2', title: 'Dr' }))
    expect(patch()).not.toHaveProperty('user_group_ids')

    log.length = 0
    await saveStaffDetails(null, form({ staff_id: 's2', user_groups_present: '1' }))
    expect(patch()).toEqual({ user_group_ids: [] })

    log.length = 0
    const fd = new FormData()
    fd.set('staff_id', 's2')
    fd.set('user_groups_present', '1')
    fd.append('user_group_ids', '11111111-1111-4111-8111-111111111111')
    fd.append('user_group_ids', '22222222-2222-4222-8222-222222222222')
    await saveStaffDetails(null, fd)
    expect(patch()).toEqual({ user_group_ids: ['11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222'] })
  })

  test('a user-group id that is not a uuid never reaches the database', async () => {
    const fd = new FormData()
    fd.set('staff_id', 's2')
    fd.set('user_groups_present', '1')
    fd.append('user_group_ids', 'north')
    expect(await saveStaffDetails(null, fd)).toEqual({ error: 'Choose user groups from the list.' })
    expect(log).toEqual([])
  })

  /**
   * Two optional facts, since 20 Sep 2026. Presence is still the instruction,
   * but a present BLANK clears rather than being refused — "remove my title" has
   * to be sayable — and it travels as null so the database sees one shape.
   */
  test('a title is trimmed, and a blank one clears', async () => {
    await saveStaffDetails(null, form({ staff_id: 's2', title: '  Dr ' }))
    expect(patch()).toEqual({ title: 'Dr' })
    log.length = 0
    await saveStaffDetails(null, form({ staff_id: 's2', title: '   ' }))
    expect(patch()).toEqual({ title: null })
  })

  test('a date of birth passes through as the ISO date, and a blank one clears', async () => {
    await saveStaffDetails(null, form({ staff_id: 's2', date_of_birth: '1980-06-01' }))
    expect(patch()).toEqual({ date_of_birth: '1980-06-01' })
    log.length = 0
    await saveStaffDetails(null, form({ staff_id: 's2', date_of_birth: '' }))
    expect(patch()).toEqual({ date_of_birth: null })
  })

  test('a malformed date and an over-long title never reach the database', async () => {
    expect(await saveStaffDetails(null, form({ staff_id: 's2', date_of_birth: '01/06/1980' }))).toEqual({
      error: 'Enter the date of birth as a date.',
    })
    expect(await saveStaffDetails(null, form({ staff_id: 's2', title: 'T'.repeat(31) }))).toEqual({
      error: 'Use 30 characters or fewer for the title.',
    })
    expect(log).toEqual([])
  })

  test('a form with nothing to change, or no staff member, is refused', async () => {
    expect(await saveStaffDetails(null, form({ staff_id: 's2' }))).toEqual({ error: 'Nothing to save.' })
    expect(await saveStaffDetails(null, form({ first_name: 'X' }))).toEqual({ error: 'No staff member selected.' })
    expect(log).toEqual([])
  })

  test('the database’s sentence comes back verbatim, and nothing is revalidated', async () => {
    failure = 'At least one active administrator must remain'
    expect(await saveStaffDetails(null, form({ staff_id: 's1', status: 'inactive' }))).toEqual({ error: failure })
    expect(revalidatePath).not.toHaveBeenCalled()
  })

  test('success revalidates the admin page and the profile page', async () => {
    await saveStaffDetails(null, form({ staff_id: 's2', first_name: 'X' }))
    expect(vi.mocked(revalidatePath).mock.calls).toEqual([['/admin'], ['/profile']])
  })
})

describe('setStaffAvatar', () => {
  test('points the row at the new photo FIRST, then removes the bytes the function said it replaced', async () => {
    rpcData = 's2/old-old-old.png'
    const res = await setStaffAvatar('s2', 's2/new-new-new.png')
    expect(res).toEqual({ ok: true })
    expect(log.map((l) => l.call)).toEqual(['rpc:update_staff_patch', 'remove:staff-avatars'])
    expect(patch()).toEqual({ avatar_path: 's2/new-new-new.png' })
    expect(log[1].args[0]).toEqual(['s2/old-old-old.png'])
  })

  test('removes nothing when there was no previous photo', async () => {
    rpcData = null
    await setStaffAvatar('s2', 's2/new.png')
    expect(log.map((l) => l.call)).toEqual(['rpc:update_staff_patch'])
  })

  test('removing sends a null path, and deletes the old bytes afterwards', async () => {
    rpcData = 's2/old.png'
    await setStaffAvatar('s2', null)
    expect(patch()).toEqual({ avatar_path: null })
    expect(log.map((l) => l.call)).toEqual(['rpc:update_staff_patch', 'remove:staff-avatars'])
  })

  test('touches no bytes when the row refused', async () => {
    failure = 'That photo has not been uploaded'
    expect(await setStaffAvatar('s2', 's2/x.png')).toEqual({ error: failure })
    expect(log.map((l) => l.call)).toEqual(['rpc:update_staff_patch'])
    expect(revalidatePath).not.toHaveBeenCalled()
  })
})
