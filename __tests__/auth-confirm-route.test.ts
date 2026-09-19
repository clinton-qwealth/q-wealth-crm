// @vitest-environment node
import { beforeEach, describe, expect, test, vi } from 'vitest'

/**
 * `/auth/confirm` — the link in the confirmation email, and since 20 September
 * 2026 the step that finishes a registration. Until then it had **no test at
 * all**, which is part of why the defect below survived.
 *
 * Two things here are worth the file on their own.
 *
 * **A spent link must not throw away a good session.** A confirmation token is
 * single-use and this is a GET a browser may request again freely — a second
 * click, a reload, a back button, an email client unfurling the URL. The route
 * used to answer every failure with `/login?error=confirm`, including for
 * somebody who was already signed in because the *first* visit had worked.
 * Production logs for 19 September show precisely that, and the person then
 * typed their password again. That is the login screen this file exists to keep
 * out of the flow.
 *
 * **One client, or the feature is silently dead.** `verifyOtp` writes the
 * session into the client object's own cookie jar. A second
 * `createSupabaseServerClient()` would read the jar as it stood when the request
 * arrived, find nothing, and the RPC would raise `Not signed in` — and because
 * that error is deliberately swallowed for the person, nobody would ever see it.
 * `the RPC goes through the same client` is the assertion that catches it.
 *
 * Node environment: the route builds a `NextResponse`, and the project default
 * is jsdom.
 */
type VerifyResult = {
  data: { user: { id: string; user_metadata: Record<string, unknown> } | null }
  error: { message: string } | null
}

let VERIFY: VerifyResult
let CLAIMS: { data: { claims: { sub?: string } } | null }
let RPC_ERROR: { message: string; code?: string } | null
let clientsBuilt = 0

const verifyOtp = vi.fn(async () => VERIFY)
const getClaims = vi.fn(async () => CLAIMS)
const rpc = vi.fn(async () => ({ data: null, error: RPC_ERROR }))

vi.mock('next/headers', () => ({ cookies: async () => ({ getAll: () => [], set: () => {} }) }))
vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: async () => {
    clientsBuilt += 1
    return { auth: { verifyOtp, getClaims }, rpc }
  },
}))

/* Spied once, cleared per test. Re-spying in `beforeEach` returns the SAME spy
   with its calls still on it, so `toHaveBeenCalledTimes(1)` would count the
   previous test's log too — which is how "logged once" quietly becomes "logged
   at least once". */
const logged = vi.spyOn(console, 'error').mockImplementation(() => {})

const { GET } = await import('@/app/auth/confirm/route')

const visit = (query: string) => GET(new Request(`https://crm.qwealth.com.au/auth/confirm${query}`))
const user = (meta: Record<string, unknown>) => ({ id: 'auth-1', user_metadata: meta })

beforeEach(() => {
  VERIFY = { data: { user: user({ first_name: 'Nina', last_name: 'New' }) }, error: null }
  CLAIMS = { data: null }
  RPC_ERROR = null
  clientsBuilt = 0
  verifyOtp.mockClear()
  getClaims.mockClear()
  rpc.mockClear()
  logged.mockClear()
})

