import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, test, vi } from 'vitest'

/**
 * The session cookie's attributes, pinned.
 *
 * A compliance question — "are Secure and HttpOnly set on every session
 * cookie" — is answered by configuration that nothing else in the suite would
 * notice being deleted. @supabase/ssr's own defaults set NO Secure attribute,
 * so removing `cookieOptions` from any one of the three client constructors
 * silently returns that client to a session token sendable over plain HTTP.
 *
 * Source-text assertions for the wiring, the way the migration tests read SQL:
 * there is no way to observe the attribute from inside vitest without standing
 * up GoTrue, and a test that asserted nothing would be worse than this.
 */
const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8')

afterEach(() => {
  vi.unstubAllEnvs()
  vi.resetModules()
})

describe('the deployed session cookie', () => {
  test('carries Secure in production', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.resetModules()
    const { AUTH_COOKIE_OPTIONS } = await import('@/lib/supabase/cookies')
    expect(AUTH_COOKIE_OPTIONS.secure).toBe(true)
  })

  /**
   * Chromium and Firefox accept a Secure cookie on http://localhost; Safari
   * does not, and `next dev` and the Playwright suite both serve plain HTTP.
   * Mutation: pin `secure: true` unconditionally → signing in locally becomes
   * browser-dependent, which is a miserable thing to debug.
   */
  test('does not carry it over plain HTTP locally', async () => {
    vi.stubEnv('NODE_ENV', 'development')
    vi.resetModules()
    const { AUTH_COOKIE_OPTIONS } = await import('@/lib/supabase/cookies')
    expect(AUTH_COOKIE_OPTIONS.secure).toBe(false)
  })

  /**
   * All three, not one. A cookie written by the server client and refreshed by
   * the proxy with different attributes is two cookies to the browser.
   * Mutation: drop the option from any single file → this fails and names it.
   */
  test.each(['lib/supabase/server.ts', 'lib/supabase/client.ts', 'proxy.ts'])(
    '%s passes the shared cookie options to its Supabase client',
    (path) => {
      const src = read(path)
      expect(src).toMatch(/import \{ AUTH_COOKIE_OPTIONS \} from '@\/lib\/supabase\/cookies'/)
      expect(src).toMatch(/cookieOptions: AUTH_COOKIE_OPTIONS/)
    },
  )

  /**
   * HttpOnly is absent BY DECISION — createBrowserClient reads the session from
   * document.cookie — and the decision has to stay written down, because the
   * next person to read this checklist will otherwise record it as an
   * oversight. Mutation: delete the explanation → fails.
   */
  test('says in writing why HttpOnly is not set', () => {
    const src = read('lib/supabase/cookies.ts')
    expect(src).toMatch(/HttpOnly is NOT set here/)
    expect(src).toMatch(/document\.cookie/)
  })
})

describe('HSTS', () => {
  /**
   * The companion control: Secure stops the cookie being SENT over HTTP, HSTS
   * stops the request being MADE. Mutation: drop the header → fails.
   */
  test('is sent on every route', () => {
    const src = read('next.config.ts')
    expect(src).toMatch(/'Strict-Transport-Security'/)
    expect(src).toMatch(/max-age=63072000/)
    expect(src).toMatch(/source: '\/:path\*'/)
  })

  /**
   * Deliberately absent: both are close to irreversible and neither should be
   * switched on from a config file without checking every sibling host.
   */
  test('claims nothing about subdomains and is not preloaded', () => {
    const src = read('next.config.ts')
    const header = src.slice(src.indexOf("'Strict-Transport-Security'"))
    expect(header.slice(0, 120)).not.toMatch(/includeSubDomains|preload/)
  })
})
