import { expect, type Page } from '@playwright/test'
import { freshTotp } from './totp'

/**
 * Sign a staff account in, second factor included.
 *
 * Extracted from the signed-in suite on 20 Sep 2026 when a second account (the
 * user-group boundary check) needed the same steps. A password grant is aal1;
 * with a factor enrolled every route demands step-up, so this completes it
 * exactly as a person would.
 */
export async function signIn(page: Page, creds: { email: string; password: string; totpSecret: string }) {
  await page.goto('/login')
  await page.getByLabel(/email/i).fill(creds.email)
  await page.getByLabel(/password/i).fill(creds.password)
  await page.getByRole('button', { name: /sign in/i }).click()

  await page.waitForURL(/\/(mfa|$|groups|profile)/)
  if (new URL(page.url()).pathname === '/mfa') {
    await page.getByLabel(/authentication code/i).fill(await freshTotp(creds.totpSecret))
    await page.getByRole('button', { name: /verify/i }).click()
    await expect(page).not.toHaveURL(/\/mfa/)
  }
  await expect(page).not.toHaveURL(/\/login/)
}
