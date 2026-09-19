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
    const res = await saveStaffDetails(null, form({ staff_id: 's2', full_name: '  Reece Testlee ', colour: 'blue' }))
    expect(res).toEqual({ ok: true })
    const args = log[0].args[0] as Record<string, unknown>
    expect(args.p_staff_id).toBe('s2')
    expect(patch()).toEqual({ full_name: 'Reece Testlee' })
  })

  test('lowercases and trims the email before it travels', async () => {
    await saveStaffDetails(null, form({ staff_id: 's2', email: '  Reece@QWealth.com.au ' }))
    expect(patch()).toEqual({ email: 'reece@qwealth.com.au' })
  })

  test('a blank name, a blank email, a bad status and an empty profile are refused before any round trip', async () => {
    expect(await saveStaffDetails(null, form({ staff_id: 's2', full_name: '  ' }))).toEqual({ error: 'Give the staff member a name.' })
    expect(await saveStaffDetails(null, form({ staff_id: 's2', email: ' ' }))).toEqual({ error: 'Enter an email address.' })
    expect(await saveStaffDetails(null, form({ staff_id: 's2', status: 'pending' }))).toEqual({ error: 'Choose a status.' })
    expect(await saveStaffDetails(null, form({ staff_id: 's2', profile_id: '' }))).toEqual({ error: 'Choose an access profile.' })
    expect(log).toEqual([])
  })

  test('a form with nothing to change, or no staff member, is refused', async () => {
    expect(await saveStaffDetails(null, form({ staff_id: 's2' }))).toEqual({ error: 'Nothing to save.' })
    expect(await saveStaffDetails(null, form({ full_name: 'X' }))).toEqual({ error: 'No staff member selected.' })
    expect(log).toEqual([])
  })

  test('the database’s sentence comes back verbatim, and nothing is revalidated', async () => {
    failure = 'At least one active administrator must remain'
    expect(await saveStaffDetails(null, form({ staff_id: 's1', status: 'inactive' }))).toEqual({ error: failure })
    expect(revalidatePath).not.toHaveBeenCalled()
  })

  test('success revalidates the admin page and the profile page', async () => {
    await saveStaffDetails(null, form({ staff_id: 's2', full_name: 'X' }))
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
