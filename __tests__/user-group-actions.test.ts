import { beforeEach, describe, expect, test, vi } from 'vitest'

/**
 * The three User groups tab actions. Thin by design — the database holds every
 * rule — so what is pinned is the shape of what travels: which function, which
 * keys, the sentinel that lets an emptied member list mean "remove everyone",
 * and the revalidations, including the `'page'` argument a dynamic route needs.
 */
const log: { call: string; args: unknown }[] = []
let failure: string | null = null
let rpcData: unknown = null

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('next/headers', () => ({ cookies: async () => ({ getAll: () => [], set: () => {} }) }))
vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: async () => ({
    rpc: async (name: string, args: Record<string, unknown>) => {
      log.push({ call: `rpc:${name}`, args })
      return { data: failure ? null : rpcData, error: failure ? { message: failure } : null }
    },
  }),
}))

const { createUserGroup, saveUserGroupDetails, addUserGroupMember, removeUserGroupMember, addUsersToUserGroup } =
  await import('@/app/(shell)/admin/actions')
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
  rpcData = null
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

describe('membership, one person at a time', () => {
  /**
   * INCREMENTAL, not a set-replace. At 100-200 users a Save that carries the
   * whole membership lets two administrators silently revert each other; these
   * calls carry no opinion about anybody they were not asked about.
   */
  test('adding and removing each name exactly one person and one group', async () => {
    expect(await addUserGroupMember(UG, S1)).toEqual({ ok: true })
    expect(log).toEqual([{ call: 'rpc:add_user_group_member', args: { p_user_group_id: UG, p_staff_id: S1 } }])
    log.length = 0
    expect(await removeUserGroupMember(UG, S1)).toEqual({ ok: true })
    expect(log).toEqual([{ call: 'rpc:remove_user_group_member', args: { p_user_group_id: UG, p_staff_id: S1 } }])
  })

  test('neither touches the set-replacing function the checkbox box used', async () => {
    await addUserGroupMember(UG, S1)
    await removeUserGroupMember(UG, S1)
    expect(log.map((l) => l.call)).not.toContain('rpc:set_user_group_members')
  })

  test('a malformed group or person never reaches the database', async () => {
    expect(await addUserGroupMember('north', S1)).toEqual({ error: 'No user group selected.' })
    expect(await addUserGroupMember(UG, 'reece')).toEqual({ error: 'No person selected.' })
    expect(await removeUserGroupMember('north', S1)).toEqual({ error: 'No user group selected.' })
    expect(await removeUserGroupMember(UG, 'reece')).toEqual({ error: 'No person selected.' })
    expect(log).toEqual([])
  })

  test('both revalidate the admin page, and neither does on a refusal', async () => {
    await addUserGroupMember(UG, S1)
    expect(vi.mocked(revalidatePath).mock.calls).toEqual([['/admin']])
    vi.mocked(revalidatePath).mockClear()
    failure = 'Only an administrator can manage user groups'
    expect(await removeUserGroupMember(UG, S1)).toEqual({ error: failure })
    expect(revalidatePath).not.toHaveBeenCalled()
  })
})

describe('addUsersToUserGroup', () => {
  /* ADDITIVE: the function it calls only ever adds, which is what makes it safe
     to press from a list somebody else may be editing. */
  test('sends every chosen person to the additive function', async () => {
    rpcData = 2
    expect(await addUsersToUserGroup(UG, [S1, S2])).toEqual({ ok: true, added: 2 })
    expect(log).toEqual([
      { call: 'rpc:add_user_group_members', args: { p_user_group_id: UG, p_staff_ids: [S1, S2] } },
    ])
  })

  /* The count comes from the DATABASE, not from the length of the list: the
     difference is everybody who was already a member. */
  test('it reports how many rows were really written, not how many were ticked', async () => {
    rpcData = 1
    expect(await addUsersToUserGroup(UG, [S1, S2])).toEqual({ ok: true, added: 1 })
    rpcData = null
    expect(await addUsersToUserGroup(UG, [S1])).toEqual({ ok: true, added: 0 })
  })

  test('an empty selection, a bad group and a bad person are refused before any round trip', async () => {
    expect(await addUsersToUserGroup(UG, [])).toEqual({ error: 'Choose at least one person.' })
    expect(await addUsersToUserGroup('north', [S1])).toEqual({ error: 'Choose a user group.' })
    expect(await addUsersToUserGroup(UG, [S1, 'reece'])).toEqual({ error: 'Choose people from the list.' })
    expect(log).toEqual([])
  })

  test('the database’s sentence comes back verbatim', async () => {
    failure = 'Only an active staff member can join a user group'
    expect(await addUsersToUserGroup(UG, [S1])).toEqual({ error: failure })
    expect(revalidatePath).not.toHaveBeenCalled()
  })
})
