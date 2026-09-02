import { describe, expect, test, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

/**
 * The server actions import next/headers, which cannot run outside a request.
 * Mocked so the component's own behaviour can be tested — the actions
 * themselves are exercised against the real database, not here.
 */
vi.mock('@/app/(shell)/groups/actions', () => ({
  createMember: vi.fn(),
  updateMember: vi.fn(),
  linkMember: vi.fn(),
  searchPeople: vi.fn(async () => []),
}))

const { MemberPanel } = await import('@/components/member-panel')
const { default: React } = await import('react')

const person = {
  party_id: 'p1',
  display_name: 'Pri Drawertest',
  is_person: true,
  status: 'active',
  notes: 'Prefers email.',
  title: 'Ms',
  first_name: 'Priya',
  middle_name: 'Anne',
  last_name: 'Drawertest',
  preferred_name: 'Pri',
  date_of_birth: '1985-04-12',
  gender: 'Female',
  marital_status: 'Married',
  tfn_status: 'provided',
  member_role: 'spouse_partner',
  is_primary_group: true,
  email: 'priya@example.com',
  mobile: '0412 555 901',
  phone_other: null,
  address: { line1: '12 Bay Street', line2: null, suburb: 'Mosman', state: 'NSW', postcode: '2088' },
  roles: [{ role: 'client', status: 'active', start_date: '2026-09-02' }],
  other_groups: [{ name: 'Faketrade Pty Ltd Group', member_role: 'director' }],
}

function open(mode: 'view' | 'edit' | 'search' = 'view') {
  return render(
    <MemberPanel groupId="g1" members={[person]} initialMode={mode} initialPartyId="p1">
      trigger
    </MemberPanel>,
  )
}

describe('MemberPanel', () => {
  test('renders its trigger content and nothing else until opened', () => {
    const { container } = open()
    expect(screen.getByRole('button', { name: 'trigger' })).toBeDefined()
    expect(container.querySelector('dialog')?.hasAttribute('open')).toBe(false)
  })

  /* The panel must be a modal dialog, not a styled div. That is what makes the
     rest of the UI inactive and holds focus inside — the actual brief. */
  test('is a native dialog, so the background is genuinely inert', () => {
    const { container } = open()
    const dialog = container.querySelector('dialog')
    expect(dialog).not.toBeNull()
    expect(dialog?.className).toContain('qw-drawer')
  })

  test('view mode shows the record read-only, with no inputs', async () => {
    const user = userEvent.setup()
    const { container } = open('view')
    await user.click(screen.getByRole('button', { name: 'trigger' }))

    expect(screen.getByText('Ms Priya Anne Drawertest')).toBeDefined()
    // Contact lives on its own tab now. Inactive panels stay mounted with
    // `hidden`, so the value is present in the DOM either way.
    expect(screen.getByText('priya@example.com')).toBeDefined()
    expect(screen.getByText('12 Bay Street')).toBeDefined()
    expect(screen.getByText('Mosman')).toBeDefined()
    // Nothing editable: a client record is audited on every change, so reading
    // one must not be able to alter it.
    expect(container.querySelectorAll('dialog input').length).toBe(0)
  })

  test('the record is split across Identity, Contact and Standing', async () => {
    const user = userEvent.setup()
    open('view')
    await user.click(screen.getByRole('button', { name: 'trigger' }))

    const tabs = screen.getAllByRole('tab').map((t) => t.textContent)
    expect(tabs).toEqual(['Identity', 'Contact', 'Standing'])

    // Exactly one panel is exposed at a time; `hidden` keeps the others out of
    // the accessibility tree even though they stay mounted.
    expect(screen.getAllByRole('tabpanel')).toHaveLength(1)

    await user.click(screen.getByRole('tab', { name: 'Standing' }))
    expect(screen.getByRole('tab', { name: 'Standing' }).getAttribute('aria-selected')).toBe('true')
    expect(screen.getByRole('tabpanel').textContent).toContain('Primary group')
  })

  test('an absent value reads as a gap rather than being hidden', async () => {
    const user = userEvent.setup()
    open('view')
    await user.click(screen.getByRole('button', { name: 'trigger' }))
    // phone_other is null on the fixture.
    expect(screen.getByText('Other phone')).toBeDefined()
    expect(screen.getAllByText('—').length).toBeGreaterThan(0)
  })

  test('Edit switches to a form with the values already in it', async () => {
    const user = userEvent.setup()
    open('view')
    await user.click(screen.getByRole('button', { name: 'trigger' }))
    await user.click(screen.getByRole('button', { name: 'Edit' }))

    expect(screen.getByDisplayValue('Priya')).toBeDefined()
    expect(screen.getByDisplayValue('Drawertest')).toBeDefined()
    expect(screen.getByDisplayValue('priya@example.com')).toBeDefined()
    expect(screen.getByRole('button', { name: /save changes/i })).toBeDefined()
  })

  test('Cancel from edit returns to view rather than closing', async () => {
    const user = userEvent.setup()
    open('view')
    await user.click(screen.getByRole('button', { name: 'trigger' }))
    await user.click(screen.getByRole('button', { name: 'Edit' }))
    await user.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(screen.getByText('Ms Priya Anne Drawertest')).toBeDefined()
    expect(screen.queryByRole('button', { name: /save changes/i })).toBeNull()
  })

  test('search mode offers finding someone before creating them', async () => {
    const user = userEvent.setup()
    open('search')
    await user.click(screen.getByRole('button', { name: 'trigger' }))

    expect(screen.getByPlaceholderText(/start typing a name/i)).toBeDefined()
    // The route out of a duplicate: create is offered, but second.
    expect(screen.getByRole('button', { name: /create someone new/i })).toBeDefined()
  })
})
