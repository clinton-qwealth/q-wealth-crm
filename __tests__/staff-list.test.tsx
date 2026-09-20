import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, test, vi } from 'vitest'
import type { AccessProfileChoice, StaffRow } from '@/lib/admin'
import type { UserGroupChoice } from '@/lib/user-groups'

/**
 * The Staff tab and the drawer it opens.
 *
 * What a plausible screen would get wrong: a status control on the viewer's
 * own row (the database refuses it, but the control should not be there to
 * press); a form that forgets which staff member it is about; a photo drawn
 * from a Storage URL rather than the app's own route; a drawer per row.
 */
vi.mock('@/app/(shell)/admin/actions', () => ({
  addUsersToUserGroup: vi.fn(async () => ({ ok: true as const, added: 2 })),
  saveStaffDetails: vi.fn(async () => ({ ok: true as const })),
  setStaffAvatar: vi.fn(async () => ({ ok: true as const })),
  approveStaffRegistration: vi.fn(async () => ({ ok: true as const })),
  declineStaffRegistration: vi.fn(async () => ({ ok: true as const })),
  loadAuditEntries: vi.fn(),
}))
vi.mock('@/lib/supabase/client', () => ({
  createSupabaseBrowserClient: () => ({ storage: { from: () => ({ upload: vi.fn(), remove: vi.fn() }) } }),
}))
const { StaffList } = await import('@/components/staff-list')

const PROFILES: AccessProfileChoice[] = [
  { id: 'pa', name: 'Admin', description: 'Everything, including staff.', view_all_groups: true, view_sensitive: true, manage_groups: true, manage_staff: true, file_unmatched_notes: true },
  { id: 'pb', name: 'Adviser', description: 'Own groups.', view_all_groups: false, view_sensitive: true, manage_groups: true, manage_staff: false, file_unmatched_notes: false },
]
/* Three territories: two active, one archived that Reece still holds. */
const GROUPS: UserGroupChoice[] = [
  { id: 'ug-north', name: 'North', status: 'active' },
  { id: 'ug-south', name: 'South', status: 'active' },
  { id: 'ug-old', name: 'Old territory', status: 'archived' },
]
const ME: StaffRow = { id: 's1', first_name: 'Sarah', last_name: 'Chen', email: 'sarah@qwealth.com.au', status: 'active', avatar_path: null, created_at: '2026-09-01T00:00:00+00:00', verify_identity: false, title: null, date_of_birth: null, last_seen_at: null, signed_in: false, profile: { id: 'pa', name: 'Admin' }, limited_to_user_groups: false, user_groups: [] }
const THEM: StaffRow = { id: 's2', first_name: 'Reece', last_name: 'Testlee', email: 'reece@qwealth.com.au', status: 'inactive', avatar_path: 's2/0f0f0f0f-0f0f-4f0f-8f0f-0f0f0f0f0f0f.png', created_at: '2026-09-01T00:00:00+00:00', verify_identity: true, title: 'Dr', date_of_birth: '1980-06-01', last_seen_at: '2026-09-20T01:08:23+00:00', signed_in: true, profile: { id: 'pb', name: 'Adviser' }, limited_to_user_groups: true, user_groups: [{ id: 'ug-north', name: 'North', status: 'active' }, { id: 'ug-old', name: 'Old territory', status: 'archived' }] }

const list = () => render(<ul><StaffList staff={[ME, THEM]} profiles={PROFILES} userGroups={GROUPS} viewer={{ id: 's1' }} /></ul>)
const open = (name: string) => act(() => { fireEvent.click(screen.getByRole('button', { name: `Open ${name}` })) })
const drawer = (c: HTMLElement) => c.querySelector('dialog')!
const edit = (d: HTMLElement, box: string) => act(() => { fireEvent.click(within(d).getByRole('button', { name: `Edit ${box}` })) })

