import { beforeEach, describe, expect, test, vi } from 'vitest'
import { revalidatePath } from 'next/cache'

/** `deletePolicy` — `deleteAccount`'s tests with the noun changed; see there. */
const calls: { name: string; args: Record<string, unknown> }[] = []
let failure: string | null = null

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('next/headers', () => ({ cookies: async () => ({ getAll: () => [], set: () => {} }) }))
vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: async () => ({
    rpc: async (name: string, args: Record<string, unknown>) => {
      calls.push({ name, args })
      return { error: failure ? { message: failure } : null }
    },
  }),
}))

const { deletePolicy } = await import('@/app/(shell)/groups/actions')

beforeEach(() => {
  calls.length = 0
  failure = null
  vi.mocked(revalidatePath).mockClear()
})

describe('deletePolicy', () => {
  test('calls the one function, with the id and nothing else', async () => {
    const res = await deletePolicy('pol1')
    expect(calls).toHaveLength(1)
    expect(calls[0].name).toBe('delete_insurance_policy')
    expect(calls[0].args).toEqual({ p_policy_id: 'pol1' })
    expect(res).toEqual({ ok: true })
    expect(revalidatePath).toHaveBeenCalledWith('/groups/[id]', 'page')
  })

  test('a refusal is the database’s sentence, verbatim, with nothing revalidated', async () => {
    failure = 'No such policy, or not one you have access to'
    expect(await deletePolicy('pol1')).toEqual({ error: failure })
    expect(revalidatePath).not.toHaveBeenCalled()
  })

  test('an empty id is refused before any round trip', async () => {
    expect(await deletePolicy('')).toEqual({ error: 'No policy selected.' })
    expect(calls).toHaveLength(0)
  })
})
