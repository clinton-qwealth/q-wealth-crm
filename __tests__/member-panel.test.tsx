import type { VerificationEntry } from '@/lib/person'
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
  startVerification: vi.fn(),
  checkVerification: vi.fn(),
  attestVerification: vi.fn(),
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
  verifications: [],
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

  describe('the identity verification history', () => {
    const entry: VerificationEntry = {
      id: 'v1',
      provider: 'twilio_verify',
      destination_masked: '•••• 901',
      status: 'passed',
      attempts: 1,
      failure_reason: null,
      requested_at: '2026-09-03T04:32:00.000Z',
      requested_by_name: 'A Adviser',
      outcome_source: 'code_checked',
      outcome_at: '2026-09-03T04:33:10.000Z',
      outcome_by_name: 'A Adviser',
    }

    function openWith(verifications: VerificationEntry[]) {
      return render(
        <MemberPanel groupId="g1" members={[{ ...person, verifications }]} initialMode="view" initialPartyId="p1">
          trigger
        </MemberPanel>,
      )
    }

    test('an empty history says so rather than showing nothing', async () => {
      const user = userEvent.setup()
      openWith([])
      await user.click(screen.getByRole('button', { name: 'trigger' }))
      await user.click(screen.getByRole('tab', { name: 'Activity' }))
      expect(screen.getByText(/no identity verification has been requested/i)).toBeDefined()
    })

    /* The four facts asked for: the outcome, when it happened, who requested it
       and who recorded the result. */
    test('an entry carries the outcome, the times and both names', async () => {
      const user = userEvent.setup()
      openWith([entry])
      await user.click(screen.getByRole('button', { name: 'trigger' }))
      await user.click(screen.getByRole('tab', { name: 'Activity' }))

      const panel = screen.getByRole('tabpanel').textContent ?? ''
      expect(panel).toContain('Verified')
      expect(panel).toContain('•••• 901')
      expect(panel).toContain('A Adviser')
      expect(panel).toMatch(/03 Sept? 2026/)
      expect(panel).toContain('Code confirmed')
    })

    /**
     * The distinction the database keeps deliberately. A provider-confirmed
     * code and an adviser's word are different evidence, so the history must
     * not render them identically.
     */
    test('an attested outcome is labelled as such, a checked one is not', async () => {
      const user = userEvent.setup()
      openWith([
        { ...entry, id: 'v2', outcome_source: 'adviser_attested' },
      ])
      await user.click(screen.getByRole('button', { name: 'trigger' }))
      await user.click(screen.getByRole('tab', { name: 'Activity' }))

      const panel = screen.getByRole('tabpanel').textContent ?? ''
      expect(panel).toContain('Adviser attested')
      expect(panel).toContain('Attested')
      expect(panel).not.toContain('Code confirmed')
    })

    /* A stubbed run is not evidence of anything and must never read as if it
       were, however the record is later summarised. */
    test('a stubbed run is marked as having sent no message', async () => {
      const user = userEvent.setup()
      openWith([{ ...entry, id: 'v3', provider: 'stub' }])
      await user.click(screen.getByRole('button', { name: 'trigger' }))
      await user.click(screen.getByRole('tab', { name: 'Activity' }))
      expect(screen.getByText(/no message sent/i)).toBeDefined()
    })

    test('a verification still awaiting a read-back shows no outcome', async () => {
      const user = userEvent.setup()
      openWith([
        {
          ...entry,
          id: 'v4',
          status: 'pending',
          attempts: 0,
          outcome_source: null,
          outcome_at: null,
          outcome_by_name: null,
        },
      ])
      await user.click(screen.getByRole('button', { name: 'trigger' }))
      await user.click(screen.getByRole('tab', { name: 'Activity' }))

      const panel = screen.getByRole('tabpanel').textContent ?? ''
      expect(panel).toContain('Awaiting read-back')
      expect(panel).not.toContain('Recorded by')
    })
  })

  describe('requesting a verification', () => {
    const started = {
      ok: true as const,
      verification_id: 'v9',
      destination_masked: '•••• 901',
      provider: 'twilio_verify',
      expires_in_seconds: 600,
    }

    async function pressVerify() {
      const user = userEvent.setup()
      open('view')
      await user.click(screen.getByRole('button', { name: 'trigger' }))
      await user.click(screen.getByRole('button', { name: /verify/i }))
      return user
    }

    /**
     * The code must NEVER appear in the browser. This is the whole reason the
     * first design was rejected, so it is asserted rather than trusted: the
     * panel shows only where the code went, and an empty box to type into.
     */
    test('sending a code shows the masked destination and an empty box, never a code', async () => {
      vi.mocked(actions.startVerification).mockResolvedValue(started)
      await pressVerify()

      expect(await screen.findByText(/•••• 901/)).toBeDefined()
      const input = screen.getByLabelText(/code the client read back/i) as HTMLInputElement
      expect(input.value).toBe('')

      /* A blanket scan for six consecutive digits cannot be used here: the
         record legitimately contains identifiers like a HIN that match it. The
         precise guard is that the element the rejected design used to display
         the code in — a live region — does not exist at all. */
      expect(screen.queryByRole('status')).toBeNull()
      expect(actions.startVerification).toHaveBeenCalledWith('p1', 'g1')
    })

    test('a confirmed code records a pass', async () => {
      vi.mocked(actions.startVerification).mockResolvedValue(started)
      vi.mocked(actions.checkVerification).mockResolvedValue({
        ok: true,
        passed: true,
        outcome_source: 'code_checked',
      })
      const user = await pressVerify()

      await user.type(await screen.findByLabelText(/code the client read back/i), '481920')
      await user.click(screen.getByRole('button', { name: 'Check' }))

      expect(await screen.findByText('Verified')).toBeDefined()
      expect(actions.checkVerification).toHaveBeenCalledWith('v9', '481920')
    })

    test('Check stays disabled until six digits are entered', async () => {
      vi.mocked(actions.startVerification).mockResolvedValue(started)
      const user = await pressVerify()
      const check = await screen.findByRole('button', { name: 'Check' })
      expect((check as HTMLButtonElement).disabled).toBe(true)
      await user.type(screen.getByLabelText(/code the client read back/i), '48192')
      expect((check as HTMLButtonElement).disabled).toBe(true)
      await user.type(screen.getByLabelText(/code the client read back/i), '0')
      expect((check as HTMLButtonElement).disabled).toBe(false)
    })

    /* The fallback path, and the label that keeps it honest. */
    test('the tick attests without a code, and says so', async () => {
      vi.mocked(actions.startVerification).mockResolvedValue(started)
      vi.mocked(actions.attestVerification).mockResolvedValue({
        ok: true,
        passed: true,
        outcome_source: 'adviser_attested',
      })
      const user = await pressVerify()
      await user.click(await screen.findByRole('button', { name: /confirm identity another way/i }))

      expect(await screen.findByText(/Verified \(attested\)/)).toBeDefined()
    })

    test('a refusal from the server is shown, not swallowed', async () => {
      vi.mocked(actions.startVerification).mockResolvedValue({
        error: 'That number has already been sent 3 codes in the last 10 minutes. Try again shortly.',
      })
      await pressVerify()
      expect(await screen.findByRole('alert')).toBeDefined()
      expect(screen.getByRole('alert').textContent).toContain('3 codes in the last 10 minutes')
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