describe('the staff list', () => {
  test('a row carries the person, their address, their profile and their status', () => {
    const { container } = list()
    const rows = container.querySelectorAll('li')
    expect(rows[1].textContent).toContain('Reece Testlee')
    expect(rows[1].textContent).toContain('reece@qwealth.com.au')
    expect(rows[1].textContent).toContain('Adviser')
    expect(rows[1].textContent).toContain('Inactive')
  })

  test('draws initials without a photo, and the app’s own route with one', () => {
    const { container } = list()
    const rows = container.querySelectorAll('li')
    expect(rows[0].querySelector('[data-slot="avatar-initials"]')!.textContent).toBe('SC')
    expect(rows[0].querySelector('img')).toBeNull()
    const img = rows[1].querySelector('img')!
    expect(img.getAttribute('src')).toBe('/api/staff-avatar/s2?v=0f0f0f0f-0f0f-4f0f-8f0f-0f0f0f0f0f0f.png')
  })

  test('renders ONE dialog however many people there are, and the second row opens the second person', () => {
    const { container } = list()
    expect(container.querySelectorAll('dialog')).toHaveLength(1)
    open('Reece Testlee')
    expect(within(drawer(container)).getByRole('heading', { level: 2 }).textContent).toBe('Reece Testlee')
  })
})

