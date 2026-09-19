import { render } from '@testing-library/react'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { Registration } from '@/lib/staff'

/**
 * The login page's two new behaviours since 19 September: a way in for someone
 * new, and no loop for someone who is signed in but not staff — until today
 * they were sent from the shell to the login page, which showed them the login
 * form again.
 */
let staff: object | null = null
let registration: Registration = { signedIn: false }

vi.mock('next/navigation', () => ({
  redirect: (to: string) => {
    throw new Error(`redirect:${to}`)
  },
}))
vi.mock('@/lib/staff', () => ({ getCurrentStaff: async () => staff, getRegistration: async () => registration }))
vi.mock('@/app/login/login-form', () => ({ LoginForm: () => <form data-slot="login-form" /> }))

const { default: LoginPage } = await import('@/app/login/page')
const page = async (next?: string, error?: string) =>
  render(await LoginPage({ searchParams: Promise.resolve({ next, error }) }))
const notice = (c: HTMLElement) => c.querySelector('[data-slot="arrival-notice"]')

describe('/login', () => {
  test('offers a stranger the login form and a link to request access', async () => {
    const { container, getByRole } = await page()
    expect(container.querySelector('[data-slot="login-form"]')).toBeTruthy()
    expect(getByRole('link', { name: 'Request access' }).getAttribute('href')).toBe('/request-access')
  })

  test('sends a signed-in non-staff person to the request page, carrying next', async () => {
    registration = { signedIn: true, email: 'n@qwealth.com.au', suggested: { first_name: '', last_name: '' }, row: null }
    await expect(page()).rejects.toThrow('redirect:/request-access')
    await expect(page('/oauth/consent?authorization_id=a')).rejects.toThrow(
      'redirect:/request-access?next=%2Foauth%2Fconsent%3Fauthorization_id%3Da',
    )
  })

  test('sends staff on, as before', async () => {
    staff = { id: 's1' }
    await expect(page('/groups')).rejects.toThrow('redirect:/groups')
  })
})

/**
 * Arriving from a spent confirmation link.
 *
 * `/auth/confirm` sends somebody here with `?error=confirm` when their link has
 * been used and they have no session to fall back on. Until 20 September 2026
 * the page **ignored that entirely**, so they met a bare sign-in form with no
 * explanation — which is most of why the registration flow read as having a
 * mystery step in the middle of it.
 */
describe('the arrival notice', () => {
  beforeEach(() => {
    staff = null
    registration = { signedIn: false }
  })

  test('a spent confirmation link is explained, ABOVE a form that still works', async () => {
    const { container } = await page(undefined, 'confirm')
    const alert = notice(container)
    expect(alert?.textContent).toMatch(/expired or has already been used/i)
    expect(alert?.getAttribute('role')).toBe('alert')
    expect(container.querySelector('[data-slot="login-form"]'), 'the form is the point of the page').toBeTruthy()
  })

  test('nothing is said when nothing brought them here', async () => {
    const { container } = await page()
    expect(notice(container)).toBeNull()
  })

  /**
   * **The query string is attacker-controlled on a page anyone can reach.**
   * Echoing it would put chosen text on our own sign-in screen directly above a
   * password box, which is a phishing primitive rather than a cosmetic bug. The
   * page renders from a fixed map of codes it wrote itself, so an unknown value
   * — hostile or merely stale — says nothing at all.
   */
  test('an unrecognised code says nothing, and its text never reaches the page', async () => {
    for (const bad of ['whatever', '<script>alert(1)</script>', 'Your session expired, re-enter your password']) {
      const { container } = await page(undefined, bad)
      expect(notice(container)).toBeNull()
      expect(container.textContent).not.toContain(bad)
    }
  })

  test('somebody already signed in is still sent onward rather than shown it', async () => {
    registration = { signedIn: true, email: 'n@qwealth.com.au', suggested: { first_name: '', last_name: '' }, row: null }
    await expect(page(undefined, 'confirm')).rejects.toThrow('redirect:/request-access')
  })
})
