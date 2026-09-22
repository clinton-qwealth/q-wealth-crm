import { expect, test } from '@playwright/test'

/**
 * The security headers, checked against a real browser rather than the config
 * that is supposed to produce them.
 *
 * The CSP is the reason this file exists. Its script source is a per-request
 * nonce that Next.js has to read back off the REQUEST headers and stamp onto
 * its own script tags; if that wiring is wrong the policy does not fail loudly,
 * it refuses the bootstrap script and serves a page that renders and then does
 * nothing. A unit test on the policy string cannot see that. A browser can.
 *
 * Unauthenticated pages only, so this needs no fixtures — but note what that
 * does NOT cover: the charts, the editor and the reader all live behind sign-in.
 */

/** Every violation the browser reported while the page loaded. */
async function violationsOn(page: import('@playwright/test').Page, path: string) {
  const seen: string[] = []
  await page.addInitScript(() => {
    ;(window as unknown as { __csp: string[] }).__csp = []
    document.addEventListener('securitypolicyviolation', (e) => {
      ;(window as unknown as { __csp: string[] }).__csp.push(
        `${e.violatedDirective} blocked ${e.blockedURI || '(inline)'}`,
      )
    })
  })
  await page.goto(path)
  await page.waitForLoadState('networkidle')
  seen.push(...(await page.evaluate(() => (window as unknown as { __csp: string[] }).__csp ?? [])))
  return seen
}

test.describe('content security policy', () => {
  for (const path of ['/login', '/request-access']) {
    test(`${path} loads with no policy violations`, async ({ page }) => {
      expect(await violationsOn(page, path)).toEqual([])
    })
  }

  /**
   * THE TEST THAT ACTUALLY CATCHES A BROKEN NONCE, and the second attempt at
   * it. The first filled the login form and asserted the value came back —
   * which passes with every script on the page blocked, because typing into an
   * `<input>` needs no JavaScript at all. It proved nothing.
   *
   * These two prove it. The header's nonce and the tags' nonce must be the same
   * string, in ONE response — fetched separately they never match, because each
   * request mints its own. And Next's inline flight scripts must have run:
   * `script-src` carries no `'unsafe-inline'`, so `self.__next_f` exists only
   * if the nonce on those inline tags was accepted.
   */
  test('the nonce in the header is the nonce on the script tags', async ({ request }) => {
    const res = await request.get('/login')
    const fromHeader = /'nonce-([^']+)'/.exec(res.headers()['content-security-policy'] ?? '')?.[1]
    const fromTags = [...(await res.text()).matchAll(/nonce="([^"]+)"/g)].map((m) => m[1])

    expect(fromHeader).toBeTruthy()
    expect(fromTags.length).toBeGreaterThan(0)
    expect([...new Set(fromTags)]).toEqual([fromHeader])
  })

  test('Next’s inline scripts ran, which only a matching nonce allows', async ({ page }) => {
    const violations = await violationsOn(page, '/login')
    expect(await page.evaluate(() => typeof (window as unknown as { __next_f?: unknown }).__next_f)).not.toBe(
      'undefined',
    )
    expect(violations).toEqual([])
  })

  test('a fresh nonce on every response', async ({ request }) => {
    const nonceOf = async () => {
      const res = await request.get('/login')
      return /'nonce-([^']+)'/.exec(res.headers()['content-security-policy'] ?? '')?.[1]
    }
    const [first, second] = [await nonceOf(), await nonceOf()]
    expect(first).toBeTruthy()
    expect(second).toBeTruthy()
    expect(first).not.toBe(second)
  })
})

test.describe('the constant headers', () => {
  test('every response carries them', async ({ request }) => {
    const headers = (await request.get('/login')).headers()
    expect(headers['x-frame-options']).toBe('DENY')
    expect(headers['x-content-type-options']).toBe('nosniff')
    expect(headers['referrer-policy']).toBe('strict-origin-when-cross-origin')
    expect(headers['permissions-policy']).toContain('camera=()')
    expect(headers['content-security-policy']).toContain("frame-ancestors 'none'")
  })

  /**
   * HSTS is only meaningful over HTTPS and Next omits it on plain HTTP, which
   * is what the test server speaks — so asserting its presence here would fail
   * for a reason that has nothing to do with the code. The config-level test in
   * `__tests__/auth-cookie-attributes.test.ts` covers it instead. Written down
   * so the gap reads as a decision.
   */
  test.skip('HSTS is asserted in the unit suite, not here', () => {})
})
