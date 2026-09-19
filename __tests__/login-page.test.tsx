import { render } from '@testing-library/react'
import { describe, expect, test, vi } from 'vitest'
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
const page = async (next?: string) => render(await LoginPage({ searchParams: Promise.resolve({ next }) }))

describe('/login', () => {
  test('offers a stranger the login form and a link to request access', async () => {
    const { container, getByRole } = await page()
    expect(container.querySelector('[data-slot="login-form"]')).toBeTruthy()
    expect(getByRole('link', { name: 'Request access' }).getAttribute('href')).toBe('/request-access')
  })

  test('sends a signed-in non-staff person to the request page, carrying next', async () => {
    registration = { signedIn: true, email: 'n@qwealth.com.au', suggestedName: null, row: null }
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