describe('the staff drawer', () => {
  /* The two FORM boxes read as text. The Photo box is two buttons and a file
     picker, not a form — the picker submits nothing — so it is the one input
     allowed in the read state, and it is named here so a stray field cannot
     hide behind it. */
  /* Photo first, since 20 Sep 2026: the face is how a person is recognised in a
     list, and the box an administrator most often opens the drawer for. Pinned
     because a reorder is exactly the kind of change that looks harmless in a
     diff and is only noticed by whoever reaches for the wrong box. */
  test('the boxes read Photo, Details, Access — the face first', () => {
    const { container } = list()
    open('Reece Testlee')
    const titles = within(drawer(container))
      .getAllByRole('heading')
      .map((h) => h.textContent)
      .filter((t) => ['Photo', 'Details', 'Access'].includes(t ?? ''))
    expect(titles).toEqual(['Photo', 'Details', 'Access'])
  })

  test('the read state contains no form control beyond the photo picker', () => {
    const { container } = list()
    open('Reece Testlee')
    expect(drawer(container).querySelectorAll('input:not([type="file"]), select, textarea')).toHaveLength(0)
    expect(drawer(container).querySelectorAll('input[type="file"]')).toHaveLength(1)
  })

  test('editing Details offers both name boxes and the email, about THIS person, with the sign-in sentence', () => {
    const { container } = list()
    open('Reece Testlee')
    const d = drawer(container)
    edit(d, 'details')
    const form = within(d).getByRole('button', { name: 'Save' }).closest('form')!
    expect(Array.from(form.querySelectorAll('input')).map((i) => i.getAttribute('name'))).toEqual([
      'staff_id',
      'title',
      'first_name',
      'last_name',
      'date_of_birth',
      'email',
    ])
    expect(form.querySelector<HTMLInputElement>('input[name="staff_id"]')!.value).toBe('s2')
    expect(form.querySelector<HTMLInputElement>('input[name="first_name"]')!.value).toBe('Reece')
    expect(form.querySelector<HTMLInputElement>('input[name="last_name"]')!.value).toBe('Testlee')
    /* The two optional facts, since 20 Sep 2026. Neither is `required`: a blank
       is how they are cleared. The date input carries the ISO value the
       database holds, not the display form. */
    const title = form.querySelector<HTMLInputElement>('input[name="title"]')!
    const dob = form.querySelector<HTMLInputElement>('input[name="date_of_birth"]')!
    expect([title.value, title.required]).toEqual(['Dr', false])
    expect([dob.type, dob.value, dob.required]).toEqual(['date', '1980-06-01', false])
    expect(form.querySelector('[data-slot="email-note"]')!.textContent).toContain('not their sign-in email')
  })

  test('editing Access offers every profile with its description, and a status', () => {
    const { container } = list()
    open('Reece Testlee')
    const d = drawer(container)
    edit(d, 'access')
    const form = within(d).getByRole('button', { name: 'Save' }).closest('form')!
    const profile = form.querySelector<HTMLSelectElement>('select[name="profile_id"]')!
    expect(Array.from(profile.options).map((o) => o.textContent)).toEqual(['Admin — Everything, including staff.', 'Adviser — Own groups.'])
    expect(profile.value).toBe('pb')
    expect(form.querySelector<HTMLSelectElement>('select[name="status"]')!.value).toBe('inactive')
    expect(form.querySelector('[data-slot="status-note"]')!.textContent).toContain('removes access immediately')
  })

  /**
   * Last seen, since 20 Sep 2026.
   *
   * It is an INSTANT, so it renders in the reader's own timezone — the opposite
   * of the date of birth two fields above it, which is a calendar date and must
   * never go near a Date. The two sit in the same drawer, which is exactly how
   * somebody comes to use the wrong one.
   *
   * "Signed in" says they hold a session they have not given up. It is not a
   * claim that they are looking at the screen, and the label is chosen to say
   * only what the session actually knows.
   */
  test('the drawer says when somebody was last seen, and the row marks a live session', () => {
    const { container } = list()
    open('Reece Testlee')
    expect(within(drawer(container)).getByText('Last seen').nextElementSibling?.textContent).toMatch(/20 Sep 2026/)
    /* Scoped to the ROWS. By slot rather than by text, because the wrapper and
       its sr-only child both read as "Signed in" and a text match counts one
       light twice — and scoped to `li`, because this harness wraps the whole
       component in a `ul` of its own, so a list-wide query catches the open
       drawer's light as well. */
    const rowLights = container.querySelectorAll('li [data-slot="signed-in"]')
    expect(rowLights, 'one light, on the one person holding a session').toHaveLength(1)
    expect(rowLights[0]!.textContent, 'the colour is not the only carrier').toBe('Signed in')
  })

  /* Asked for on 20 Sep 2026: the same live mark in the drawer, beside the
     name, so a record marked live in the list stays marked when it is opened —
     and later the same day, with the WORDS beside the dot on the record itself. */
  test('the drawer carries the same live mark beside the name, and names it in words', () => {
    const { container } = list()
    open('Reece Testlee')
    const d = drawer(container)
    const light = d.querySelector('[data-slot="signed-in"]')
    expect(light, 'the drawer marks a live session too').toBeTruthy()
    expect(light!.textContent).toBe('Signed in')
    /* VISIBLE words on the record, not the row's screen-reader-only copy — and
       not both, which would announce it twice. */
    expect(light!.querySelector('.sr-only'), 'the words are shown, not hidden').toBeNull()
    expect(light!.querySelector('[aria-hidden="true"].qw-live'), 'the dot is still there').toBeTruthy()
    /* Beside the NAME, not down among the pills. */
    const heading = d.querySelector('#staff-drawer-title')!
    expect(heading.parentElement!.contains(light!), 'it shares the heading line').toBe(true)
  })

  /* The words on the ROW too, asked for on 20 Sep 2026 — the same mark in both
     places, so a record marked live in the list reads identically when opened. */
  test('a row shows the same dot and words, and only one person has them', () => {
    const { container } = list()
    const rowLights = container.querySelectorAll('li [data-slot="signed-in"]')
    expect(rowLights, 'one mark, on the one person holding a session').toHaveLength(1)
    expect(rowLights[0]!.textContent).toBe('Signed in')
    expect(rowLights[0]!.querySelector('[aria-hidden="true"].qw-live'), 'the dot').toBeTruthy()
    expect(rowLights[0]!.querySelector('.sr-only'), 'the words are shown, not doubled up').toBeNull()
  })

  /* The mark must never squeeze the name out of a row. The name truncates and
     the mark does not shrink — the contract `DataRow`'s indicator slot was added
     for, and the reason the old `badge` prop was removed. */
  test('the row mark cannot grow at the name’s expense', () => {
    const { container } = list()
    const mark = container.querySelector('li [data-slot="signed-in"]')!
    expect(mark.parentElement!.className, 'the slot does not shrink').toContain('shrink-0')
    expect(mark.querySelector('span:last-child')!.className).toContain('whitespace-nowrap')
    const name = container.querySelectorAll('li')[1]!.querySelector('.truncate')!
    expect(name.className, 'the name is what gives way').toContain('min-w-0')
  })

  test('a person with no live session has no mark in the drawer', () => {
    const { container } = list()
    open('Sarah Chen')
    expect(drawer(container).querySelector('[data-slot="signed-in"]')).toBeNull()
  })

  test('somebody who has never signed in says so, rather than showing a blank', () => {
    const { container } = list()
    open('Sarah Chen')
    expect(within(drawer(container)).getByText('Last seen').nextElementSibling?.textContent).toContain(
      'Never signed in',
    )
  })

  /* A date of birth reads DD-MM-YYYY — an identity document's format — and is
     built by splitting the string, never through `new Date()`, which shows the
     previous day anywhere west of Greenwich. A person with neither fact shows
     an em-dash, not a blank. */
  test('Details shows the title and a date of birth as digits, and an em-dash when there is none', () => {
    const { container } = list()
    open('Reece Testlee')
    const d = drawer(container)
    expect(within(d).getByText('Title').nextElementSibling?.textContent).toContain('Dr')
    expect(within(d).getByText('Date of birth').nextElementSibling?.textContent).toContain('01-06-1980')
  })

  test('a person with neither fact shows an em-dash for each, not a blank', () => {
    const { container } = list()
    open('Sarah Chen')
    const d = drawer(container)
    expect(within(d).getByText('Title').nextElementSibling?.textContent).toContain('—')
    expect(within(d).getByText('Date of birth').nextElementSibling?.textContent).toContain('—')
  })

  /**
   * Verify-identity is a toggle on the PERSON since 20 Sep 2026, not a property
   * of the profile. What matters here is the submission shape: a checkbox that is
   * off sends nothing, which under key-presence would make opting somebody OUT
   * impossible — so a hidden `false` travels ahead of the checkbox's `true`, and
   * the action reads whether `true` arrived at all.
   */
  test('the Access box shows whether this person may verify identity, and offers the toggle', () => {
    const { container } = list()
    open('Reece Testlee')
    const d = drawer(container)
    expect(within(d).getByText('Verify identity').nextElementSibling?.textContent).toContain('Yes')

    edit(d, 'access')
    const form = within(d).getByRole('button', { name: 'Save' }).closest('form')!
    const inputs = Array.from(form.querySelectorAll<HTMLInputElement>('input[name="verify_identity"]'))
    expect(inputs.map((i) => [i.type, i.value])).toEqual([
      ['hidden', 'false'],
      ['checkbox', 'true'],
    ])
    expect(inputs[1]!.checked, 'the checkbox mirrors the row').toBe(true)
    expect(form.querySelector('[data-slot="verify-note"]')!.textContent).toContain('second factor')
  })

  test('the toggle starts off for somebody who may not verify', () => {
    const { container } = list()
    open('Sarah Chen')
    const d = drawer(container)
    expect(within(d).getByText('Verify identity').nextElementSibling?.textContent).toContain('No')
    edit(d, 'access')
    const box = drawer(container).querySelector<HTMLInputElement>('input[type="checkbox"][name="verify_identity"]')!
    expect(box.checked).toBe(false)
  })

  /**
   * User groups — territories — 20 Sep 2026. Membership grants, the toggle
   * restricts, and the Access box carries both. The submission shapes are what
   * matter: the toggle in the hidden-false / checkbox-true pair, and the set
   * behind its sentinel so an emptied list is not mistaken for an absent one.
   */
  test('the Access box says whether this person is limited, and names their user groups', () => {
    const { container } = list()
    open('Reece Testlee')
    const d = drawer(container)
    expect(within(d).getByText('Limit to user groups').nextElementSibling?.textContent).toContain('Yes')
    expect(within(d).getByText('User groups').nextElementSibling?.textContent).toBe('North, Old territory')
  })

  test('a person in no user group shows an em-dash and No, not a blank', () => {
    const { container } = list()
    open('Sarah Chen')
    const d = drawer(container)
    expect(within(d).getByText('Limit to user groups').nextElementSibling?.textContent).toContain('No')
    expect(within(d).getByText('User groups').nextElementSibling?.textContent).toContain('—')
  })

  test('editing Access offers the limit toggle in the two-input shape, with the rule under it', () => {
    const { container } = list()
    open('Reece Testlee')
    const d = drawer(container)
    edit(d, 'access')
    const form = within(d).getByRole('button', { name: 'Save' }).closest('form')!
    const inputs = Array.from(form.querySelectorAll<HTMLInputElement>('input[name="limited_to_user_groups"]'))
    expect(inputs.map((i) => [i.type, i.value])).toEqual([
      ['hidden', 'false'],
      ['checkbox', 'true'],
    ])
    expect(inputs[1]!.checked, 'the checkbox mirrors the row').toBe(true)
    expect(form.querySelector('[data-slot="limit-note"]')!.textContent).toContain('stay visible')
  })

  test('the user-group picker travels behind its sentinel, offers every active group, and keeps an archived one the person holds', () => {
    const { container } = list()
    open('Reece Testlee')
    const d = drawer(container)
    edit(d, 'access')
    const form = within(d).getByRole('button', { name: 'Save' }).closest('form')!
    expect(form.querySelector('input[name="user_groups_present"]'), 'the sentinel').toBeTruthy()
    const boxes = Array.from(form.querySelectorAll<HTMLInputElement>('input[name="user_group_ids"]'))
    expect(boxes.map((b) => [b.value, b.checked])).toEqual([
      ['ug-north', true],
      ['ug-south', false],
      /* Archived, so not offered to anyone — but Reece HAS it, and an unrelated
         save must not silently drop it. Named as archived. */
      ['ug-old', true],
    ])
    expect(boxes[2]!.closest('label')!.textContent).toContain('(archived)')
  })

  test('somebody in no archived group is offered only the active ones', () => {
    const { container } = list()
    open('Sarah Chen')
    const d = drawer(container)
    edit(d, 'access')
    const boxes = Array.from(d.querySelectorAll<HTMLInputElement>('input[name="user_group_ids"]'))
    expect(boxes.map((b) => b.value)).toEqual(['ug-north', 'ug-south'])
  })

  test('the drawer header carries a pill per user group; the row carries none', () => {
    const { container } = list()
    const row = container.querySelectorAll('li')[1]!
    expect(row.textContent).not.toContain('North')
    open('Reece Testlee')
    let d = drawer(container)
    /* Above the boxes: the heading's own container, not the Access box's dl. */
    const headerOf = (dialog: HTMLElement) => dialog.querySelector('#staff-drawer-title')!.closest('header')!
    expect(headerOf(d).textContent).toContain('North')
    expect(headerOf(d).textContent).toContain('Old territory')
    act(() => { fireEvent.click(within(d).getByRole('button', { name: 'Close panel' })) })
    open('Sarah Chen')
    d = drawer(container)
    expect(headerOf(d).textContent).not.toContain('North')
  })

  /**
   * THE ONE THAT MATTERS. On the viewer's own row the status control is not
   * on the form: an absent control is an absent key in the patch, and the
   * database refuses the attempt regardless. The sentence says why.
   */
  test('offers no status control on the viewer’s own row, and says why', () => {
    const { container } = list()
    open('Sarah Chen')
    const d = drawer(container)
    edit(d, 'access')
    const form = within(d).getByRole('button', { name: 'Save' }).closest('form')!
    expect(form.querySelector('select[name="status"]')).toBeNull()
    expect(form.querySelector('select[name="profile_id"]')).toBeTruthy()
    expect(form.textContent).toContain('you cannot deactivate your own account')
  })

  test('the Photo box has no pencil, offers Upload without a photo and Replace and Remove with one', () => {
    const { container } = list()
    open('Sarah Chen')
    let d = drawer(container)
    expect(within(d).queryByRole('button', { name: 'Edit photo' })).toBeNull()
    expect(within(d).getByLabelText('Upload photo')).toBeTruthy()
    expect(within(d).queryByRole('button', { name: 'Remove photo' })).toBeNull()
    act(() => { fireEvent.click(within(d).getByRole('button', { name: 'Close panel' })) })
    open('Reece Testlee')
    d = drawer(container)
    expect(within(d).getByLabelText('Replace photo')).toBeTruthy()
    expect(within(d).getByRole('button', { name: 'Remove photo' })).toBeTruthy()
  })

  test('the file input accepts only the three image types the bucket allows', () => {
    const { container } = list()
    open('Sarah Chen')
    const input = within(drawer(container)).getByLabelText('Upload photo')
    expect(input.getAttribute('accept')).toBe('image/png,image/jpeg,image/webp')
  })
})

