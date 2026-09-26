import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, test, vi } from 'vitest'
import type { ProviderContact } from '@/lib/groups'

/**
 * The provider's key-contacts well — the households' members well worn by a
 * provider, holding BDMs and support people.
 *
 * What a plausible implementation gets wrong, pinned here:
 *
 * - **The second line goes blank** when a contact has only a name: three nulls
 *   joined by dots is '', and a row with an empty second line reads as broken
 *   beside its filled neighbours. It says "Contact" instead.
 * - **Remove has no name.** Six rows, six buttons all announced "Remove" — a
 *   screen reader cannot tell which person is about to go.
 * - **The dialog submits stale state** — its whole shape is the house pattern,
 *   so only the wiring is asserted: the form posts the provider's id with the
 *   fields, and success closes it.
 */
const removeCalls: string[] = []
vi.mock('@/app/(shell)/groups/actions', () => ({
  addProviderContact: vi.fn(async () => ({ ok: true as const })),
  removeProviderContact: vi.fn(async (id: string) => {
    removeCalls.push(id)
    return { ok: true as const }
  }),
}))

const { ProviderContacts } = await import('@/components/provider-contacts')

const contact = (o: Partial<ProviderContact>): ProviderContact => ({
  id: 'c1',
  first_name: 'Sam',
  last_name: 'Nguyen',
  role_title: 'BDM',
  email: 'sam@hub24.example',
  phone: null,
  ...o,
})

describe('the key contacts well', () => {
  test('rows carry the person, their role line, and a named Remove', () => {
    render(
      <ProviderContacts
        providerPartyId="p1"
        contacts={[contact({}), contact({ id: 'c2', first_name: 'Priya', last_name: 'Shah', role_title: null, email: null })]}
      />,
    )
    expect(screen.getByText('Key contacts')).toBeTruthy()
    expect(screen.getByText('BDM · sam@hub24.example')).toBeTruthy()
    /* Only a name on file: the line says what the row IS rather than going
       blank beside its filled neighbours. */
    expect(screen.getByText('Contact')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Remove Sam Nguyen' })).toBeTruthy()
  })

  test('removing goes by id, from the row that was pressed', () => {
    removeCalls.length = 0
    render(<ProviderContacts providerPartyId="p1" contacts={[contact({}), contact({ id: 'c2', first_name: 'Priya', last_name: 'Shah' })]} />)
    fireEvent.click(screen.getByRole('button', { name: 'Remove Priya Shah' }))
    expect(removeCalls).toEqual(['c2'])
  })

  test('an empty well says so and still offers the add', () => {
    render(<ProviderContacts providerPartyId="p1" contacts={[]} />)
    expect(screen.getByText('No contacts yet.')).toBeTruthy()
    expect(screen.getByRole('button', { name: /Add contact/ })).toBeTruthy()
  })

  /**
   * ONE format for entering a person, everywhere — Clinton's rule, 27 Sep,
   * after this dialog briefly asked for a single free-text name while the
   * household and staff forms split first and last. The split is the pin:
   * a form that regresses to one Name field fails on the missing inputs.
   */
  test('the add dialog asks first and last name — the household form’s format', () => {
    render(<ProviderContacts providerPartyId="p1" contacts={[]} />)
    fireEvent.click(screen.getByRole('button', { name: /Add contact/ }))
    const dialog = document.querySelector('dialog[open]') as HTMLDialogElement
    expect(dialog).toBeTruthy()
    const form = dialog.querySelector('form') as HTMLFormElement
    expect(new FormData(form).get('provider_party_id')).toBe('p1')
    expect(within(dialog).getByRole('textbox', { name: 'First name' })).toBeTruthy()
    expect(within(dialog).getByRole('textbox', { name: 'Last name' })).toBeTruthy()
    expect(form.elements.namedItem('name'), 'the free-text blob stays gone').toBeNull()
    for (const field of ['role_title', 'email', 'phone']) {
      expect(form.elements.namedItem(field)).toBeTruthy()
    }
  })
})
