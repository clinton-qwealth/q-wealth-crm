import { render } from '@testing-library/react'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { Registration } from '@/lib/staff'

/**
 * The consent screen's three non-staff branches, since 19 September.
 *
 * What matters is what each one does NOT show: none of them renders the
 * Approve button, none reaches the MFA check, and the request form appears
 * only to a person with no staff row at all — a pending person sees the
 * waiting sentence and no way to ask twice.
 */
let registration: Registration = { signedIn: false }
const getMfaState = vi.fn()

vi.mock('next/navigation', () => ({
  redirect: (to: string) => {
    throw new Error(`redirect:${to}`)
  },
}))
vi.mock('next/headers', () => ({ cookies: async () => ({ getAll: () => [], set: () => {} }) }))
vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: async () => ({
    auth: {
      getUser: async () => ({ data: { user: { id: 'u1', email: 'nina@qwealth.com.au' } } }),
      oauth: { getAuthorizationDetails: vi.fn() },
    },
  }),
}))
vi.mock('@/lib/staff', () => ({
  getCurrentStaff: async () => null,
  getRegistration: async () => registration,
}))
vi.mock('@/lib/mfa', () => ({ getMfaState }))
vi.mock('@/app/request-access/actions', () => ({
  signUpForAccess: vi.fn(),
  requestStaffAccess: vi.fn(),
}))

const { default: ConsentPage } = await import('@/app/oauth/consent/page')

const page = async () => render(await ConsentPage({ searchParams: Promise.resolve({ authorization_id: 'auth-1' }) }))

beforeEach(() => {
  getMfaState.mockClear()
})

describe('the consent screen for someone who is not staff', () => {
  test('no row: offers the request form, prefilled, returning here afterwards', async () => {
    registration = { signedIn: true, email: 'nina@qwealth.com.au', suggested: { first_name: 'Nina', last_name: 'New' }, row: null }
    const { container, getByRole } = await page()
    expect(getByRole('heading', { level: 1 }).textContent).toBe('Request access to Q Wealth CRM')
    expect((container.querySelector('input[name="first_name"]') as HTMLInputElement).value).toBe('Nina')
    expect((container.querySelector('input[name="last_name"]') as HTMLInputElement).value).toBe('New')
    expect((container.querySelector('input[name="next"]') as HTMLInputElement).value).toBe(
      '/oauth/consent?authorization_id=auth-1',
    )
    expect(getByRole('button', { name: 'Request access' })).toBeTruthy()
    expect(container.textContent).not.toContain('Approve')
    expect(getMfaState).not.toHaveBeenCalled()
  })

  test('pending: the waiting sentence, no form', async () => {
    registration = {
      signedIn: true,
      email: 'nina@qwealth.com.au',
      suggested: { first_name: '', last_name: '' },
      row: { id: 's9', first_name: 'Nina', last_name: 'New', email: 'nina@qwealth.com.au', status: 'pending' },
    }
    const { container, getByRole } = await page()
    expect(getByRole('heading', { level: 1 }).textContent).toBe('Awaiting approval')
    expect(container.textContent).toContain('Nina New')
    expect(container.querySelector('form')).toBeNull()
    expect(getMfaState).not.toHaveBeenCalled()
  })

  test('inactive: refused, as before', async () => {
    registration = {
      signedIn: true,
      email: 'nina@qwealth.com.au',
      suggested: { first_name: '', last_name: '' },
      row: { id: 's9', first_name: 'Nina', last_name: 'New', email: 'nina@qwealth.com.au', status: 'inactive' },
    }
    const { container, getByRole } = await page()
    expect(getByRole('heading', { level: 1 }).textContent).toBe('Not a Q Wealth staff account')
    expect(container.querySelector('form')).toBeNull()
    expect(getMfaState).not.toHaveBeenCalled()
  })
})
