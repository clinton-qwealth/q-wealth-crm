import { render, screen, within } from '@testing-library/react'
import { describe, expect, test, vi } from 'vitest'
import type { ProviderHolding, ServiceProviderDetail } from '@/lib/groups'

/**
 * The provider page's skeleton: the client group page's three columns with a
 * provider's furniture — profile left, two RESERVED columns that each say what
 * they are reserved for, and one answer for every kind of wrong id.
 */
let PROVIDER: ServiceProviderDetail | null = null
let HOLDINGS: ProviderHolding[] = []
const CONTACTS: unknown[] = []

vi.mock('next/navigation', () => ({
  redirect: () => { throw new Error('redirect') },
  notFound: () => { throw new Error('notFound') },
}))
vi.mock('@/lib/staff', () => ({
  getCurrentStaff: async () => ({ id: 's1', status: 'active' }),
}))
vi.mock('@/lib/groups', () => ({
  getServiceProvider: async () => PROVIDER,
  getProviderHoldings: async () => HOLDINGS,
  getProviderContacts: async () => CONTACTS,
}))
/* The well is its own component with its own tests; the page only seats it. */
vi.mock('@/components/provider-logo-box', () => ({
  ProviderLogoBox: () => <div data-slot="provider-logo-box" />,
}))
vi.mock('@/components/provider-contacts', () => ({
  ProviderContacts: ({ providerPartyId }: { providerPartyId: string }) => (
    <div data-slot="provider-contacts">{providerPartyId}</div>
  ),
}))

const { default: ServiceProviderPage } = await import('@/app/(shell)/groups/providers/[partyId]/page')

const provider = (o: Partial<ServiceProviderDetail> = {}): ServiceProviderDetail => ({
  party_id: 'p1',
  name: 'HUB24',
  role_status: 'active',
  since: '2025-02-01',
  ended: null,
  notes: null,
  logo_path: null,
  contact_points: [{ kind: 'email', value: 'adviser@hub24.example', is_preferred: true }],
  ...o,
})

const holding = (o: Partial<ProviderHolding>): ProviderHolding => ({
  kind: 'account',
  group_id: 'g1',
  group_name: 'Testsmith Household',
  record_id: 'a1',
  label: 'HUB24 Invest',
  status: 'active',
  number: null,
  cover_types: null,
  lives_insured: null,
  total_lump_sum_cover: null,
  total_monthly_benefit: null,
  ...o,
})

const show = async (p: ServiceProviderDetail | null, holdings: ProviderHolding[] = []) => {
  PROVIDER = p
  HOLDINGS = holdings
  return render(await ServiceProviderPage({ params: Promise.resolve({ partyId: 'p1' }) }))
}

