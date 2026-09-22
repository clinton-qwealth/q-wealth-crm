import { beforeEach, describe, expect, test, vi } from 'vitest'

/**
 * `setGroupUserGroups` — which territories a household belongs to.
 *
 * SET-REPLACING, so an empty array is meaningful rather than a no-op: it takes
 * the household out of every territory. That is the one shape a caller can get
 * wrong by "helpfully" skipping the call.
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

const { setGroupUserGroups } = await import('@/app/(shell)/groups/actions')
const { revalidatePath } = await import('next/cache')

const G = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const UG = '11111111-1111-4111-8111-111111111111'
const UG2 = '22222222-2222-4222-8222-222222222222'

beforeEach(() => {
  log.length = 0
  failure = null
  vi.mocked(revalidatePath).mockClear()
})

describe('setGroupUserGroups', () => {
  test('sends the household and the whole set to the one function', async () => {
    expect(await setGroupUserGroups(G, [UG, UG2])).toEqual({ ok: true })
    expect(log).toEqual([
      { call: 'rpc:set_client_group_user_groups', args: { p_group_id: G, p_user_group_ids: [UG, UG2] } },
    ])
  })

  /* An empty array is the instruction "belong to none", not an absent one. */
  test('an empty set travels, and is not mistaken for nothing to do', async () => {
    expect(await setGroupUserGroups(G, [])).toEqual({ ok: true })
    expect(log[0]!.args).toEqual({ p_group_id: G, p_user_group_ids: [] })
  })

  test('a repeated id is sent once', async () => {
    await setGroupUserGroups(G, [UG, UG, UG2])
    expect(log[0]!.args).toEqual({ p_group_id: G, p_user_group_ids: [UG, UG2] })
  })

  test('a malformed id on either side never reaches the database', async () => {
    expect(await setGroupUserGroups('g1', [UG])).toEqual({ error: 'No group selected.' })
    expect(await setGroupUserGroups(G, [UG, 'north'])).toEqual({ error: 'Choose user groups from the list.' })
    expect(log).toEqual([])
  })

  /* The household's page, the index a limited colleague may now lose it from,
     and the admin tab that counts households — with `'page'` on the dynamic one. */
  test('success revalidates the group page, the index and the admin page', async () => {
    await setGroupUserGroups(G, [UG])
    expect(vi.mocked(revalidatePath).mock.calls).toEqual([['/groups/[id]', 'page'], ['/groups'], ['/admin']])
  })

  test('the database’s sentence comes back verbatim, and nothing is revalidated', async () => {
    failure = 'No such user group, or it has been archived'
    expect(await setGroupUserGroups(G, [UG])).toEqual({ error: failure })
    expect(revalidatePath).not.toHaveBeenCalled()
  })
})