/**
 * The approval queue, since 19 September. A pending person is in the queue
 * and not in the list; Approve waits for a profile; Decline asks once.
 */
const PENDING: StaffRow = { id: 's9', first_name: 'Nina', last_name: 'New', email: 'nina@qwealth.com.au', status: 'pending', avatar_path: null, created_at: '2026-09-19T01:00:00+00:00', verify_identity: false, title: null, date_of_birth: null, last_seen_at: null, signed_in: false, profile: null, limited_to_user_groups: false, user_groups: [] }

describe('awaiting approval', () => {
  test('is absent when nobody is waiting', () => {
    const { container } = list()
    expect(container.querySelector('[data-slot="awaiting-approval"]')).toBeNull()
  })

  test('a pending person is in the queue, not in the staff list', () => {
    const { container } = render(<ul><StaffList staff={[ME, PENDING, THEM]} profiles={PROFILES} userGroups={GROUPS} viewer={{ id: 's1' }} /></ul>)
    const queue = container.querySelector('[data-slot="awaiting-approval"]')!
    expect(queue.textContent).toContain('Nina New')
    expect(queue.textContent).toContain('nina@qwealth.com.au')
    expect(screen.queryByRole('button', { name: 'Open Nina New' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Open Reece Testlee' })).toBeTruthy()
  })

  test('Approve is disabled until a profile is chosen, then sends both ids', async () => {
    const { approveStaffRegistration } = await import('@/app/(shell)/admin/actions')
    render(<ul><StaffList staff={[ME, PENDING]} profiles={PROFILES} userGroups={GROUPS} viewer={{ id: 's1' }} /></ul>)
    const approve = screen.getByRole('button', { name: 'Approve' }) as HTMLButtonElement
    expect(approve.disabled).toBe(true)
    const select = screen.getByRole('combobox', { name: 'Access profile for Nina New' }) as HTMLSelectElement
    /* No default: the first option is the prompt, not a profile. */
    expect(select.value).toBe('')
    await act(async () => { fireEvent.change(select, { target: { value: 'pb' } }) })
    expect(approve.disabled).toBe(false)
    await act(async () => { fireEvent.click(approve) })
    expect(approveStaffRegistration).toHaveBeenCalledWith('s9', 'pb')
  })

  test('Decline asks once, and Keep withdraws', async () => {
    const { declineStaffRegistration } = await import('@/app/(shell)/admin/actions')
    render(<ul><StaffList staff={[ME, PENDING]} profiles={PROFILES} userGroups={GROUPS} viewer={{ id: 's1' }} /></ul>)
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Decline' })) })
    expect(declineStaffRegistration).not.toHaveBeenCalled()
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Keep' })) })
    expect(screen.queryByRole('button', { name: 'Yes, decline' })).toBeNull()
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Decline' })) })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Yes, decline' })) })
    expect(declineStaffRegistration).toHaveBeenCalledWith('s9')
  })

  test('the database’s refusal is shown beside the request', async () => {
    const { approveStaffRegistration } = await import('@/app/(shell)/admin/actions')
    vi.mocked(approveStaffRegistration).mockResolvedValueOnce({ error: 'This request has already been decided' })
    render(<ul><StaffList staff={[ME, PENDING]} profiles={PROFILES} userGroups={GROUPS} viewer={{ id: 's1' }} /></ul>)
    await act(async () => { fireEvent.change(screen.getByRole('combobox', { name: 'Access profile for Nina New' }), { target: { value: 'pa' } }) })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Approve' })) })
    expect(screen.getByRole('alert').textContent).toBe('This request has already been decided')
  })
})