describe('the provider page', () => {
  test('a party that is not a provider is not found — one answer for every wrong', async () => {
    await expect(show(null)).rejects.toThrow('notFound')
  })

  /**
   * With a logo, the mark STANDS WHERE THE NAME WOULD — but the h1's
   * accessible name must not change: the image's alt carries it, so heading
   * navigation, the e2e suite's name lookups and this very query all still
   * resolve "HUB24". A logo that replaced the h1's CONTENTS with a nameless
   * image would pass a render test and silently unname the page.
   */
  test('a provider with a logo wears it as the title, name intact underneath', async () => {
    await show(provider({ logo_path: 'p1/abc.png' }))
    const h1 = screen.getByRole('heading', { level: 1, name: 'HUB24' })
    const img = h1.querySelector('img') as HTMLImageElement
    expect(img.getAttribute('src')).toContain('/api/provider-logo/p1')
    expect(img.getAttribute('alt')).toBe('HUB24')
    /* The breadcrumb stays above it, unchanged. */
    expect(screen.getByRole('navigation', { name: 'Breadcrumb' })).toBeTruthy()
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

  test('the key contacts well sits on the profile card, keyed to this provider', async () => {
    const { container } = await show(provider())
    const slot = container.querySelector('[data-slot="provider-contacts"]')
    expect(slot?.textContent).toBe('p1')
    /* Inside the LEFT column's card, where the households keep their members
       — same object, same place, so the two pages read as one design. */
    expect(slot?.closest('section')).toBe(container.querySelector('div[class*="lg:col-span-3"] section'))
  })

  test('the right column stays reserved and says for what; the shape holds', async () => {
    const { container } = await show(provider())
    expect(screen.getByText('Notes and activity')).toBeTruthy()
    const cols = Array.from(container.querySelectorAll<HTMLElement>(':scope > div[class*="lg:col-span-"]'))
    expect(cols.map((c) => (c.className.match(/lg:col-span-\d+/) ?? [''])[0])).toEqual([
      'lg:col-span-3',
      'lg:col-span-6',
      'lg:col-span-3',
    ])
  })
})

/**
 * The middle column went live on 26 Sep, when the provider_party_id links were
 * backfilled: it lists every holding the READER can see (the view is invoker
 * rights), each row opening the household that holds it. The provider's kind
 * is DERIVED from these — platform if accounts reference them, insurer if
 * policies do — never stored, so it cannot drift from the holdings.
 */
describe('the holdings', () => {
  test('list under their kind, each opening the household that holds them', async () => {
    await show(provider(), [
      holding({}),
      holding({ kind: 'policy', record_id: 'i1', label: 'AIA Priority Protection', group_name: 'Brown Family', group_id: 'g2' }),
    ])
    expect(screen.getByText('Accounts')).toBeTruthy()
    expect(screen.getByText('Policies')).toBeTruthy()
    expect(screen.getByRole('link', { name: /HUB24 Invest/ }).getAttribute('href')).toBe('/groups/g1')
    expect(screen.getByRole('link', { name: /AIA Priority Protection/ }).getAttribute('href')).toBe('/groups/g2')
  })

  test('derive what the provider provides — both kinds, both words', async () => {
    await show(provider(), [holding({}), holding({ kind: 'policy', record_id: 'i1' })])
    expect(screen.getByText('Platform · Insurer')).toBeTruthy()
  })

  test('an insurer alone is not called a platform', async () => {
    await show(provider(), [holding({ kind: 'policy', record_id: 'i1' })])
    expect(screen.getByText('Insurer')).toBeTruthy()
    expect(screen.queryByText(/Platform/)).toBeNull()
    /* And the empty kind's section does not render — "Accounts (0)" under an
       insurer is noise. */
    expect(screen.queryByText('Accounts')).toBeNull()
  })

  test('nothing held is said plainly, with the visibility caveat', async () => {
    await show(provider(), [])
    expect(screen.getByText('Nothing held with this provider')).toBeTruthy()
    expect(screen.getByText(/visibility here follows your group access/)).toBeTruthy()
    expect(screen.getByText('Nothing held with them yet')).toBeTruthy()
  })

  test('a dormant holding wears its status; a live one wears nothing', async () => {
    await show(provider(), [holding({}), holding({ record_id: 'a2', label: 'Old wrap', status: 'closed' })])
    expect(screen.getByText('closed')).toBeTruthy()
    /* Scoped to the row: the PROFILE card legitimately says "active" about the
       provider's own role, which is a different fact. */
    expect(within(screen.getByRole('link', { name: /HUB24 Invest/ })).queryByText('active')).toBeNull()
  })

  /**
   * The policy rows are the GROUP page's insurance rows, re-cut: cover words,
   * lives insured, the two-unit figure — plus "held by", which is this page's
   * own fact. What a plausible cut gets wrong, and what is pinned:
   *
   * - **The enum leaks.** `income_protection` on the row instead of "Income
   *   protection" — the exact drift COVER_TYPE_LABEL exists to stop.
   * - **The two units get summed.** $750,000 of life plus $6,500/mo is not
   *   $756,500 — `coverSummary` joins them, and the row must too.
   * - **A cancelled policy wears a live tile.** The tile carries the word.
   */
  test('a policy row reads covers, lives, holder — and the two-unit figure unsummed', async () => {
    await show(provider(), [
      holding({
        kind: 'policy',
        record_id: 'i1',
        label: 'TAL Accelerated Protection',
        cover_types: 'life, income_protection',
        lives_insured: 'Janet Testsmith',
        total_lump_sum_cover: 750000,
        total_monthly_benefit: 6500,
      }),
    ])
    const row = screen.getByRole('link', { name: /TAL Accelerated Protection/ })
    expect(row.textContent).toContain('Life, Income protection')
    expect(row.textContent).not.toContain('income_protection')
    expect(row.textContent).toContain('Janet Testsmith')
    expect(row.textContent).toContain('held by Testsmith Household')
    expect(row.textContent).toContain('$750,000 + $6,500/mo')
    expect(row.textContent).not.toContain('756,500')
  })

  test('a cancelled policy goes dormant on the tile, with the word for a pointer', async () => {
    await show(provider(), [
      holding({ kind: 'policy', record_id: 'i2', label: 'Old cover', status: 'cancelled' }),
    ])
    const row = screen.getByRole('link', { name: /Old cover/ })
    expect(within(row).getByTitle('Cancelled')).toBeTruthy()
  })
})
