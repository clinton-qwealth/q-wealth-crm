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
  patchMember: vi.fn(),
  linkMember: vi.fn(),
  revealSensitiveField: vi.fn(async () => ({ error: 'not in this test' })),
  searchPeople: vi.fn(async () => []),
}))

const actions = await import('@/app/(shell)/groups/actions')
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

  test('the record is split across six tabs', async () => {
    const user = userEvent.setup()
    open('view')
    await user.click(screen.getByRole('button', { name: 'trigger' }))

    const tabs = screen.getAllByRole('tab').map((t) => t.textContent)
    expect(tabs).toEqual([
      'Personal', 'Contact', 'Compliance', 'Estate', 'Memberships', 'Activity',
    ])

    // Exactly one panel is exposed at a time; `hidden` keeps the others out of
    // the accessibility tree even though they stay mounted.
    expect(screen.getAllByRole('tabpanel')).toHaveLength(1)

    await user.click(screen.getByRole('tab', { name: 'Memberships' }))
    expect(screen.getByRole('tab', { name: 'Memberships' }).getAttribute('aria-selected')).toBe('true')
    expect(screen.getByRole('tabpanel').textContent).toContain('Primary group')
  })

  /* Group standing and record history are different questions asked by
     different people, which is why they stopped sharing a tab. */
  test('memberships holds the groups, activity holds the notes', async () => {
    const user = userEvent.setup()
    open('view')
    await user.click(screen.getByRole('button', { name: 'trigger' }))

    await user.click(screen.getByRole('tab', { name: 'Memberships' }))
    const memberships = screen.getByRole('tabpanel').textContent ?? ''
    expect(memberships).toContain('Faketrade Pty Ltd Group')
    expect(memberships).not.toContain('Prefers email.')

    await user.click(screen.getByRole('tab', { name: 'Activity' }))
    const activity = screen.getByRole('tabpanel').textContent ?? ''
    expect(activity).toContain('Prefers email.')
    expect(activity).not.toContain('Faketrade Pty Ltd Group')
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

  /**
   * A successful save has to put the section back to read-only by itself. This
   * is adjusted during render rather than in an effect, so it is worth pinning:
   * the failure mode is a section that stays in edit mode after saving, leaving
   * the user unsure whether the change went through.
   */
  test('a successful save returns the section to read-only', async () => {
    const user = userEvent.setup()
    vi.mocked(actions.patchMember).mockResolvedValue({ ok: true })
    open('view')
    await user.click(screen.getByRole('button', { name: 'trigger' }))
    await user.click(screen.getByRole('button', { name: /edit preferences/i }))
    expect(screen.getByDisplayValue('Flat white, no sugar')).toBeDefined()

    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(screen.queryByDisplayValue('Flat white, no sugar')).toBeNull()
    expect(screen.getByText('Flat white, no sugar')).toBeDefined()
  })

  /* The other half: a refused save must keep the fields on screen, or the
     user's typing is lost along with the explanation of why. */
  test('a refused save keeps the section open and says why', async () => {
    const user = userEvent.setup()
    vi.mocked(actions.patchMember).mockResolvedValue({ error: 'Enter a first name.' })
    open('view')
    await user.click(screen.getByRole('button', { name: 'trigger' }))
    await user.click(screen.getByRole('button', { name: /edit preferences/i }))

    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByText('Enter a first name.')).toBeDefined()
    expect(screen.getByDisplayValue('Flat white, no sugar')).toBeDefined()
  })

  /**
   * The name row: title, first and middle names share the top row and the
   * surname takes the next, because at four across a long surname was clipped
   * inside its box. jsdom has no layout engine, so the spans that produce the
   * wrap are asserted here and the geometry was measured in a real browser.
   */
  test('the surname sits on its own row, not fourth across', async () => {
    const user = userEvent.setup()
    const { container } = open('view')
    await user.click(screen.getByRole('button', { name: 'trigger' }))
    await user.click(screen.getByRole('button', { name: /edit identity/i }))

    const span = (name: string) => {
      const cls = container.querySelector(`dialog [name="${name}"]`)!.parentElement!.className
      return Number(/sm:col-span-(\d+)/.exec(cls)![1])
    }
    // A full twelve columns of given names, so the surname cannot fit beside them.
    expect(span('title') + span('first_name') + span('middle_name')).toBe(12)
    expect(span('last_name')).toBe(6)
  })

  test('gender is chosen from a list, not typed', async () => {
    const user = userEvent.setup()
    const { container } = open('view')
    await user.click(screen.getByRole('button', { name: 'trigger' }))
    await user.click(screen.getByRole('button', { name: /edit identity/i }))

    const select = container.querySelector('dialog select[name="gender"]') as HTMLSelectElement
    expect(select).not.toBeNull()
    expect(container.querySelector('dialog input[name="gender"]')).toBeNull()
    // The stored value must be the one selected, not the first option.
    expect(select.value).toBe('Female')
    expect([...select.options].map((o) => o.value)).toEqual([
      '', 'Female', 'Male', 'Non-binary', 'Prefer not to say',
    ])
  })

  /**
   * The column is free text and writable through the MCP, so it can hold a value
   * the dropdown does not offer. That value has to stay selected: if the select
   * fell back to its empty option, the next save of the section would clear a
   * real value without anyone touching the field.
   */
  test('a stored gender outside the list is kept rather than cleared', async () => {
    const user = userEvent.setup()
    const { container } = render(
      <MemberPanel groupId="g1" members={[{ ...person, gender: 'Indeterminate' }]} initialMode="view" initialPartyId="p1">
        trigger
      </MemberPanel>,
    )
    await user.click(screen.getByRole('button', { name: 'trigger' }))
    await user.click(screen.getByRole('button', { name: /edit identity/i }))

    const select = container.querySelector('dialog select[name="gender"]') as HTMLSelectElement
    expect(select.value).toBe('Indeterminate')
  })

  describe('identity verification', () => {
    test('the header offers Verify, and it produces a six-digit code', async () => {
      const user = userEvent.setup()
      open('view')
      await user.click(screen.getByRole('button', { name: 'trigger' }))

      await user.click(screen.getByRole('button', { name: 'Verify' }))
      expect(screen.getByRole('status').textContent).toMatch(/^\d{6}$/)
    })

    /* Six digits every time, including the one in ten draws that lands below
       100000. A real random code is already six digits about nine times in ten,
       so left to chance this is the assertion that would not have held. */
    test('a small draw is padded rather than shown short', async () => {
      const user = userEvent.setup()
      const spy = vi.spyOn(crypto, 'getRandomValues').mockImplementation((array) => {
        ;(array as Uint32Array)[0] = 42
        return array
      })
      open('view')
      await user.click(screen.getByRole('button', { name: 'trigger' }))
      await user.click(screen.getByRole('button', { name: 'Verify' }))

      expect(screen.getByRole('status').textContent).toBe('000042')
      spy.mockRestore()
    })

    test('the tick records a pass and the cross records a fail', async () => {
      const user = userEvent.setup()
      open('view')
      await user.click(screen.getByRole('button', { name: 'trigger' }))

      await user.click(screen.getByRole('button', { name: 'Verify' }))
      await user.click(screen.getByRole('button', { name: /verification as passed/i }))
      expect(screen.getByText('Verified')).toBeDefined()
      expect(screen.queryByRole('status')).toBeNull()
      // The pill's own text is a state; the button must announce the action.
      expect(screen.getByRole('button', { name: 'Verified. Verify again' })).toBeDefined()

      // The outcome is a button, so a call that goes wrong can be run again.
      await user.click(screen.getByRole('button', { name: /verify again/i }))
      await user.click(screen.getByRole('button', { name: /verification as failed/i }))
      expect(screen.getByText('Not verified')).toBeDefined()
    })

    /* There is no one to telephone while a new person is still being typed in,
       and no party_id to verify against. */
    test('it is absent while creating someone', async () => {
      const user = userEvent.setup()
      open('search')
      await user.click(screen.getByRole('button', { name: 'trigger' }))
      expect(screen.queryByRole('button', { name: 'Verify' })).toBeNull()
    })
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