/**
 * Choosing several users and putting them in a territory at once — the errand
 * that actually takes the time when first carving 100-200 people into groups.
 *
 * Two things are load-bearing and neither is visible in a screenshot: only an
 * ACTIVE person may be ticked (the database refuses the rest, and a control that
 * offers a refusal is worse than none), and the count reported back is the one
 * the DATABASE wrote, not the number ticked — the difference being everybody who
 * was already a member.
 */
describe('assigning several users to a group at once', () => {
  const tick = (name: string) =>
    act(() => { fireEvent.click(screen.getByRole('checkbox', { name: `Select ${name}` })) })

  test('the bar is absent until somebody is chosen, and names how many', () => {
    const { container } = list()
    expect(container.querySelector('[data-slot="bulk-assign"]')).toBeNull()
    tick('Sarah Chen')
    expect(container.querySelector('[data-slot="bulk-assign"]')!.textContent).toContain('1 user selected')
    tick('Sarah Chen')
    expect(container.querySelector('[data-slot="bulk-assign"]'), 'unticking the last one puts it away').toBeNull()
  })

  /* Reece is inactive: the database will not let him join a user group, so the
     row offers no way to ask. */
  test('an inactive person cannot be ticked at all', () => {
    list()
    expect(screen.getByRole('checkbox', { name: 'Select Sarah Chen' })).toBeTruthy()
    expect(screen.queryByRole('checkbox', { name: 'Select Reece Testlee' })).toBeNull()
  })

  test('it offers active user groups only, and sends every ticked person to the additive call', async () => {
    const { addUsersToUserGroup } = await import('@/app/(shell)/admin/actions')
    const { container } = list()
    tick('Sarah Chen')
    const bar = container.querySelector('[data-slot="bulk-assign"]')!
    const select = within(bar as HTMLElement).getByRole('combobox', { name: 'User group to add them to' }) as HTMLSelectElement
    expect(Array.from(select.options).map((o) => o.textContent)).toEqual([
      'Choose a user group…',
      'North',
      'South',
    ])
    await act(async () => { fireEvent.change(select, { target: { value: 'ug-north' } }) })
    await act(async () => {
      fireEvent.click(within(bar as HTMLElement).getByRole('button', { name: 'Add to user group' }))
    })
    expect(addUsersToUserGroup).toHaveBeenCalledWith('ug-north', ['s1'])
  })

  test('the button waits for a group to be chosen', () => {
    const { container } = list()
    tick('Sarah Chen')
    const bar = container.querySelector('[data-slot="bulk-assign"]')!
    expect((within(bar as HTMLElement).getByRole('button', { name: 'Add to user group' }) as HTMLButtonElement).disabled).toBe(true)
  })

  test('it reports the number the database wrote, not the number ticked', async () => {
    const { addUsersToUserGroup } = await import('@/app/(shell)/admin/actions')
    vi.mocked(addUsersToUserGroup).mockResolvedValueOnce({ ok: true, added: 1 })
    const { container } = list()
    tick('Sarah Chen')
    const bar = container.querySelector('[data-slot="bulk-assign"]')!
    await act(async () => {
      fireEvent.change(within(bar as HTMLElement).getByRole('combobox', { name: 'User group to add them to' }), {
        target: { value: 'ug-north' },
      })
    })
    await act(async () => {
      fireEvent.click(within(bar as HTMLElement).getByRole('button', { name: 'Add to user group' }))
    })
    expect(screen.getByRole('status').textContent).toBe('Added 1 user.')
  })

  test('adding nobody new says so rather than claiming a change', async () => {
    const { addUsersToUserGroup } = await import('@/app/(shell)/admin/actions')
    vi.mocked(addUsersToUserGroup).mockResolvedValueOnce({ ok: true, added: 0 })
    const { container } = list()
    tick('Sarah Chen')
    const bar = container.querySelector('[data-slot="bulk-assign"]')!
    await act(async () => {
      fireEvent.change(within(bar as HTMLElement).getByRole('combobox', { name: 'User group to add them to' }), {
        target: { value: 'ug-north' },
      })
    })
    await act(async () => {
      fireEvent.click(within(bar as HTMLElement).getByRole('button', { name: 'Add to user group' }))
    })
    expect(screen.getByRole('status').textContent).toContain('already a member')
  })

  test('the database’s refusal is shown and the selection is kept', async () => {
    const { addUsersToUserGroup } = await import('@/app/(shell)/admin/actions')
    vi.mocked(addUsersToUserGroup).mockResolvedValueOnce({ error: 'Only an administrator can manage user groups' })
    const { container } = list()
    tick('Sarah Chen')
    const bar = container.querySelector('[data-slot="bulk-assign"]')!
    await act(async () => {
      fireEvent.change(within(bar as HTMLElement).getByRole('combobox', { name: 'User group to add them to' }), {
        target: { value: 'ug-north' },
      })
    })
    await act(async () => {
      fireEvent.click(within(bar as HTMLElement).getByRole('button', { name: 'Add to user group' }))
    })
    expect(screen.getByRole('alert').textContent).toBe('Only an administrator can manage user groups')
    expect(container.querySelector('[data-slot="bulk-assign"]'), 'still there to try again').toBeTruthy()
  })

  /* A checkbox inside the row's own button would be invalid markup whose click
     the button swallows — the reason DataRow renders `select` outside it. */
  test('the checkbox sits outside the row’s open button', () => {
    const { container } = list()
    const box = screen.getByRole('checkbox', { name: 'Select Sarah Chen' })
    expect(box.closest('button'), 'never nested in the row trigger').toBeNull()
    expect(container.querySelectorAll('li')[0]!.contains(box)).toBe(true)
  })
})
