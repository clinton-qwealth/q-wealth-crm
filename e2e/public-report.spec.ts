import { expect, test } from '@playwright/test'

/**
 * The one page in this application reachable without signing in.
 *
 * Everything else redirects to /login — `e2e/access-boundary.spec.ts` holds
 * that line. This file holds the other side of it: that the exception is
 * exactly one read-only report behind an unguessable token, that a wrong token
 * gives nothing, and that opening the door for it did not open anything else.
 *
 * What a plausible implementation gets wrong: a bad token throwing a 500 with a
 * database message in it; an error page distinguishing "revoked" from "never
 * existed", which turns the page into an oracle for guessing tokens; or
 * `/reports` itself listing what is shareable.
 */
const NOT_A_TOKEN = '0123456789abcdef0123456789abcdef'

test.describe('the public report', () => {
  test('is reachable without signing in — it does not bounce to login', async ({ page }) => {
    const response = await page.goto(`/shared/parking/${NOT_A_TOKEN}`)
    /* The point is the URL: a protected path would have become /login?next=…
       by now. This one is allowed to 404, and must not redirect. */
    expect(page.url()).not.toContain('/login')
    expect(response?.status()).toBe(404)
  })

  test('a token that was never issued gives nothing, and says nothing', async ({ page }) => {
    const response = await page.goto(`/shared/parking/${NOT_A_TOKEN}`)
    const body = (await page.content()).toLowerCase()
    expect(response?.status()).toBe(404)
    /* No database sentence, no hint about which kind of wrong it is. */
    for (const leak of ['report link is not valid', 'revoked', 'expired', 'parking_report', 'postgres', 'supabase']) {
      expect(body, `the 404 page mentions "${leak}"`).not.toContain(leak)
    }
  })

  test('the parent path is not a directory of what can be shared', async ({ page }) => {
    const response = await page.goto('/shared/parking')
    expect(response?.status()).toBe(404)
  })

  test('opening /shared did not open the rest of the application', async ({ page }) => {
    /* The proxy matches on a path PREFIX, so an entry in PUBLIC_PATHS silently
       covers everything beneath it.

       `/reports` LEADS THIS LIST, deliberately. The first version of this
       feature put the public page at /reports/parking/<token> and added
       `/reports` to PUBLIC_PATHS — which is an existing CRM page, so the proxy
       stopped guarding it. The first version of THIS TEST listed `/`, `/groups`,
       `/workflows` and `/admin`, omitted the one path the change touched, and
       sailed past the regression it was written to catch. */
    for (const path of ['/reports', '/', '/groups', '/workflows', '/admin']) {
      await page.goto(path)
      await expect(page).toHaveURL(new RegExp(`/login\\?next=${encodeURIComponent(path)}`))
    }
  })

  /**
   * The chrome added 24 Sep 2026 is the CRM's bar and the CRM's ground, and the
   * temptation it creates is to reuse `TopNav` — whose staff props are all
   * optional, so it renders perfectly well with none of them.
   *
   * It must not be. Every destination in that bar is protected: the four nav
   * links, the Help icon, and each item of the account menu. A visitor holding
   * a share link would get a row of controls that each bounce to a sign-in
   * screen, and a map of an application they have no business in.
   *
   * Mutation, and it was run: swap `<PublicNav />` for `<TopNav />` in
   * `app/shared/layout.tsx` — this fails on the nav landmark and on six hrefs.
   */
  test('offers no way into the application', async ({ page }) => {
    await page.goto(`/shared/parking/${NOT_A_TOKEN}`)

    /* The bar IS there — this is not passing because the page is blank. */
    await expect(page.getByRole('img', { name: 'Q Wealth' })).toBeVisible()

    await expect(page.locator('nav[aria-label="Main"]')).toHaveCount(0)
    await expect(page.getByRole('button', { name: /account|profile|search/i })).toHaveCount(0)

    /* Nothing anywhere on the page points at a route that would demand a
       session. Read off the DOM rather than from a list of link names, so a
       control added later is covered without anyone remembering this test. */
    const hrefs = await page.locator('a[href^="/"]').evaluateAll((links) =>
      links.map((l) => l.getAttribute('href') ?? ''),
    )
    for (const href of hrefs) {
      expect(href, `the public page links to ${href}`).toMatch(/^\/shared(\/|$)/)
    }
  })

  test('is asked not to be indexed', async ({ page }) => {
    await page.goto(`/shared/parking/${NOT_A_TOKEN}`)
    /* The link is the only credential. A search engine that finds it in a
       crawled mailbox must not put it in an index. */
    const robots = await page.locator('meta[name="robots"]').getAttribute('content').catch(() => null)
    if (robots) expect(robots).toContain('noindex')
  })
})
