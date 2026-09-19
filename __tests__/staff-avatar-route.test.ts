import { beforeEach, describe, expect, test, vi } from 'vitest'

/**
 * The staff-avatar route. A route handler is a front door of its own, so the
 * gates are asserted here rather than assumed from the pages around it.
 */
const claims = vi.fn()
const maybeSingle = vi.fn()
const createSignedUrl = vi.fn()

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: async () => ({
    auth: { getClaims: claims },
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle }) }) }),
    storage: { from: () => ({ createSignedUrl }) },
  }),
}))

const { GET } = await import('@/app/api/staff-avatar/[staffId]/route')
const ID = '33333333-0000-4000-8000-000000000001'
const call = (id = ID) => GET(new Request(`https://example.test/api/staff-avatar/${id}`), { params: Promise.resolve({ staffId: id }) })

beforeEach(() => {
  claims.mockReset()
  maybeSingle.mockReset()
  createSignedUrl.mockReset()
  claims.mockResolvedValue({ data: { claims: { sub: 'u1', aal: 'aal2' } }, error: null })
  maybeSingle.mockResolvedValue({ data: { avatar_path: `${ID}/photo.png` }, error: null })
  createSignedUrl.mockResolvedValue({ data: { signedUrl: 'https://storage.test/signed' }, error: null })
})

describe('the staff-avatar route', () => {
  /* Gated on missing CLAIMS, never on `error`: with no session getClaims()
     returns no data and no error. */
  test('refuses an anonymous caller without asking the database', async () => {
    claims.mockResolvedValue({ data: null, error: null })
    const res = await call()
    expect(res.status).toBe(403)
    expect(maybeSingle).not.toHaveBeenCalled()
  })

  test('refuses a single-factor session', async () => {
    claims.mockResolvedValue({ data: { claims: { sub: 'u1', aal: 'aal1' } }, error: null })
    expect((await call()).status).toBe(403)
    expect(maybeSingle).not.toHaveBeenCalled()
  })

  test('a malformed id is not found, before any query', async () => {
    expect((await call('not-a-uuid')).status).toBe(404)
    expect(maybeSingle).not.toHaveBeenCalled()
  })

  test('a person with no photo, or no visible row, is not found — the same answer', async () => {
    maybeSingle.mockResolvedValue({ data: { avatar_path: null }, error: null })
    expect((await call()).status).toBe(404)
    maybeSingle.mockResolvedValue({ data: null, error: null })
    expect((await call()).status).toBe(404)
    expect(createSignedUrl).not.toHaveBeenCalled()
  })

  test('redirects to a short-lived signed URL with a private cache just inside its life', async () => {
    const res = await call()
    expect(res.status).toBe(302)
    expect(res.headers.get('Location')).toBe('https://storage.test/signed')
    expect(res.headers.get('Cache-Control')).toBe('private, max-age=240')
    expect(res.headers.get('Vary')).toBe('Cookie')
    expect(createSignedUrl).toHaveBeenCalledWith(`${ID}/photo.png`, 300)
  })
})
