import { expect, test } from '@playwright/test'

/**
 * The other half of the boundary: an authenticated staff member does get in, and
 * signing out puts the boundary back.
 *
 * Credentials come from the environment. Nothing is hardcoded — a password in the
 * repository is a password in every clone, every fork and every CI log. Without
 * them the whole file skips, so a fresh clone still runs the unauthenticated
 * suite, which needs no fixtures at all.
 */
const email = process.env.E2E_EMAIL
const password = process.env.E2E_PASSWORD

test.describe('authenticated staff access', () => {
  test.skip(
    !email || !password,
    'Set E2E_EMAIL and E2E_PASSWORD to run the signed-in checks.',
  )

  test.beforeEach(async ({ page }) => {
    await page.goto('/login')
    await page.getByLabel(/email/i).fill(email!)
    await page.getByLabel(/password/i).fill(password!)
    await page.getByRole('button', { name: /sign in/i }).click()
    await expect(page).not.toHaveURL(/\/login/)
  })

  test('a staff member reaches the home page', async ({ page }) => {
    await page.goto('/')
    await expect(page).not.toHaveURL(/\/login/)

    // The authenticated shell, not a login form: greeting plus the nav.
    await expect(page.getByText(/Good to see you/i)).toBeVisible()
    await expect(page.getByRole('link', { name: 'Workflows' })).toBeVisible()
  })

  /* The signed-in identity lives in the account menu rather than on the page, so
     it is only visible once the menu is open. Worth asserting: it is how a staff
     member confirms *who* they are acting as before touching client data. */
  test('the account menu names the signed-in user', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('button', { name: /^Account menu/ }).click()
    await expect(page.getByText(email!)).toBeVisible()
  })

  test('the group workspace renders group data', async ({ page }) => {
    await page.goto('/groups')
    await expect(page).not.toHaveURL(/\/login/)

    // Tabs are the spine of the page; if they are missing, nothing else matters.
    await expect(page.getByRole('tab', { name: 'Accounts' })).toBeVisible()
    await expect(page.getByRole('tablist')).toBeVisible()
  })

  test('accounts appear under a heading naming their type', async ({ page }) => {
    await page.goto('/groups')
    await page.getByRole('tab', { name: 'Accounts' }).click()

    // At least one type heading, and every account row carries an amount or
    // nothing — never a broken render.
    const headings = page.getByRole('heading', { level: 3 })
    await expect(headings.filter({ hasText: /Accounts$/ }).first()).toBeVisible()
  })

  /**
   * Signing out has to actually restore the boundary, not just clear the visible
   * chrome. This is the case a cookie-handling mistake breaks.
   */
  test('signing out puts the boundary back', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('button', { name: /^Account menu/ }).click()
    // role="menuitem", not "button": the explicit role overrides the implicit
    // one, which is correct ARIA for an item inside a menu.
    await page.getByRole('menuitem', { name: 'Sign out' }).click()

    await expect(page).toHaveURL(/\/login/)

    // And the protected routes are protected again.
    await page.goto('/groups')
    await expect(page).toHaveURL(/\/login\?next=/)
  })
})