describe('a good confirmation link', () => {
  test('verifies with exactly the token and type it was given, and lands on the request page', async () => {
    const res = await visit('?token_hash=t-1&type=signup')
    expect(verifyOtp).toHaveBeenCalledWith({ type: 'signup', token_hash: 't-1' })
    expect(res.status).toBe(307)
    expect(res.headers.get('location')).toBe('https://crm.qwealth.com.au/request-access')
  })

  test('creates the pending request from the name the account already carries', async () => {
    await visit('?token_hash=t-1&type=signup')
    expect(rpc).toHaveBeenCalledWith('request_staff_access', { p_first_name: 'Nina', p_last_name: 'New' })
  })

  /* The whole design rests on this. See the file comment. */
  test('the RPC goes through the SAME client that verified, not a second one', async () => {
    await visit('?token_hash=t-1&type=signup')
    expect(clientsBuilt, 'one client per request, or the session is invisible to the RPC').toBe(1)
  })

  /**
   * The metadata is not ours to normalise. An account made before the name
   * split carries `full_name`, and an OAuth provider may send `given_name`.
   * Reading `first_name` off the blob directly would miss both, and the route
   * would then disagree with the prefilled form about the same account.
   */
  test('reads the pre-split and provider shapes, not just first_name', async () => {
    VERIFY = { data: { user: user({ full_name: 'Nina Van New' }) }, error: null }
    await visit('?token_hash=t-1&type=signup')
    expect(rpc).toHaveBeenCalledWith('request_staff_access', { p_first_name: 'Nina Van', p_last_name: 'New' })

    rpc.mockClear()
    VERIFY = { data: { user: user({ given_name: 'Nina', family_name: 'New' }) }, error: null }
    await visit('?token_hash=t-2&type=signup')
    expect(rpc).toHaveBeenCalledWith('request_staff_access', { p_first_name: 'Nina', p_last_name: 'New' })
  })

  test('a half-known name asks for nothing and leaves it to the form', async () => {
    VERIFY = { data: { user: user({ first_name: 'Nina' }) }, error: null }
    const res = await visit('?token_hash=t-1&type=signup')
    expect(rpc).not.toHaveBeenCalled()
    expect(res.headers.get('location')).toBe('https://crm.qwealth.com.au/request-access')
  })

  /* A password reset and an email change land here too. Neither is somebody
     asking to join, and neither may create a staff record. */
  test('only a sign-up confirmation asks to join', async () => {
    const res = await visit('?token_hash=t-1&type=recovery')
    expect(verifyOtp).toHaveBeenCalledWith({ type: 'recovery', token_hash: 't-1' })
    expect(rpc).not.toHaveBeenCalled()
    expect(res.headers.get('location')).toBe('https://crm.qwealth.com.au/request-access')
  })
})

describe('when the request cannot be created', () => {
  test('the person is not stranded — same destination, where the form is', async () => {
    RPC_ERROR = { message: 'Access requests are limited to Q Wealth staff email addresses' }
    const res = await visit('?token_hash=t-1&type=signup')
    expect(res.headers.get('location'), 'no database sentence reflected into the URL').toBe(
      'https://crm.qwealth.com.au/request-access',
    )
  })

  /* Swallowed for them, not for us: a wiring fault would otherwise be invisible
     everywhere, for everybody, indefinitely. */
  test('but it is logged once, naming the auth account and never the email', async () => {
    RPC_ERROR = { message: 'Not signed in', code: 'P0001' }
    await visit('?token_hash=t-1&type=signup')
    expect(logged).toHaveBeenCalledTimes(1)
    const line = logged.mock.calls[0]![0] as string
    expect(JSON.parse(line)).toEqual({
      event: 'request_staff_access_failed',
      auth_user_id: 'auth-1',
      code: 'P0001',
      message: 'Not signed in',
    })
  })
})

describe('a link that no longer works', () => {
  /**
   * The defect that produced the login screen. The token is spent because the
   * FIRST visit consumed it, so this person is already signed in and their
   * request already exists. Sending them to sign in again is the bug.
   */
  test('a spent token with a session in hand goes onward, not back to sign in', async () => {
    VERIFY = { data: { user: null }, error: { message: 'Token has expired or is invalid' } }
    CLAIMS = { data: { claims: { sub: 'auth-1' } } }
    const res = await visit('?token_hash=t-1&type=signup')
    expect(res.headers.get('location')).toBe('https://crm.qwealth.com.au/request-access')
    expect(rpc).not.toHaveBeenCalled()
  })

  test('a spent token with no session does go to sign in, and says why', async () => {
    VERIFY = { data: { user: null }, error: { message: 'Token has expired or is invalid' } }
    CLAIMS = { data: null }
    const res = await visit('?token_hash=t-1&type=signup')
    expect(res.headers.get('location')).toBe('https://crm.qwealth.com.au/login?error=confirm')
  })

  /* Nobody followed a link, so there is no expiry to explain. Claiming one
     would be a sentence about something that never happened. */
  test('a bare visit claims no expired link', async () => {
    const res = await visit('')
    expect(res.headers.get('location')).toBe('https://crm.qwealth.com.au/login')
    expect(verifyOtp).not.toHaveBeenCalled()
  })

  test('a token with no type is treated the same way', async () => {
    const res = await visit('?token_hash=t-1')
    expect(res.headers.get('location')).toBe('https://crm.qwealth.com.au/login')
    expect(verifyOtp).not.toHaveBeenCalled()
  })
})
