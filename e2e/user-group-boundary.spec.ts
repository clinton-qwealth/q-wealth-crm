import { expect, test } from '@playwright/test'
import { signIn } from './sign-in'

/**
 * The territory boundary, end to end: a LIMITED staff member does not get a
 * household that belongs to a user group they are not in.
 *
 * The unit tests prove the migration says the right thing and the screens ask
 * the right questions. Neither can prove that Postgres, evaluating the policy
 * for a real session, hides the row — and that is the whole feature. So this
 * spec signs in as a second fixture account whose record has "Limit to user
 * groups" ticked, and asserts a named household never reaches them: not in
 * the list, not by URL, not in any response body.
 *
 * Fixtures come from the environment (see .env.example) and the spec skips
 * without them, like the signed-in suite. Setting them up is a one-time act
 * on the Administration page and the household's own page.
 */
const email = process.env.E2E_LIMITED_EMAIL
const password = process.env.E2E_LIMITED_PASSWORD
const totpSecret = process.env.E2E_LIMITED_TOTP_SECRET
const hiddenId = process.env.E2E_HIDDEN_GROUP_ID
const hiddenName = process.env.E2E_HIDDEN_GROUP_NAME

test.describe('a limited staff member and a household outside their user groups', () => {
  test.skip(
    !email || !password || !totpSecret || !hiddenId || !hiddenName,
    'Set E2E_LIMITED_EMAIL, E2E_LIMITED_PASSWORD, E2E_LIMITED_TOTP_SECRET, E2E_HIDDEN_GROUP_ID and E2E_HIDDEN_GROUP_NAME to run the boundary check.',
  )

  test.beforeEach(async ({ page }) => {
    await signIn(page, { email: email!, password: password!, totpSecret: totpSecret! })
  })

  test('the household is not in their list, is a 404 by URL, and appears in no response body', async ({ page }) => {
    const leaked: string[] = []
    page.on('response', async (res) => {
      const type = res.headers()['content-type'] ?? ''
      if (!type.includes('text/') && !type.includes('json')) return
      let body: string
      try {
        body = await res.text()
      } catch {
        return
      }
      if (body.includes(hiddenName!)) leaked.push(res.url())
    })

    await page.goto('/groups')
    await expect(page).not.toHaveURL(/\/login/)
    await expect(page.getByRole('link', { name: hiddenName! })).toHaveCount(0)

    /* By URL: a household outside your sight is indistinguishable from one
       that does not exist. A signed-in person does get the 404. */
    const direct = await page.goto(`/groups/${hiddenId}`)
    expect(direct?.status()).toBe(404)

    expect(leaked, `the hidden household reached a limited user:\n${leaked.join('\n')}`).toEqual([])
  })
})
