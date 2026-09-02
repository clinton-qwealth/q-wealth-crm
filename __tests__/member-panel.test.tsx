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
  patchMember: vi.fn(),
  linkMember: vi.fn(),
  revealSensitiveField: vi.fn(async () => ({ error: 'not in this test' })),
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
  date_of_death: null,
  gender: 'Female',
  marital_status: 'Married',
  tfn_status: 'provided',
  place_of_birth: 'Colombo, Sri Lanka',
  smoker: false,
  primary_citizenship: 'AU',
  secondary_citizenship: 'LK',
  tax_residency: 'AU',
  employment_status: 'self_employed',
  occupation: 'Architect',
  company_name: 'Drawertest Design Pty Ltd',
  hin: 'X0001234567',
  chess_pid: 'PID20179',
  coffee_preference: 'Flat white, no sugar',
  hints: {} as Record<string, string>,
  member_role: 'spouse_partner',
  is_primary_group: true,
  email: 'priya@example.com',
  mobile: '0412 555 901',
  phone_other: null,
  address: { line1: '12 Bay Street', line2: null, suburb: 'Mosman', state: 'NSW', postcode: '2088' },
  roles: [{ role: 'client', status: 'active', start_date: '2026-09-02' }],
  other_groups: [{ name: 'Faketrade Pty Ltd Group', member_role: 'director' }],
}

function open(mode: 'view' | 'search' = 'view') {
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

  test('the record is split across five tabs', async () => {
    const user = userEvent.setup()
    open('view')
    await user.click(screen.getByRole('button', { name: 'trigger' }))

    const tabs = screen.getAllByRole('tab').map((t) => t.textContent)
    expect(tabs).toEqual(['Personal', 'Contact', 'Compliance', 'Estate', 'Other'])

    // Exactly one panel is exposed at a time; `hidden` keeps the others out of
    // the accessibility tree even though they stay mounted.
    expect(screen.getAllByRole('tabpanel')).toHaveLength(1)

    await user.click(screen.getByRole('tab', { name: 'Other' }))
    expect(screen.getByRole('tab', { name: 'Other' }).getAttribute('aria-selected')).toBe('true')
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

  /* The panel-wide Edit button was replaced by a pencil per section, so
     correcting one field cannot put twenty others into an editable state. */
  test('each section has its own edit control, and the panel has none', async () => {
    const user = userEvent.setup()
    open('view')
    await user.click(screen.getByRole('button', { name: 'trigger' }))

    expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull()
    expect(screen.getByRole('button', { name: /edit identity/i })).toBeDefined()
    expect(screen.getByRole('button', { name: /edit employment/i })).toBeDefined()
  })

  test('the pencil makes only its own section editable', async () => {
    const user = userEvent.setup()
    const { container } = open('view')
    await user.click(screen.getByRole('button', { name: 'trigger' }))

    expect(container.querySelectorAll('dialog input[name]').length).toBe(0)
    await user.click(screen.getByRole('button', { name: /edit employment/i }))

    // Employment's fields appear...
    expect(screen.getByDisplayValue('Architect')).toBeDefined()
    // ...and Identity's do not.
    expect(screen.queryByDisplayValue('Priya')).toBeNull()
  })

  /**
   * The reason per-section editing is safe: a section's form carries only its
   * own fields, and update_person_patch leaves untouched columns alone. If a
   * section's form ever gained a hidden copy of another section's data, a save
   * could overwrite it — so the field set is asserted, not assumed.
   */
  test('a section submits only its own fields, plus the two identifiers', async () => {
    const user = userEvent.setup()
    const { container } = open('view')
    await user.click(screen.getByRole('button', { name: 'trigger' }))
    await user.click(screen.getByRole('button', { name: /edit preferences/i }))

    const form = container.querySelector('dialog form:has(input[name="coffee_preference"])')
    const names = [...form!.querySelectorAll('input[name], select[name], textarea[name]')].map(
      (el) => el.getAttribute('name'),
    )
    expect(names.sort()).toEqual(['coffee_preference', 'group_id', 'party_id'])
  })

  test('Cancel on a section returns it to read-only', async () => {
    const user = userEvent.setup()
    open('view')
    await user.click(screen.getByRole('button', { name: 'trigger' }))
    await user.click(screen.getByRole('button', { name: /edit employment/i }))
    expect(screen.getByDisplayValue('Architect')).toBeDefined()

    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByDisplayValue('Architect')).toBeNull()
    expect(screen.getByText('Architect')).toBeDefined()
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
