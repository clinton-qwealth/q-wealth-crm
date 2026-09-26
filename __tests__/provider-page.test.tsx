import { render, screen, within } from '@testing-library/react'
import { describe, expect, test, vi } from 'vitest'
import type { ServiceProviderDetail } from '@/lib/groups'

/**
 * The provider page's skeleton: the client group page's three columns with a
 * provider's furniture — profile left, two RESERVED columns that each say what
 * they are reserved for, and one answer for every kind of wrong id.
 */
let PROVIDER: ServiceProviderDetail | null = null

vi.mock('next/navigation', () => ({
  redirect: () => { throw new Error('redirect') },
  notFound: () => { throw new Error('notFound') },
}))
vi.mock('@/lib/staff', () => ({
  getCurrentStaff: async () => ({ id: 's1', status: 'active' }),
}))
vi.mock('@/lib/groups', () => ({ getServiceProvider: async () => PROVIDER }))

const { default: ServiceProviderPage } = await import('@/app/(shell)/groups/providers/[partyId]/page')

const provider = (o: Partial<ServiceProviderDetail> = {}): ServiceProviderDetail => ({
  party_id: 'p1',
  name: 'HUB24',
  role_status: 'active',
  since: '2025-02-01',
  ended: null,
  notes: null,
  contact_points: [{ kind: 'email', value: 'adviser@hub24.example', is_preferred: true }],
  ...o,
})

const show = async (p: ServiceProviderDetail | null) => {
  PROVIDER = p
  return render(await ServiceProviderPage({ params: Promise.resolve({ partyId: 'p1' }) }))
}

describe('the provider page', () => {
  test('a party that is not a provider is not found — one answer for every wrong', async () => {
    await expect(show(null)).rejects.toThrow('notFound')
  })

  test('names the provider under the register’s breadcrumb', async () => {
    await show(provider())
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('HUB24')
    const crumbs = screen.getByRole('navigation', { name: 'Breadcrumb' })
    expect(within(crumbs).getByRole('link', { name: 'Groups' }).getAttribute('href')).toBe('/groups')
    expect(within(crumbs).getByRole('link', { name: 'Service providers' }).getAttribute('href')).toBe(
      '/groups?section=providers',
    )
  })

  test('the profile reads the record: since, contacts, preferred marked', async () => {
    await show(provider())
    expect(screen.getByText('2025-02-01')).toBeTruthy()
    expect(screen.getByText('adviser@hub24.example')).toBeTruthy()
    expect(screen.getByText(/Email · preferred/)).toBeTruthy()
  })

  test('an ended provider says so instead of wearing active', async () => {
    await show(provider({ role_status: 'ended', ended: '2026-01-31' }))
    expect(screen.getByText('Ended 2026-01-31')).toBeTruthy()
  })

  /* The reserved columns are placeholders that SAY SO — an empty list here
     would imply a join (holdings → provider) that the schema does not have. */
  test('the reserved columns name what they are reserved for', async () => {
    const { container } = await show(provider())
    expect(screen.getByText('Accounts and policies with this provider')).toBeTruthy()
    expect(screen.getByText('Notes and activity')).toBeTruthy()
    const cols = Array.from(container.querySelectorAll<HTMLElement>(':scope > div[class*="lg:col-span-"]'))
    expect(cols.map((c) => (c.className.match(/lg:col-span-\d+/) ?? [''])[0])).toEqual([
      'lg:col-span-3',
      'lg:col-span-6',
      'lg:col-span-3',
    ])
  })
})
