import { beforeEach, describe, expect, test, vi } from 'vitest'

/**
 * `setGroupUserGroup` — putting a household in a territory, or taking it out.
 *
 * "None" has to reach the database as `null`, not `''`: the function's rule is
 * "null clears", and an empty string would be cast as a uuid and refused with
 * a sentence about the wrong thing.
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

const { setGroupUserGroup } = await import('@/app/(shell)/groups/actions')
const { revalidatePath } = await import('next/cache')

const G = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const UG = '11111111-1111-4111-8111-111111111111'

beforeEach(() => {
  log.length = 0
  failure = null
  vi.mocked(revalidatePath).mockClear()
})

describe('setGroupUserGroup', () => {
  test('sends the household and the group to the one function', async () => {
    expect(await setGroupUserGroup(G, UG)).toEqual({ ok: true })
    expect(log).toEqual([{ call: 'rpc:set_client_group_user_group', args: { p_group_id: G, p_user_group_id: UG } }])
  })

  test('None travels as null, not as an empty string', async () => {
    await setGroupUserGroup(G, null)
    expect(log[0]!.args).toEqual({ p_group_id: G, p_user_group_id: null })
  })

  test('a malformed id on either side never reaches the database', async () => {
    expect(await setGroupUserGroup('g1', UG)).toEqual({ error: 'No group selected.' })
    expect(await setGroupUserGroup(G, 'north')).toEqual({ error: 'Choose a user group.' })
    expect(log).toEqual([])
  })

  /* The household's page, the index a limited colleague may now lose it from,
     and the admin tab that counts households — with `'page'` on the dynamic one. */
  test('success revalidates the group page, the index and the admin page', async () => {
    await setGroupUserGroup(G, UG)
    expect(vi.mocked(revalidatePath).mock.calls).toEqual([['/groups/[id]', 'page'], ['/groups'], ['/admin']])
  })

  test('the database’s sentence comes back verbatim, and nothing is revalidated', async () => {
    failure = 'No such user group, or it has been archived'
    expect(await setGroupUserGroup(G, UG)).toEqual({ error: failure })
    expect(revalidatePath).not.toHaveBeenCalled()
  })
})
