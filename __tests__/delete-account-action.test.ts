import { beforeEach, describe, expect, test, vi } from 'vitest'
import { revalidatePath } from 'next/cache'

/**
 * `deleteAccount` — what reaches the database, and what does not.
 *
 * The one thing worth pinning is an ABSENCE: the word the reader typed is not
 * sent. It is an arming gate in the dialog, and a `p_confirmation` argument
 * would imply the server had checked something it had not. The database's
 * rules — access, and the trigger that refuses a fed account — are the rules,
 * and they bind the MCP and psql, which type nothing.
 */
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

const { deleteAccount } = await import('@/app/(shell)/groups/actions')

beforeEach(() => {
  calls.length = 0
  failure = null
  vi.mocked(revalidatePath).mockClear()
})

describe('deleteAccount', () => {
  test('calls the one function, with the id and nothing else', async () => {
    const res = await deleteAccount('a1')
    expect(calls).toHaveLength(1)
    expect(calls[0].name).toBe('delete_financial_account')
    /* Exact object: no typed word, no reason, no cascade instructions. */
    expect(calls[0].args).toEqual({ p_account_id: 'a1' })
    expect(res).toEqual({ ok: true })
  })

  test('and revalidates the group route pattern, not one path', async () => {
    await deleteAccount('a1')
    expect(revalidatePath).toHaveBeenCalledTimes(1)
    expect(revalidatePath).toHaveBeenCalledWith('/groups/[id]', 'page')
  })

  /* Passed through unrewritten: the sentence names the provider and says what
     to do instead, which is exactly the part a rewrite would lose. */
  test('a refusal is the database’s sentence, verbatim, with nothing revalidated', async () => {
    failure = 'This account is maintained by the HUB24 feed, so it cannot be deleted here. Close it at the provider instead.'
    const res = await deleteAccount('a1')
    expect(res).toEqual({ error: failure })
    expect(revalidatePath).not.toHaveBeenCalled()
  })

  test('an empty id is refused before any round trip', async () => {
    const res = await deleteAccount('')
    expect(res).toEqual({ error: 'No account selected.' })
    expect(calls).toHaveLength(0)
    expect(revalidatePath).not.toHaveBeenCalled()
  })
})
