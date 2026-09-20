import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, test, vi } from 'vitest'
import type { AccessProfileChoice, StaffRow } from '@/lib/admin'

/**
 * The Staff tab and the drawer it opens.
 *
 * What a plausible screen would get wrong: a status control on the viewer's
 * own row (the database refuses it, but the control should not be there to
 * press); a form that forgets which staff member it is about; a photo drawn
 * from a Storage URL rather than the app's own route; a drawer per row.
 */
vi.mock('@/app/(shell)/admin/actions', () => ({
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
const ME: StaffRow = { id: 's1', first_name: 'Sarah', last_name: 'Chen', email: 'sarah@qwealth.com.au', status: 'active', avatar_path: null, created_at: '2026-09-01T00:00:00+00:00', verify_identity: false, profile: { id: 'pa', name: 'Admin' } }
const THEM: StaffRow = { id: 's2', first_name: 'Reece', last_name: 'Testlee', email: 'reece@qwealth.com.au', status: 'inactive', avatar_path: 's2/0f0f0f0f-0f0f-4f0f-8f0f-0f0f0f0f0f0f.png', created_at: '2026-09-01T00:00:00+00:00', verify_identity: true, profile: { id: 'pb', name: 'Adviser' } }

const list = () => render(<ul><StaffList staff={[ME, THEM]} profiles={PROFILES} viewer={{ id: 's1' }} /></ul>)
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
      'first_name',
      'last_name',
      'email',
    ])
    expect(form.querySelector<HTMLInputElement>('input[name="staff_id"]')!.value).toBe('s2')
    expect(form.querySelector<HTMLInputElement>('input[name="first_name"]')!.value).toBe('Reece')
    expect(form.querySelector<HTMLInputElement>('input[name="last_name"]')!.value).toBe('Testlee')
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
const PENDING: StaffRow = { id: 's9', first_name: 'Nina', last_name: 'New', email: 'nina@qwealth.com.au', status: 'pending', avatar_path: null, created_at: '2026-09-19T01:00:00+00:00', verify_identity: false, profile: null }

describe('awaiting approval', () => {
  test('is absent when nobody is waiting', () => {
    const { container } = list()
    expect(container.querySelector('[data-slot="awaiting-approval"]')).toBeNull()
  })

  test('a pending person is in the queue, not in the staff list', () => {
    const { container } = render(<ul><StaffList staff={[ME, PENDING, THEM]} profiles={PROFILES} viewer={{ id: 's1' }} /></ul>)
    const queue = container.querySelector('[data-slot="awaiting-approval"]')!
    expect(queue.textContent).toContain('Nina New')
    expect(queue.textContent).toContain('nina@qwealth.com.au')
    expect(screen.queryByRole('button', { name: 'Open Nina New' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Open Reece Testlee' })).toBeTruthy()
  })

  test('Approve is disabled until a profile is chosen, then sends both ids', async () => {
    const { approveStaffRegistration } = await import('@/app/(shell)/admin/actions')
    render(<ul><StaffList staff={[ME, PENDING]} profiles={PROFILES} viewer={{ id: 's1' }} /></ul>)
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
    render(<ul><StaffList staff={[ME, PENDING]} profiles={PROFILES} viewer={{ id: 's1' }} /></ul>)
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
    render(<ul><StaffList staff={[ME, PENDING]} profiles={PROFILES} viewer={{ id: 's1' }} /></ul>)
    await act(async () => { fireEvent.change(screen.getByRole('combobox', { name: 'Access profile for Nina New' }), { target: { value: 'pa' } }) })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Approve' })) })
    expect(screen.getByRole('alert').textContent).toBe('This request has already been decided')
  })
})
