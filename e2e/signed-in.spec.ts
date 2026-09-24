import { expect, test } from '@playwright/test'
import { signIn } from './sign-in'

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
const totpSecret = process.env.E2E_TOTP_SECRET

test.describe('authenticated staff access', () => {
  /*
   * Two-factor authentication is mandatory on every authenticated route, so a
   * password alone no longer reaches the app — by design. The suite therefore
   * needs a TOTP secret it can generate codes from, and skips without one rather
   * than failing and looking like a regression.
   */
  test.skip(
    !email || !password || !totpSecret,
    'Set E2E_EMAIL, E2E_PASSWORD and E2E_TOTP_SECRET to run the signed-in checks.',
  )

  test.beforeEach(async ({ page }) => {
    // Password, then the second factor — see e2e/sign-in.ts.
    await signIn(page, { email: email!, password: password!, totpSecret: totpSecret! })
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

  test('the accounts section is headed, with its add control on the same row', async ({
    page,
  }) => {
    await page.goto('/groups')
    await page.getByRole('tab', { name: 'Accounts' }).click()

    const heading = page.getByRole('heading', { level: 3, name: 'Investment Accounts' })
    await expect(heading).toBeVisible()

    /* The heading and the add control share one row. Asserted by geometry rather
       than by markup: the DOM could be restructured freely, but if these two stop
       sitting on the same line the layout has regressed. */
    const add = page.getByRole('button', { name: /add account/i }).first()
    const [h, a] = [await heading.boundingBox(), await add.boundingBox()]
    expect(h && a).toBeTruthy()
    const overlap =
      Math.min(h!.y + h!.height, a!.y + a!.height) - Math.max(h!.y, a!.y)
    expect(overlap, 'heading and add control are not on the same row').toBeGreaterThan(0)
    expect(a!.x).toBeGreaterThan(h!.x) // heading left, action right
  })

  test('insurance sits as its own section beneath accounts', async ({ page }) => {
    await page.goto('/groups')
    await page.getByRole('tab', { name: 'Accounts' }).click()

    const accounts = page.getByRole('heading', { level: 3, name: 'Investment Accounts' })
    const insurance = page.getByRole('heading', { level: 3, name: 'Insurance Policies' })
    await expect(accounts).toBeVisible()
    await expect(insurance).toBeVisible()

    // Order matters: insurance sits beneath accounts, not above or beside.
    const [a, i] = [await accounts.boundingBox(), await insurance.boundingBox()]
    expect(i!.y).toBeGreaterThan(a!.y)

    /* An income-protection benefit must never be rendered as a bare amount — it
       is a monthly stream, and dropping the unit overstates nothing but
       understates the cover by a factor of twelve when read as annual. */
    const ip = page.locator('li', { hasText: 'Income protection' }).first()
    if (await ip.count()) await expect(ip).toContainText('/mo')
  })

  /**
   * The account drawer's MODALITY — the half jsdom cannot see.
   *
   * The unit tests cover what the drawer renders, and they are blind to the
   * four things that made a native `<dialog>` worth using in the first place:
   * the top layer, an inert background, focus genuinely held inside, and
   * Escape handled by the browser. jsdom stubs `showModal()` by toggling an
   * attribute and moves no focus at all, so a hand-rolled panel with none of
   * this would pass every test in `__tests__` untouched. This is the test that
   * would not pass.
   */
  test('the account drawer is modal, and closing it returns the reader', async ({ page }) => {
    await page.goto('/groups')
    await page.getByRole('tab', { name: 'Accounts' }).click()

    const row = page.getByRole('button', { name: /^Open / }).first()
    /* Skipped rather than failed on a database with no accounts in it: this
       spec runs against whatever data the environment has, and an empty
       accounts list is a legitimate state, not a regression. */
    test.skip((await row.count()) === 0, 'This group has no accounts to open.')

    await row.click()
    /* Scoped to the drawer's own class since 19 September: the account drawer
       can open a confirm dialog over itself, and a bare `dialog[open]` would
       then match two elements and fail strict mode on an unrelated line. */
    const drawer = page.locator('dialog.qw-drawer[open]')
    await expect(drawer).toBeVisible()

    /* Initial focus lands on the heading, so a screen reader announces the
       ACCOUNT. Neither hand-rolled drawer did this: the first tabbable thing
       was the close button, and the reader heard "Close panel". */
    const headingFocused = await page.evaluate(
      () => document.activeElement?.tagName === 'H2',
    )
    expect(headingFocused, 'focus did not land on the drawer heading').toBe(true)

    /*
     * The background is genuinely INERT, not merely covered.
     *
     * A `.focus()` on an element behind a modal dialog is refused by the
     * browser — nothing moves. An overlay div with a high z-index looks
     * identical on screen and fails this outright, which is exactly why it is
     * worth one round trip to assert.
     */
    const escaped = await page.evaluate(() => {
      const behind = document.querySelector<HTMLElement>('[role="tab"]')
      behind?.focus()
      return document.activeElement === behind
    })
    expect(escaped, 'the page behind the drawer is still focusable').toBe(false)

    await page.keyboard.press('Escape')
    await expect(drawer).toHaveCount(0)

    /* And the reader is put back where they were. This is the browser's own
       behaviour and it only works because the trigger still exists — one
       dialog for the list, rows keyed by id, so nothing is remounted. */
    await expect(row).toBeFocused()
  })

  /**
   * The Administration page, since 24 Sep 2026: a menu of sections on the
   * left, the chosen section's tabs in the middle, the section in the URL.
   * Read-only — nothing here writes to the shared database — and skipped when
   * the fixture account is not an administrator, because a non-administrator
   * is told the page does not exist.
   *
   * The menu is walked by CLICKING, not by `goto`, because the links are what
   * is under test: a menu of buttons would pass a `goto` for every section
   * and still leave nobody able to bookmark the roles list.
   */
  test('the administration page opens on User management, and its menu reaches the other sections', async ({ page }) => {
    const response = await page.goto('/admin')
    test.skip(response?.status() === 404, 'The fixture account is not an administrator.')

    const menu = page.getByRole('navigation', { name: 'Administration sections' })
    await expect(menu.getByRole('link')).toHaveText(['User management', 'Workflow management', 'Observability'])

    await expect(page.getByRole('tablist', { name: 'Administration' })).toBeVisible()
    await expect(page.getByRole('tab')).toHaveText(['Users', 'User groups'])
    await page.getByRole('tab', { name: 'User groups' }).click()
    /* Either state is legitimate on a live database; what is not is neither. */
    await expect(
      page.getByText('No user groups yet').or(page.getByRole('heading', { level: 3, name: 'User groups' })),
    ).toBeVisible()

    await menu.getByRole('link', { name: 'Workflow management' }).click()
    await expect(page).toHaveURL(/\/admin\?section=workflows$/)
    await expect(page.getByRole('tab')).toHaveText(['Templates', 'Roles'])
    await expect(menu.getByRole('link', { name: 'Workflow management' })).toHaveAttribute('aria-current', 'page')

    await menu.getByRole('link', { name: 'Observability' }).click()
    await expect(page.getByRole('tab')).toHaveText(['Audit trail'])
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
