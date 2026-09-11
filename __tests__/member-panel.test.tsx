import type { PersonDetail, VerificationEntry } from '@/lib/person'
import { describe, expect, test, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
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
  removeMember: vi.fn(async () => ({ ok: true as const })),
  startVerification: vi.fn(),
  checkVerification: vi.fn(),
  attestVerification: vi.fn(),
}))

const actions = await import('@/app/(shell)/groups/actions')
const { MemberPanel } = await import('@/components/member-panel')
const { default: React } = await import('react')

/* Typed, so the fixture has to keep up with PersonDetail rather than drifting
   into a shape the app no longer produces — and so a field can be overridden
   with a real value instead of the null TypeScript would otherwise infer. */
const person: PersonDetail = {
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
  other_groups: [
    { name: 'Faketrade Pty Ltd Group', member_role: 'director', is_primary_group: false },
  ],
  postal_address: { line1: null, line2: null, suburb: null, state: null, postcode: null },
  postal_same_as_residential: true,
  verifications: [],
}

function open(mode: 'view' | 'search' = 'view') {
  return render(
    <MemberPanel groupId="g1" groupName="Testsmith Household" members={[person]} initialMode={mode} initialPartyId="p1">
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

  /**
   * **Every section of the panel sits on one gutter**, widened 20 → 24 → 32
   * on 11 September 2026, a step at a time on sight.
   *
   * The value matters less than the agreement. The header, each tab's body and
   * the footer are separate elements with separate class lists, and the tab
   * strip is told its gutter as a prop — so there are four places to change and
   * any one of them left behind puts the record's name, its tab labels and its
   * values on three different left edges. That is what this asserts: not that
   * the number is 6, but that nothing is still on the old step.
   *
   * The boxed sections inside are deliberately excluded. A card on a roomier
   * ground keeps its own 16px, or its fields end up 40px from the panel's edge.
   */
  test('the header, the body and the footer share one gutter', async () => {
    const user = userEvent.setup()
    const { container } = open('view')
    await user.click(screen.getByRole('button', { name: 'trigger' }))

    const gutters = ['header', 'footer', '[role="tabpanel"]:not([hidden]) > div']
      .map((sel) => container.querySelector(`dialog ${sel}`))
      .map((el) => (el?.getAttribute('class') ?? '').match(/\bpx-\d+\b/)?.[0])

    expect(gutters, 'a section carries no horizontal padding at all').not.toContain(
      undefined,
    )
    expect(new Set(gutters), 'the sections are on different left edges').toEqual(
      new Set(['px-8']),
    )
  })

  /* The strip is padded by its own prop rather than by a class, so it is the
     one that goes stale silently — nothing about it looks wrong in the markup. */
  test('and the tab strip is padded to match, so the first label lines up', async () => {
    const user = userEvent.setup()
    const { container } = open('view')
    await user.click(screen.getByRole('button', { name: 'trigger' }))

    const strip = container.querySelector('dialog [role="tablist"]')!
    /* `alignFirst` takes the button's own 12px off the left, so a 32px gutter
       is pl-5 + the button's px-3. The right side carries it whole. */
    expect(strip.className).toContain('pr-8')
    expect(strip.className).toContain('pl-5')
  })

  test('view mode shows the record read-only, with no inputs', async () => {
    const user = userEvent.setup()
    const { container } = open('view')
    await user.click(screen.getByRole('button', { name: 'trigger' }))

    expect(screen.getByText('Ms Priya Anne Drawertest')).toBeDefined()
    /* Contact lives on its own tab, and since 11 September a panel is built
       the first time its tab is opened rather than rendered hidden at mount —
       so it has to be opened to be read. */
    await user.click(screen.getByRole('tab', { name: 'Contact' }))
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

  /**
   * The Memberships tab, rebuilt 11 September 2026.
   *
   * It was two sections — "This group", a two-field list, and "Other groups", a
   * name-and-role list — so the same three facts were laid out two different
   * ways on one tab, and **the group you were actually in was the only one
   * whose name never appeared.** Now every group is a row on one set of
   * columns, and the one you came in through is marked rather than described
   * separately.
   */
  describe('the Memberships tab', () => {
    const openTab = async () => {
      const user = userEvent.setup()
      const rendered = open('view')
      await user.click(screen.getByRole('button', { name: 'trigger' }))
      await user.click(screen.getByRole('tab', { name: 'Memberships' }))
      return { user, ...rendered }
    }
    const rows = () =>
      Array.from(document.querySelectorAll('[data-slot="membership-row"]')) as HTMLElement[]

    test('every group the person belongs to is a row, this one first', async () => {
      await openTab()
      expect(rows()).toHaveLength(2)
      expect(rows()[0].textContent).toContain('Testsmith Household')
      expect(rows()[1].textContent).toContain('Faketrade Pty Ltd Group')
    })

    /* The name is the fix. Before this the current group was described as
       "This group" and never named, which is the one group a reader cannot
       look up elsewhere on the tab. */
    test('and the current group is NAMED, not just called “this group”', async () => {
      await openTab()
      expect(rows()[0].textContent).toContain('Testsmith Household')
    })

    test('the row you came in through is marked, and only that one', async () => {
      await openTab()
      expect(rows()[0].getAttribute('data-here')).toBe('true')
      expect(rows()[1].getAttribute('data-here')).toBe('false')

      const marks = document.querySelectorAll('[data-slot="membership-row"] .bg-sky-50')
      expect(marks, 'exactly one group is the one you are in').toHaveLength(1)
      expect(rows()[0].textContent).toContain('This group')
      expect(rows()[1].textContent).not.toContain('This group')
    })

    /* Role and primary-group read the same way on every row. The point of the
       rebuild was that they did not: the current group's were a labelled field
       list and the others' were a right-aligned run of words. */
    test('role and primary group read the same way on every row', async () => {
      await openTab()
      // The fixture is a spouse here and primary, a director elsewhere and not.
      expect(rows()[0].textContent).toContain('Spouse')
      expect(rows()[0].textContent).toContain('Yes')
      expect(rows()[1].textContent).toContain('Director')
      expect(rows()[1].textContent).toContain('No')
      // Underscores never reach the screen.
      expect(rows().map((r) => r.textContent).join(' ')).not.toContain('_')
    })

    test('the section is boxed, like the other tabs’', async () => {
      await openTab()
      const box = rows()[0].closest('section')
      expect(box, 'the rows are not inside a section at all').not.toBeNull()
      expect(box!.className).toContain('border')
      expect(box!.className).toContain('rounded-lg')
    })

    /**
     * **Only this group offers Remove.** The panel is opened from one group's
     * page and acts on that group; a control that ended a membership of a group
     * the reader is not looking at would act somewhere they cannot see the
     * consequence.
     */
    test('only the current group can be left', async () => {
      await openTab()
      expect(within(rows()[0]).getByRole('button', { name: 'Remove' })).toBeTruthy()
      expect(within(rows()[1]).queryByRole('button', { name: 'Remove' })).toBeNull()
    })

    /* Two presses, not one — and deliberately not `window.confirm`, which
       inside a <dialog> is a modal over a modal and cannot be styled or read. */
    test('removing asks first, and the first press writes nothing', async () => {
      const { user } = await openTab()
      await user.click(within(rows()[0]).getByRole('button', { name: 'Remove' }))

      expect(within(rows()[0]).getByRole('button', { name: 'Confirm' })).toBeTruthy()
      expect(within(rows()[0]).getByRole('button', { name: 'Cancel' })).toBeTruthy()
      expect(actions.removeMember).not.toHaveBeenCalled()
    })

    test('cancelling puts it back and still writes nothing', async () => {
      const { user } = await openTab()
      await user.click(within(rows()[0]).getByRole('button', { name: 'Remove' }))
      await user.click(within(rows()[0]).getByRole('button', { name: 'Cancel' }))

      expect(within(rows()[0]).getByRole('button', { name: 'Remove' })).toBeTruthy()
      expect(actions.removeMember).not.toHaveBeenCalled()
    })

    test('confirming calls the action with this group and this person', async () => {
      vi.mocked(actions.removeMember).mockResolvedValueOnce({ ok: true })
      const { user } = await openTab()
      await user.click(within(rows()[0]).getByRole('button', { name: 'Remove' }))
      await user.click(within(rows()[0]).getByRole('button', { name: 'Confirm' }))

      await waitFor(() => expect(actions.removeMember).toHaveBeenCalledWith('g1', 'p1'))
    })

    /**
     * **The refusal is shown, and it outlives the confirmation that produced
     * it.** The database names who the primary contact is and what to do
     * instead; a generic message would throw that away. An earlier version
     * rendered the plain button again as soon as the confirm collapsed, which
     * dropped the message on the same render — the press then looked like it
     * had done nothing, which is the one thing a refusal must never resemble.
     */
    test('a refusal is shown in the row, in the database’s own words', async () => {
      vi.mocked(actions.removeMember).mockResolvedValueOnce({
        error: 'Janet Testsmith is this group’s primary contact. Name a different primary contact before removing them.',
      })
      const { user } = await openTab()
      await user.click(within(rows()[0]).getByRole('button', { name: 'Remove' }))
      await user.click(within(rows()[0]).getByRole('button', { name: 'Confirm' }))

      const alert = await screen.findByRole('alert')
      expect(alert.textContent).toContain('primary contact')
      expect(alert.textContent).toContain('Janet Testsmith')
      // And the control is usable again, rather than stuck mid-confirmation.
      expect(within(rows()[0]).getByRole('button', { name: 'Remove' })).toBeTruthy()
    })
  })

  test('an absent value reads as a gap rather than being hidden', async () => {
    const user = userEvent.setup()
    open('view')
    await user.click(screen.getByRole('button', { name: 'trigger' }))
    await user.click(screen.getByRole('tab', { name: 'Contact' }))
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

  /* Reachable on was a plain section for a while: no border, and no way to
     correct a mistyped email without going to the database. It sat directly
     above an editable, bordered address section, so the tab looked half-built. */
  test('Reachable on is editable, and carries only its own three fields', async () => {
    const user = userEvent.setup()
    const { container } = open('view')
    await user.click(screen.getByRole('button', { name: 'trigger' }))
    await user.click(screen.getByRole('tab', { name: 'Contact' }))
    await user.click(screen.getByRole('button', { name: /edit reachable on/i }))

    expect(screen.getByDisplayValue('priya@example.com')).toBeDefined()
    expect(screen.getByDisplayValue('0412 555 901')).toBeDefined()

    const form = container.querySelector('dialog form:has(input[name="mobile"])')
    const names = [...form!.querySelectorAll('input[name], select[name], textarea[name]')].map(
      (el) => el.getAttribute('name'),
    )
    // The address must not come along: it is patched as a unit by its own
    // section, and a form carrying both could blank half an address.
    expect(names.sort()).toEqual(['email', 'group_id', 'mobile', 'party_id', 'phone_other'])
  })

  /**
   * The address inputs became controlled so a chosen suggestion could fill
   * them. That swap is invisible if it goes wrong: the fields would still
   * render, still look right, and quietly submit nothing.
   */
  test('the address fields are still named and prefilled after becoming controlled', async () => {
    const user = userEvent.setup()
    const { container } = open('view')
    await user.click(screen.getByRole('button', { name: 'trigger' }))
    await user.click(screen.getByRole('tab', { name: 'Contact' }))
    await user.click(screen.getByRole('button', { name: /edit residential address/i }))

    expect(screen.getByDisplayValue('12 Bay Street')).toBeDefined()
    expect(screen.getByDisplayValue('Mosman')).toBeDefined()
    expect(screen.getByDisplayValue('NSW')).toBeDefined()
    expect(screen.getByDisplayValue('2088')).toBeDefined()

    const form = container.querySelector('dialog form:has(input[name="addr_suburb"])')
    const names = [...form!.querySelectorAll('input[name], select[name], textarea[name]')].map(
      (el) => el.getAttribute('name'),
    )
    // All five together — update_person_patch takes the address as a unit, so a
    // form carrying only some of them would blank the rest.
    expect(names.sort()).toEqual([
      'addr_line1', 'addr_line2', 'addr_postcode', 'addr_state', 'addr_suburb',
      'group_id', 'party_id',
    ])
  })

  /* Autocomplete fills; it must never constrain. A rural or overseas address
     will not be found, and a form that refuses one is worse than no lookup. */
  test('the address fields remain editable by hand', async () => {
    const user = userEvent.setup()
    open('view')
    await user.click(screen.getByRole('button', { name: 'trigger' }))
    await user.click(screen.getByRole('tab', { name: 'Contact' }))
    await user.click(screen.getByRole('button', { name: /edit residential address/i }))

    const suburb = screen.getByDisplayValue('Mosman') as HTMLInputElement
    expect(suburb.readOnly).toBe(false)
    await user.clear(suburb)
    await user.type(suburb, 'Wagga Wagga')
    expect((screen.getByDisplayValue('Wagga Wagga') as HTMLInputElement).name).toBe('addr_suburb')
  })

  /**
   * "It should be instant" is mostly about not going quiet. These pin the two
   * behaviours that decide whether it feels instant, both of which are
   * invisible in a screenshot.
   */
  describe('address lookup responsiveness', () => {
    function stubLookup() {
      const calls: string[] = []
      const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input)
        calls.push(url)
        return new Response(
          JSON.stringify({
            suggestions: [{ place_id: 'p1', label: '12 Bay Street, Mosman NSW 2088' }],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        )
      })
      vi.stubGlobal('fetch', fetchMock)
      return { calls, forQuery: (q: string) => calls.filter((u) => u.includes(`q=${encodeURIComponent(q)}`)).length }
    }

    async function openAddressEditor() {
      const user = userEvent.setup()
      open('view')
      await user.click(screen.getByRole('button', { name: 'trigger' }))
      await user.click(screen.getByRole('tab', { name: 'Contact' }))
      await user.click(screen.getByRole('button', { name: /edit residential address/i }))
      return user
    }

    test('a query already answered is served from memory, with no second request', async () => {
      const lookup = stubLookup()
      const user = await openAddressEditor()
      const box = screen.getByLabelText('Find an address')

      await user.type(box, '12 bay street')
      await waitFor(() => expect(screen.getByText(/12 Bay Street, Mosman/)).toBeDefined())
      expect(lookup.forQuery('12 bay street')).toBe(1)

      // Clear and type the identical query. The answer is remembered, so the
      // network must not be asked for it again.
      await user.clear(box)
      await user.type(box, '12 bay street')
      await waitFor(() => expect(screen.getByText(/12 Bay Street, Mosman/)).toBeDefined())

      /*
       * Waiting past the debounce before asserting, which is the whole point.
       *
       * The first version of this test checked the call count as soon as the
       * results appeared — and they appear instantly from memory, before the
       * debounce could have fired. So it passed even with the cache removed:
       * it proved the results were shown, not that the network was spared.
       */
      await new Promise((r) => setTimeout(r, 300))
      expect(lookup.forQuery('12 bay street')).toBe(1)

      vi.unstubAllGlobals()
    })

    /* Below four characters there is nothing worth showing and every call is
       billed, so nothing should leave the browser at all. */
    test('a short query makes no request', async () => {
      const lookup = stubLookup()
      const user = await openAddressEditor()
      await user.type(screen.getByLabelText('Find an address'), '12')
      await new Promise((r) => setTimeout(r, 250))
      expect(lookup.calls.filter((u) => u.includes('/api/address')).length).toBe(0)
      vi.unstubAllGlobals()
    })
  })

  describe('the postal address', () => {
    async function openPostal(person_: typeof person) {
      const user = userEvent.setup()
      render(
        <MemberPanel groupId="g1" groupName="Testsmith Household" members={[person_]} initialMode="view" initialPartyId="p1">
          trigger
        </MemberPanel>,
      )
      await user.click(screen.getByRole('button', { name: 'trigger' }))
      await user.click(screen.getByRole('tab', { name: 'Contact' }))
      return user
    }

    test('reads as "Same as residential" when the tick is set', async () => {
      await openPostal(person)
      expect(screen.getByText('Same as residential')).toBeDefined()
    })

    test('shows the postal address when it differs', async () => {
      await openPostal({
        ...person,
        postal_same_as_residential: false,
        postal_address: { line1: 'PO Box 42', line2: null, suburb: 'Neutral Bay', state: 'NSW', postcode: '2089' },
      })
      expect(screen.getByText('PO Box 42')).toBeDefined()
      expect(screen.getByText('Neutral Bay')).toBeDefined()
    })

    /**
     * Ticked, the fields are ABSENT rather than disabled. The database keeps no
     * postal row while the flag is set, so a filled-in form behind the tick
     * would show an address that does not exist and is not where post goes.
     */
    test('the tick hides the fields entirely, rather than disabling them', async () => {
      const user = await openPostal(person)
      const { container } = { container: document.body }
      await user.click(screen.getByRole('button', { name: /edit postal address/i }))

      expect((screen.getByRole('checkbox', { name: /same as residential/i }) as HTMLInputElement).checked).toBe(true)
      expect(container.querySelector('dialog input[name="post_line1"]')).toBeNull()

      await user.click(screen.getByRole('checkbox', { name: /same as residential/i }))
      expect(container.querySelector('dialog input[name="post_line1"]')).not.toBeNull()
    })

    /**
     * An unchecked checkbox submits NOTHING, and an absent key means "leave it
     * alone" to update_person_patch — so the tick could never be cleared
     * without something else carrying the value.
     *
     * This asserts there is exactly ONE entry for the key. The first version of
     * this component used a hidden `false` beside a checkbox `true` sharing the
     * name, which works only if the reader takes the last of the two —
     * FormData.get() takes the first, and would have read false however the box
     * was set, silently.
     */
    test('the tick submits exactly one unambiguous value', async () => {
      const user = await openPostal(person)
      await user.click(screen.getByRole('button', { name: /edit postal address/i }))
      const form = document.querySelector(
        'dialog form:has(input[name="postal_same_as_residential"])',
      ) as HTMLFormElement

      expect(new FormData(form).getAll('postal_same_as_residential')).toEqual(['true'])

      await user.click(screen.getByRole('checkbox', { name: /same as residential/i }))
      expect(new FormData(form).getAll('postal_same_as_residential')).toEqual(['false'])
    })

    /* The postal form must not carry the residential fields: they are separate
       rows, and a form holding both could blank one while saving the other. */
    test('the postal form carries only postal fields', async () => {
      const user = await openPostal({ ...person, postal_same_as_residential: false })
      await user.click(screen.getByRole('button', { name: /edit postal address/i }))
      const form = document.querySelector('dialog form:has(input[name="post_suburb"])')
      const names = [...form!.querySelectorAll('input[name]')].map((el) => el.getAttribute('name'))
      expect(names.filter((n) => n?.startsWith('addr_'))).toEqual([])
      expect(names).toContain('post_line1')
      expect(names).toContain('party_id')
    })
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
      <MemberPanel groupId="g1" groupName="Testsmith Household" members={[{ ...person, gender: 'Indeterminate' }]} initialMode="view" initialPartyId="p1">
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
        <MemberPanel groupId="g1" groupName="Testsmith Household" members={[{ ...person, verifications }]} initialMode="view" initialPartyId="p1">
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
