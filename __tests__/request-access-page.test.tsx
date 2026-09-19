import { render } from '@testing-library/react'
import { describe, expect, test, vi } from 'vitest'
import type { Registration } from '@/lib/staff'

/**
 * The request page's four states, each decided by `getRegistration()` alone.
 *
 * A stranger gets a sign-up form and nothing about who works here. A signed-in
 * person with no row gets the request form. A pending person waits and can
 * sign out. An active staff member is sent home — the page is not theirs.
 */
let registration: Registration = { signedIn: false }

vi.mock('next/navigation', () => ({
  redirect: (to: string) => {
    throw new Error(`redirect:${to}`)
  },
}))
vi.mock('@/lib/staff', () => ({ getRegistration: async () => registration }))
vi.mock('@/app/request-access/actions', () => ({ signUpForAccess: vi.fn(), requestStaffAccess: vi.fn() }))
vi.mock('@/app/actions', () => ({ signOut: vi.fn() }))

const { default: RequestAccessPage } = await import('@/app/request-access/page')

const page = async (next?: string) => render(await RequestAccessPage({ searchParams: Promise.resolve({ next }) }))

describe('/request-access', () => {
  test('signed out: a sign-up form with name, email and password', async () => {
    registration = { signedIn: false }
    const { container, getByRole } = await page()
    expect(getByRole('heading', { level: 1 }).textContent).toBe('Request access')
    for (const name of ['full_name', 'email', 'password']) expect(container.querySelector(`input[name="${name}"]`)).toBeTruthy()
    expect(getByRole('button', { name: 'Create account' })).toBeTruthy()
  })

  test('signed in, no row: the request form, prefilled, carrying next', async () => {
    registration = { signedIn: true, email: 'nina@qwealth.com.au', suggestedName: 'Nina New', row: null }
    const { container, getByRole } = await page('/oauth/consent?authorization_id=a')
    expect(getByRole('heading', { level: 1 }).textContent).toBe('Ask to join')
    expect((container.querySelector('input[name="full_name"]') as HTMLInputElement).value).toBe('Nina New')
    expect((container.querySelector('input[name="next"]') as HTMLInputElement).value).toBe('/oauth/consent?authorization_id=a')
    expect(container.querySelector('input[name="password"]')).toBeNull()
  })

  test('an off-site next is not carried', async () => {
    registration = { signedIn: true, email: 'nina@qwealth.com.au', suggestedName: null, row: null }
    const { container } = await page('https://evil.example/')
    expect((container.querySelector('input[name="next"]') as HTMLInputElement).value).toBe('/')
  })

  test('pending: waiting, with a way to sign out and no way to ask again', async () => {
    registration = {
      signedIn: true,
      email: 'nina@qwealth.com.au',
      suggestedName: null,
      row: { id: 's9', full_name: 'Nina New', email: 'nina@qwealth.com.au', status: 'pending' },
    }
    const { container, getByRole } = await page()
    expect(getByRole('heading', { level: 1 }).textContent).toBe('Awaiting approval')
    expect(getByRole('button', { name: 'Sign out' })).toBeTruthy()
    expect(container.querySelector('input[name="full_name"]')).toBeNull()
  })

  test('inactive: not active, sign out', async () => {
    registration = {
      signedIn: true,
      email: 'nina@qwealth.com.au',
      suggestedName: null,
      row: { id: 's9', full_name: 'Nina New', email: 'nina@qwealth.com.au', status: 'inactive' },
    }
    const { getByRole } = await page()
    expect(getByRole('heading', { level: 1 }).textContent).toBe('This account is not active')
    expect(getByRole('button', { name: 'Sign out' })).toBeTruthy()
  })

  test('active staff are sent home, or on to next', async () => {
    registration = {
      signedIn: true,
      email: 'a@qwealth.com.au',
      suggestedName: null,
      row: { id: 's1', full_name: 'A', email: 'a@qwealth.com.au', status: 'active' },
    }
    await expect(page()).rejects.toThrow('redirect:/')
    await expect(page('/groups')).rejects.toThrow('redirect:/groups')
  })
})
