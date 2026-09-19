import { expect, test } from '@playwright/test'

/**
 * The founding requirement: this site is reachable only by people inside the
 * business. These tests hold that line without any fixtures — no account, no
 * seeded data — so they run everywhere, including on a fresh clone in CI.
 *
 * They deliberately assert on the *unauthenticated* case. That is the one an
 * attacker gets for free, and the one a refactor is most likely to break
 * silently, because a signed-in developer never sees it.
 */

const PROTECTED = ['/', '/groups', '/profile', '/preferences', '/workflows', '/reports', '/admin']

test.describe('unauthenticated access', () => {
  for (const path of PROTECTED) {
    test(`${path} redirects an anonymous visitor to sign in`, async ({ page }) => {
      const response = await page.goto(path)

      await expect(page).toHaveURL(new RegExp(`/login\\?next=${encodeURIComponent(path)}`))
      // Landed on the login form, not a shell of the protected page.
      await expect(page.getByLabel(/email/i)).toBeVisible()
      expect(response?.status()).toBe(200)
    })
  }

  /**
   * Since 19 Sep 2026 a stranger may create an account and ask to join. The
   * page they do it on is public by design, and must show a sign-up form —
   * nothing else — to someone with no session.
   */
  test('the request-access page is reachable, and offers only a sign-up form', async ({ page }) => {
    await page.goto('/request-access')
    await expect(page.getByRole('heading', { name: 'Request access' })).toBeVisible()
    /* Two name boxes since 19 Sep 2026, when a staff member's name became two
       columns. Asserted separately rather than as one /name/ match, which would
       pass with either box missing. */
    await expect(page.getByLabel(/first name/i)).toBeVisible()
    await expect(page.getByLabel(/last name/i)).toBeVisible()
    await expect(page.getByLabel(/email/i)).toBeVisible()
    await expect(page.getByRole('button', { name: 'Create account' })).toBeVisible()
  })

  /**
   * The field labels read left, and this is measured rather than inspected.
   *
   * The card around these forms centres itself, for its logo and its heading,
   * and **a label inherits that** — so the labels sat centred over their inputs
   * until 20 September 2026, reading as captions. Nothing in the form's own
   * markup was wrong, which is why it survived review and was reported by
   * somebody looking at the page.
   *
   * A class scan cannot see this: the property came from an ancestor, and the
   * element that carries it is in a different file from the element that reads
   * wrong. Computed style in a real browser is the only thing that measures it,
   * which is why the assertion lives here and not in the unit suite.
   */
  test('the sign-up form reads left, not centred under the card heading', async ({ page }) => {
    await page.goto('/request-access')
    for (const label of ['First name', 'Last name', 'Q Wealth email', 'Password']) {
      await expect(page.getByText(label, { exact: true })).toHaveCSS('text-align', 'left')
    }
    /* The heading above them is still centred — the fix is scoped to the form,
       not a blanket removal of the card's own alignment. */
    await expect(page.getByRole('heading', { name: 'Request access' })).toHaveCSS('text-align', 'center')
  })

  test('the login page itself is reachable', async ({ page }) => {
    await page.goto('/login')
    await expect(page.getByLabel(/email/i)).toBeVisible()
    await expect(page.getByLabel(/password/i)).toBeVisible()
  })

  /**
   * A redirect is not enough on its own: if the protected page rendered before
   * the redirect was issued, client data could still be sitting in the response
   * body. This asserts the bytes, not just the destination.
   */
  test('no client data appears in any unauthenticated response', async ({ page }) => {
    const leaked: string[] = []
    // Names and figures that exist in the database and must never reach an
    // anonymous request.
    const secrets = ['Testsmith', 'Testlee', 'Faketrade', 'AustralianSuper', 'Netwealth', '284,350']

    page.on('response', async (res) => {
      const type = res.headers()['content-type'] ?? ''
      if (!type.includes('text/') && !type.includes('json')) return
      let body: string
      try {
        body = await res.text()
      } catch {
        return
      }
      for (const s of secrets) {
        if (body.includes(s)) leaked.push(`${s} in ${res.url()}`)
      }
    })

    for (const path of [...PROTECTED, '/request-access']) await page.goto(path)

    expect(leaked, `client data leaked to an anonymous visitor:\n${leaked.join('\n')}`).toEqual([])
  })

  /**
   * Route existence is not disclosed to an anonymous visitor. The proxy bounces
   * the request before routing resolves, so a real protected route and a
   * non-existent one are indistinguishable from outside. (A signed-in staff
   * member does get a 404 — they are entitled to know.)
   *
   * Asserted deliberately rather than incidentally: a future change that let the
   * router answer first would turn this into a free map of the application, and
   * nothing else would fail.
   */
  test('an unknown route is indistinguishable from a real one when signed out', async ({
    request,
  }) => {
    const real = await request.get('/groups', { maxRedirects: 0 })
    const fake = await request.get('/definitely-not-a-route', { maxRedirects: 0 })

    expect(fake.status()).toBe(real.status())
    expect(fake.status()).toBe(307)

    const target = (r: typeof real) => new URL(r.headers()['location'], 'http://localhost:3000')
    expect(target(fake).pathname).toBe(target(real).pathname)
    expect(target(fake).pathname).toBe('/login')

    // A redirect body should be empty or a bare stub, never a rendered page.
    expect((await fake.text()).length).toBeLessThan(1024)
  })
})

/**
 * The `next` parameter is attacker-supplied. Treating it as a URL would let
 * someone send staff a genuine-looking login link that bounces them to another
 * host once authenticated — credential phishing with a real login page.
 *
 * The guard accepts only single-slash-rooted paths. These cases assert that
 * hostile values are neutralised *before* they reach the form, so the value the
 * browser would actually follow is safe.
 */
test.describe('open-redirect guard on the post-login next parameter', () => {
  const hostile = [
    '//evil.example.com',
    '///evil.example.com',
    'https://evil.example.com',
    'http://evil.example.com',
    '\\\\evil.example.com',
    '/\\evil.example.com',
    'javascript:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    '//evil.example.com/%2f..',
    'HTTPS://EVIL.EXAMPLE.COM',
  ]

  for (const value of hostile) {
    test(`neutralises next=${value}`, async ({ page }) => {
      await page.goto(`/login?next=${encodeURIComponent(value)}`)

      // Whatever the form carries forward must be same-origin and root-relative.
      const carried = await page.evaluate(() => {
        const field = document.querySelector<HTMLInputElement>('input[name="next"]')
        if (field) return field.value
        const form = document.querySelector<HTMLFormElement>('form')
        return form?.getAttribute('action') ?? ''
      })

      expect(carried.startsWith('//'), `"${carried}" is protocol-relative`).toBe(false)
      expect(/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(carried), `"${carried}" has a scheme`).toBe(false)
      expect(carried.includes('evil.example.com'), `"${carried}" kept the host`).toBe(false)
      expect(carried.includes('\\'), `"${carried}" kept a backslash`).toBe(false)
      if (carried) expect(carried.startsWith('/')).toBe(true)
    })
  }

  test('a legitimate next value is preserved', async ({ page }) => {
    await page.goto('/login?next=%2Fgroups')
    const carried = await page.evaluate(
      () => document.querySelector<HTMLInputElement>('input[name="next"]')?.value ?? '',
    )
    expect(carried).toBe('/groups')
  })
})
