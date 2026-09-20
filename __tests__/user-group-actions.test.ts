import { beforeEach, describe, expect, test, vi } from 'vitest'

/**
 * The three User groups tab actions. Thin by design — the database holds every
 * rule — so what is pinned is the shape of what travels: which function, which
 * keys, the sentinel that lets an emptied member list mean "remove everyone",
 * and the revalidations, including the `'page'` argument a dynamic route needs.
 */
const log: { call: string; args: unknown }[] = []
let failure: string | null = null

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('next/headers', () => ({ cookies: async () => ({ getAll: () => [], set: () => {} }) }))
vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: async () => ({
    rpc: async (name: string, args: Record<string, unknown>) => {
      log.push({ call: `rpc:${name}`, args })
      return { data: null, error: failure ? { message: failure } : null }
    },
  }),
}))

const { createUserGroup, saveUserGroupDetails, saveUserGroupMembers } = await import('@/app/(shell)/admin/actions')
const { revalidatePath } = await import('next/cache')

const UG = '11111111-1111-4111-8111-111111111111'
const S1 = '22222222-2222-4222-8222-222222222222'
const S2 = '33333333-3333-4333-8333-333333333333'

const form = (entries: Record<string, string>) => {
  const fd = new FormData()
  for (const [k, v] of Object.entries(entries)) fd.set(k, v)
  return fd
}

beforeEach(() => {
  log.length = 0
  failure = null
  vi.mocked(revalidatePath).mockClear()
})

describe('createUserGroup', () => {
  test('trims the name and calls the one function with it', async () => {
    expect(await createUserGroup(null, form({ name: '  Sydney ' }))).toEqual({ ok: true })
    expect(log).toEqual([{ call: 'rpc:create_user_group', args: { p_name: 'Sydney' } }])
    expect(vi.mocked(revalidatePath).mock.calls).toEqual([['/admin']])
  })

  test('a blank or over-long name never reaches the database', async () => {
    expect(await createUserGroup(null, form({ name: '   ' }))).toEqual({ error: 'Give the user group a name.' })
    expect(await createUserGroup(null, form({ name: 'S'.repeat(61) }))).toEqual({ error: 'Use 60 characters or fewer for the name.' })
    expect(log).toEqual([])
  })

  test('the database’s sentence comes back verbatim, and nothing is revalidated', async () => {
    failure = 'A user group with that name already exists'
    expect(await createUserGroup(null, form({ name: 'Sydney' }))).toEqual({ error: failure })
    expect(revalidatePath).not.toHaveBeenCalled()
  })
})

describe('saveUserGroupDetails', () => {
  test('forwards only the keys the form carried', async () => {
    await saveUserGroupDetails(null, form({ user_group_id: UG, name: ' North ' }))
    expect(log).toEqual([{ call: 'rpc:update_user_group_patch', args: { p_user_group_id: UG, p_patch: { name: 'North' } } }])
    log.length = 0
    await saveUserGroupDetails(null, form({ user_group_id: UG, status: 'archived' }))
    expect(log[0]!.args).toEqual({ p_user_group_id: UG, p_patch: { status: 'archived' } })
  })

  test('refuses a blank name, an unknown status, nothing to save, and a missing id, before any round trip', async () => {
    expect(await saveUserGroupDetails(null, form({ user_group_id: UG, name: ' ' }))).toEqual({ error: 'Give the user group a name.' })
    expect(await saveUserGroupDetails(null, form({ user_group_id: UG, status: 'deleted' }))).toEqual({ error: 'Choose a status.' })
    expect(await saveUserGroupDetails(null, form({ user_group_id: UG }))).toEqual({ error: 'Nothing to save.' })
    expect(await saveUserGroupDetails(null, form({ name: 'North' }))).toEqual({ error: 'No user group selected.' })
    expect(log).toEqual([])
  })

  /* A rename shows on every household's page and on the index. `'page'` is
     what makes the dynamic route's revalidation actually match. */
  test('success revalidates the admin page, every group page, and the index', async () => {
    await saveUserGroupDetails(null, form({ user_group_id: UG, name: 'North' }))
    expect(vi.mocked(revalidatePath).mock.calls).toEqual([['/admin'], ['/groups/[id]', 'page'], ['/groups']])
  })

  test('the database’s sentence comes back verbatim', async () => {
    failure = 'Only an administrator can manage user groups'
    expect(await saveUserGroupDetails(null, form({ user_group_id: UG, name: 'North' }))).toEqual({ error: failure })
    expect(revalidatePath).not.toHaveBeenCalled()
  })
})

describe('saveUserGroupMembers', () => {
  test('sends the ticked members as a set', async () => {
    const fd = form({ user_group_id: UG, members_present: '1' })
    fd.append('staff_ids', S1)
    fd.append('staff_ids', S2)
    expect(await saveUserGroupMembers(null, fd)).toEqual({ ok: true })
    expect(log).toEqual([{ call: 'rpc:set_user_group_members', args: { p_user_group_id: UG, p_staff_ids: [S1, S2] } }])
    expect(vi.mocked(revalidatePath).mock.calls).toEqual([['/admin']])
  })

  /* THE sentinel case: every box unticked is "remove everyone", and it must
     reach the database as an empty list rather than as nothing to save. */
  test('the sentinel alone means remove everyone; no sentinel means nothing to save', async () => {
    await saveUserGroupMembers(null, form({ user_group_id: UG, members_present: '1' }))
    expect(log).toEqual([{ call: 'rpc:set_user_group_members', args: { p_user_group_id: UG, p_staff_ids: [] } }])
    log.length = 0
    expect(await saveUserGroupMembers(null, form({ user_group_id: UG }))).toEqual({ error: 'Nothing to save.' })
    expect(log).toEqual([])
  })

  test('a member id that is not a uuid, or a missing group, never reaches the database', async () => {
    const fd = form({ user_group_id: UG, members_present: '1' })
    fd.append('staff_ids', 'reece')
    expect(await saveUserGroupMembers(null, fd)).toEqual({ error: 'Choose members from the list.' })
    expect(await saveUserGroupMembers(null, form({ members_present: '1' }))).toEqual({ error: 'No user group selected.' })
    expect(log).toEqual([])
  })
})
