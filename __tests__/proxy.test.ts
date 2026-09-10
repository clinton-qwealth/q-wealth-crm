// @vitest-environment node
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { NextRequest } from 'next/server'

/**
 * The proxy: the first thing every request meets, and until 10 September the
 * only part of the app with no test at all.
 *
 * It has two jobs — refresh the session cookie, and bounce a visitor with no
 * verifiable session to sign in — and since 10 September it does them with
 * `getClaims()`, a local signature check, instead of `getUser()`, a round trip
 * to GoTrue on every request. The switch has one sharp edge, and it is the
 * most important assertion here: **with no session, getClaims() returns
 * `{ data: null, error: null }` — no error** — so a gate written on `error`
 * would let every anonymous visitor through. The gate is on missing claims,
 * and `anonymous visitor is redirected` is the test that would catch it.
 *
 * Node environment: `next/server`'s request and response want Node globals,
 * and the project default is jsdom.
 */
type Claims = { data: { claims: Record<string, unknown> } | null; error: { message: string } | null }

let CLAIMS: Claims = { data: null, error: null }
let captured: { cookies: { getAll: () => unknown; setAll: (c: unknown[]) => void } } | undefined
let onGetClaims: (() => void) | null = null

const getClaims = vi.fn(async () => {
  onGetClaims?.()
  return CLAIMS
})
const getUser = vi.fn(async () => ({ data: { user: null }, error: null }))

vi.mock('@/lib/env', () => ({
  SUPABASE_URL: () => 'https://project.supabase.co',
  SUPABASE_PUBLISHABLE_KEY: () => 'publishable-key',
}))
vi.mock('@supabase/ssr', () => ({
  createServerClient: vi.fn((_url: string, _key: string, opts: typeof captured) => {
    captured = opts
    return { auth: { getClaims, getUser } }
  }),
}))

const { proxy } = await import('@/proxy')

const signedIn: Claims = {
  data: { claims: { sub: 'user-1', aal: 'aal2', session_id: 's', exp: 4102444800 } },
  error: null,
}

const request = (path: string, cookie = 'sb-project-auth-token=abc') =>
  new NextRequest(`https://crm.test${path}`, { headers: cookie ? { cookie } : {} })

beforeEach(() => {
  CLAIMS = { data: null, error: null }
  captured = undefined
  onGetClaims = null
  getClaims.mockClear()
  getUser.mockClear()
})

describe('the proxy', () => {
  /** THE assertion: the no-session shape has no error, and must still redirect. */
  test('an anonymous visitor to a protected path is redirected to sign in', async () => {
    CLAIMS = { data: null, error: null }
    const res = await proxy(request('/workflows?x=1', ''))

    expect(res.status).toBe(307)
    const target = new URL(res.headers.get('location')!)
    expect(target.pathname).toBe('/login')
    // Sent back where they were headed, query string included.
    expect(target.searchParams.get('next')).toBe('/workflows?x=1')
  })

  test('a token that fails verification is treated as no session', async () => {
    CLAIMS = { data: null, error: { message: 'invalid JWT: signature mismatch' } }
    const res = await proxy(request('/groups'))
    expect(res.status).toBe(307)
    expect(new URL(res.headers.get('location')!).pathname).toBe('/login')
  })

  test('a verified session passes through, and GoTrue is never asked', async () => {
    CLAIMS = signedIn
    const res = await proxy(request('/workflows'))

    expect(res.status).toBe(200)
    expect(res.headers.get('location')).toBeNull()
    // NextResponse.next() marks a pass-through this way.
    expect(res.headers.get('x-middleware-next')).toBe('1')
    expect(getClaims).toHaveBeenCalledTimes(1)
    expect(getUser).not.toHaveBeenCalled()
  })

  test('public paths pass without a session, by segment and not by prefix', async () => {
    for (const path of ['/login', '/auth/callback', '/oauth/consent?authorization_id=a']) {
      const res = await proxy(request(path, ''))
      expect(res.status, path).toBe(200)
      expect(res.headers.get('location'), path).toBeNull()
    }
    /* `/loginx` starts with `/login` as a string and is NOT public. The check is
       `path === p || path.startsWith(p + '/')`, a segment test. */
    const res = await proxy(request('/loginx', ''))
    expect(res.status).toBe(307)
  })

  /**
   * Job 1. The Supabase client is built with a cookie adapter, and when
   * getClaims() refreshes a near-expiry token it writes the new cookie back
   * through setAll — onto the REQUEST (so the render downstream sees it) and
   * onto the RESPONSE (so the browser keeps it). This drives setAll from inside
   * the mocked getClaims and asserts the response carries the cookie.
   */
  test('a refreshed cookie written through setAll reaches the response', async () => {
    CLAIMS = signedIn
    onGetClaims = () => {
      captured!.cookies.setAll([
        { name: 'sb-project-auth-token', value: 'refreshed', options: { path: '/' } },
      ])
    }
    const res = await proxy(request('/workflows'))

    expect(res.status).toBe(200)
    expect(res.headers.get('set-cookie')).toContain('sb-project-auth-token=refreshed')
  })

  test('the client is given the request’s own cookie jar to read', async () => {
    CLAIMS = signedIn
    await proxy(request('/workflows', 'sb-project-auth-token=abc'))
    const jar = captured!.cookies.getAll() as { name: string; value: string }[]
    expect(jar.find((c) => c.name === 'sb-project-auth-token')?.value).toBe('abc')
  })

  /**
   * The only header the page path can carry, and the before/after a person
   * reads in devtools: ~170ms under getUser(), ~10ms under getClaims().
   */
  test('every response carries a Server-Timing for the auth step', async () => {
    CLAIMS = signedIn
    const passed = await proxy(request('/workflows'))
    expect(passed.headers.get('server-timing')).toMatch(/^auth;dur=\d+(\.\d+)?;desc="claims"$/)

    CLAIMS = { data: null, error: null }
    const bounced = await proxy(request('/workflows', ''))
    expect(bounced.headers.get('server-timing')).toMatch(/^auth;dur=/)
  })
})
