import { beforeEach, describe, expect, test, vi } from 'vitest'

/**
 * The address lookup route handler.
 *
 * This is a front door of its own — the proxy only bounces sessionless
 * visitors and says of itself that it is not the authorisation boundary, and
 * the shell layout's MFA gate covers pages, not this. So the checks live here,
 * and the memo that keeps them cheap is exactly the kind of optimisation that
 * can quietly become a hole.
 */
const staffQuery = vi.fn()
const claims = vi.fn()

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: async () => ({
    auth: { getClaims: claims },
    from: () => ({
      select: () => ({
        eq: () => ({ eq: () => ({ maybeSingle: staffQuery }) }),
      }),
    }),
  }),
}))

vi.mock('@/lib/address', () => ({
  addressLookupConfigured: () => true,
  suggestAddresses: async () => [{ place_id: 'p1', label: '12 Bay Street' }],
  resolveAddress: async () => ({
    line1: '12 Bay Street', line2: '', suburb: 'Mosman', state: 'NSW', postcode: '2088',
  }),
}))

const { GET } = await import('@/app/api/address/route')

const url = (q = '12 bay street') =>
  new Request(`https://example.test/api/address?q=${encodeURIComponent(q)}&token=t`)

function signedIn(aal: string, sub = 'user-1') {
  claims.mockResolvedValue({ data: { claims: { sub, aal } }, error: null })
}

beforeEach(() => {
  staffQuery.mockReset()
  claims.mockReset()
})

describe('who the address lookup will serve', () => {
  test('no session is refused', async () => {
    claims.mockResolvedValue({ data: null, error: { message: 'no session' } })
    expect((await GET(url())).status).toBe(403)
    expect(staffQuery).not.toHaveBeenCalled()
  })

  /* A password-only session must not reach an endpoint that spends money —
     the lesson from the identity-verification edge function. */
  test('a single-factor session is refused', async () => {
    signedIn('aal1')
    const res = await GET(url())
    expect(res.status).toBe(403)
    expect((await res.json()).error).toMatch(/second factor/i)
    // Refused before the staff lookup: no round trip spent on a bad caller.
    expect(staffQuery).not.toHaveBeenCalled()
  })

  test('a signed-in non-staff account is refused', async () => {
    signedIn('aal2', 'stranger')
    staffQuery.mockResolvedValue({ data: null })
    expect((await GET(url())).status).toBe(403)
  })

  /**
   * The property that makes the memo safe. A refusal must NOT be remembered,
   * or a momentary blip would lock somebody out for a minute — and worse, the
   * inverse mistake would keep serving a deactivated account.
   */
  test('a refusal is not cached — the next request checks again', async () => {
    signedIn('aal2', 'flapping')
    staffQuery.mockResolvedValue({ data: null })
    expect((await GET(url())).status).toBe(403)
    expect(staffQuery).toHaveBeenCalledTimes(1)

    // Now active. The refusal must not have been remembered.
    staffQuery.mockResolvedValue({ data: { id: 's1' } })
    expect((await GET(url('99 other street'))).status).toBe(200)
    expect(staffQuery).toHaveBeenCalledTimes(2)
  })

  test('active staff at aal2 are served', async () => {
    signedIn('aal2', 'good-1')
    staffQuery.mockResolvedValue({ data: { id: 's1' } })
    const res = await GET(url())
    expect(res.status).toBe(200)
    expect((await res.json()).suggestions).toHaveLength(1)
  })

  /* The point of the memo: a burst of keystrokes pays for the staff lookup
     once, not once per character. */
  test('a burst asks the database once, and says so in Server-Timing', async () => {
    signedIn('aal2', 'burst-1')
    staffQuery.mockResolvedValue({ data: { id: 's1' } })

    const first = await GET(url('12 bay street'))
    expect(staffQuery).toHaveBeenCalledTimes(1)
    expect(first.headers.get('Server-Timing')).toContain('looked up')

    for (const q of ['12 bay street n', '12 bay street no', '12 bay street nor']) {
      const res = await GET(url(q))
      expect(res.status).toBe(200)
      expect(res.headers.get('Server-Timing')).toContain('memoised')
    }
    expect(staffQuery).toHaveBeenCalledTimes(1)
  })

  test('a query under four characters is answered without calling out', async () => {
    signedIn('aal2', 'short-1')
    staffQuery.mockResolvedValue({ data: { id: 's1' } })
    const res = await GET(url('12'))
    expect((await res.json()).suggestions).toEqual([])
  })
})
