import { beforeEach, describe, expect, test, vi } from 'vitest'

/**
 * The search route handler.
 *
 * **A route handler is a front door of its own**, and a new door does not
 * inherit the locks: the proxy says of itself that it is not the authorisation
 * boundary, and the shell layout's two-factor gate covers pages, not this. So
 * the gates are asserted here rather than assumed from the page around it.
 *
 * What is NOT asserted here is who may see which rows. That is row-level
 * security's answer, it is given in the database, and no amount of testing this
 * handler would prove it.
 */
const claims = vi.fn()
const search = vi.fn()

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: async () => ({ auth: { getClaims: claims } }),
}))

vi.mock('@/lib/search', async (original) => ({
  ...(await original<typeof import('@/lib/search')>()),
  searchEverything: (...args: unknown[]) => search(...args),
}))

const { GET } = await import('@/app/api/search/route')
const { EMPTY_RESULTS } = await import('@/lib/search')

const call = (q: string) => GET(new Request(`https://example.test/api/search?q=${encodeURIComponent(q)}`))

beforeEach(() => {
  claims.mockReset()
  search.mockReset()
  search.mockResolvedValue(EMPTY_RESULTS)
})

describe('the search route', () => {
  /**
   * **The gate is on missing CLAIMS, never on `error`.**
   *
   * With no session at all `getClaims()` returns `{ data: null, error: null }`
   * — no error — so a gate written on the error waves every anonymous caller
   * straight through. That is the mutation that matters most on this file, and
   * it is the same trap the proxy carries a test for.
   */
  test('an anonymous caller is refused, and the database is never asked', async () => {
    claims.mockResolvedValue({ data: null, error: null })
    const res = await call('testsmith')

    expect(res.status).toBe(403)
    expect(search, 'it searched for somebody with no session').not.toHaveBeenCalled()
  })

  /* `aal === 'aal2'`, not "step-up not required": the latter reads false for
     somebody with no factor at all, who is single-factor and should be refused. */
  test('a single-factor session is refused', async () => {
    claims.mockResolvedValue({ data: { claims: { sub: 'u1', aal: 'aal1' } }, error: null })
    const res = await call('testsmith')

    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({ error: 'A verified second factor is required.' })
    expect(search).not.toHaveBeenCalled()
  })

  test('a two-factor session searches, and gets its results back', async () => {
    claims.mockResolvedValue({ data: { claims: { sub: 'u1', aal: 'aal2' } }, error: null })
    search.mockResolvedValue({ ...EMPTY_RESULTS, workflows: [{ id: 'w1', title: 'A', detail: null, href: '/workflows/w1' }] })

    const res = await call('annual')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.results.workflows[0].title).toBe('A')
    expect(search).toHaveBeenCalledWith(expect.anything(), 'annual')
  })

  /* One keystroke must not sweep the database. The loader refuses it too; this
     is the same rule enforced before the call rather than inside it. */
  test('a query below the minimum is answered without a search', async () => {
    claims.mockResolvedValue({ data: { claims: { sub: 'u1', aal: 'aal2' } }, error: null })

    const res = await call('a')
    expect(res.status).toBe(200)
    expect((await res.json()).results).toEqual(EMPTY_RESULTS)
    expect(search).not.toHaveBeenCalled()
  })

  test('and so is an empty one', async () => {
    claims.mockResolvedValue({ data: { claims: { sub: 'u1', aal: 'aal2' } }, error: null })
    const res = await GET(new Request('https://example.test/api/search'))
    expect(res.status).toBe(200)
    expect(search).not.toHaveBeenCalled()
  })
})
