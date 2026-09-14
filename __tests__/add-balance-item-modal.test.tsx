import { describe, expect, test, vi, beforeEach } from 'vitest'
import { render, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

/**
 * The add-asset / add-liability dialog.
 *
 * One component serves both sides, which is the thing worth testing: the type
 * list, the words and the security field all follow `side`, and the share
 * arithmetic — the part that must not drift — is shared.
 */
/* Typed like the action itself, so the FormData assertions below read the call
   rather than casting it. */
const createBalanceItem = vi.fn(
  async (prev: unknown, form: FormData) => {
    void prev
    void form
    return { ok: true as const }
  },
)
vi.mock('@/app/(shell)/groups/actions', () => ({ createBalanceItem }))

const { AddBalanceItemModal } = await import('@/components/add-balance-item-modal')
const { ASSET_TYPES, LIABILITY_TYPES } = await import('@/lib/balance-sheet')

const OWNERS = [
  { id: 'p1', name: 'Janet Testsmith' },
  { id: 'p2', name: 'John Testsmith' },
]
const PROVIDERS = [{ id: 'pr1', name: 'A Bank' }]
const SECURABLE = [{ id: 'b1', label: 'Mercer Street' }]

beforeEach(() => createBalanceItem.mockClear())

/* Scoped to this render's own container, not to the screen: a test that opens
   both sides has two dialogs mounted at once, and a screen-wide query would
   find both and throw. */
const open = async (props: Partial<Parameters<typeof AddBalanceItemModal>[0]> = {}) => {
  const user = userEvent.setup()
  const { container } = render(
    <AddBalanceItemModal
      side="asset"
      owners={OWNERS}
      providers={PROVIDERS}
      {...props}
    />,
  )
  const side = props.side ?? 'asset'
  await user.click(
    within(container).getByRole('button', {
      name: side === 'liability' ? /add liability/i : /add asset/i,
    }),
  )
  return {
    user,
    dialog: within(container).getByRole('dialog', { hidden: true }) as HTMLDialogElement,
  }
}

describe('which side the form is on', () => {
  /**
   * **The type list is this side's types only.** `side` is a generated column
   * derived from exactly this value in the database, so offering a car loan
   * here would file a liability in the assets column.
   */
  test('the asset form offers the asset types and none of the liability ones', async () => {
    const { dialog } = await open({ side: 'asset' })
    const select = within(dialog).getByRole<HTMLSelectElement>('combobox', { name: 'Type' })
    const values = [...select.options].map((o) => o.value)
    expect(values).toEqual(ASSET_TYPES.map(([v]) => v))
    for (const [v] of LIABILITY_TYPES) expect(values).not.toContain(v)
  })

  test('and the liability form the other way round', async () => {
    const { dialog } = await open({ side: 'liability' })
    const select = within(dialog).getByRole<HTMLSelectElement>('combobox', { name: 'Type' })
    const values = [...select.options].map((o) => o.value)
    expect(values).toEqual(LIABILITY_TYPES.map(([v]) => v))
    for (const [v] of ASSET_TYPES) expect(values).not.toContain(v)
  })

  /* Only a liability can be secured on something, and the rule is enforced by
     a trigger in the database. The form should not offer what the database
     will refuse. */
  test('only the liability form can secure the item against an asset', async () => {
    const asset = await open({ side: 'asset', securable: SECURABLE })
    expect(
      within(asset.dialog).queryByRole('combobox', { name: 'Secured against' }),
    ).toBeNull()

    const liability = await open({ side: 'liability', securable: SECURABLE })
    const select = within(liability.dialog).getByRole<HTMLSelectElement>('combobox', {
      name: 'Secured against',
    })
    expect([...select.options].map((o) => o.textContent)).toEqual(['Unsecured', 'Mercer Street'])
  })

  test('with no assets recorded there is nothing to secure against, and the field says so', async () => {
    const { dialog } = await open({ side: 'liability', securable: [] })
    const select = within(dialog).getByRole<HTMLSelectElement>('combobox', {
      name: 'Secured against',
    })
    expect(select.disabled).toBe(true)
    expect(select.options[0].textContent).toBe('No assets recorded yet')
  })

  /* A liability's figure is what is owed, not what it is worth. The word is the
     only thing on the form that says so. */
  test('the money field is named for the side it is on', async () => {
    const asset = await open({ side: 'asset' })
    expect(within(asset.dialog).getByText('Value')).toBeTruthy()
    const liability = await open({ side: 'liability' })
    expect(within(liability.dialog).getByText('Amount owed')).toBeTruthy()
    expect(within(liability.dialog).queryByText('Value')).toBeNull()
  })
})

describe('owners and their shares', () => {
  /* The share box appears only once a name is ticked: a column of empty
     percentages beside unticked names reads as a form somebody failed to fill
     in. */
  test('a share box appears beside a name as it is ticked, and goes when it is not', async () => {
    const { user, dialog } = await open()
    expect(within(dialog).queryByLabelText('Janet Testsmith share')).toBeNull()

    const janet = within(dialog).getByRole('checkbox', { name: 'Janet Testsmith' })
    await user.click(janet)
    expect(within(dialog).getByLabelText('Janet Testsmith share')).toBeTruthy()
    // John's is not there — the box follows the tick, not the list.
    expect(within(dialog).queryByLabelText('John Testsmith share')).toBeNull()

    await user.click(janet)
    expect(within(dialog).queryByLabelText('Janet Testsmith share')).toBeNull()
  })

  test('a group with no members cannot own anything, and the submit is refused', async () => {
    const { dialog } = await open({ owners: [] })
    expect(within(dialog).getByText(/no members to own an asset/i)).toBeTruthy()
    expect(
      within(dialog).getByRole<HTMLButtonElement>('button', { name: /^add asset$/i }).disabled,
    ).toBe(true)
  })

  /** The shares reach the action under a name it can pair back to the owner. */
  test('what is typed is submitted, per owner', async () => {
    const { user, dialog } = await open()
    await user.click(within(dialog).getByRole('checkbox', { name: 'Janet Testsmith' }))
    await user.click(within(dialog).getByRole('checkbox', { name: 'John Testsmith' }))
    await user.type(within(dialog).getByLabelText('Janet Testsmith share'), '60')
    await user.type(within(dialog).getByLabelText('John Testsmith share'), '40')
    await user.type(within(dialog).getByRole('textbox', { name: 'Name' }), 'Mercer Street')
    await user.type(within(dialog).getByRole('textbox', { name: 'Value' }), '1200000')
    await user.click(within(dialog).getByRole('button', { name: /^add asset$/i }))

    expect(createBalanceItem).toHaveBeenCalled()
    const form = createBalanceItem.mock.calls[0][1] as unknown as FormData
    expect(form.getAll('owner_party_ids')).toEqual(['p1', 'p2'])
    expect(form.get('share_p1')).toBe('60')
    expect(form.get('share_p2')).toBe('40')
    expect(form.get('item_type')).toBe('principal_residence')
    expect(form.get('label')).toBe('Mercer Street')
  })
})

describe('the dialog itself', () => {
  /**
   * A saved item closes the dialog and clears it, so reopening does not present
   * the last one's details as if they were a new record.
   *
   * The FIELDS are cleared by React itself — it resets an uncontrolled form
   * after its action resolves — so the explicit `reset()` is belt and braces,
   * matching `AddAccountModal`. What this component has to do is the other
   * two: close, and drop the ticks (which are React state and would otherwise
   * survive, leaving share boxes open beside nothing). Both were mutated and
   * both fail here without them.
   */
  test('a successful save closes it and empties the form', async () => {
    const { user, dialog } = await open()
    await user.click(within(dialog).getByRole('checkbox', { name: 'Janet Testsmith' }))
    const name = within(dialog).getByRole<HTMLInputElement>('textbox', { name: 'Name' })
    await user.type(name, 'Mercer Street')
    await user.type(within(dialog).getByRole('textbox', { name: 'Value' }), '1200000')
    await user.click(within(dialog).getByRole('button', { name: /^add asset$/i }))

    /* Awaited: the close happens in an effect once the action resolves, and
       under a loaded machine the click returns before that lands. Asserted
       directly, this test failed about one full-suite run in three. */
    await waitFor(() => expect(dialog.open).toBe(false))
    expect(name.value).toBe('')
    // The tick went too, so the share box is not sitting there pre-filled.
    expect(within(dialog).queryByLabelText('Janet Testsmith share')).toBeNull()
  })

  /** Centred by its own margin: Tailwind's preflight zeroes the UA `margin:
   *  auto` that a `<dialog>` relies on, which drops the panel hard left. */
  test('keeps the auto margin preflight would otherwise remove', async () => {
    const { dialog } = await open()
    expect(dialog.className).toMatch(/(^|\s)m-auto(\s|$)/)
  })

  test('an error from the server is shown, and the dialog stays open', async () => {
    createBalanceItem.mockResolvedValueOnce({ error: 'Shares must total 100%, not 90%.' } as never)
    const { user, dialog } = await open()
    await user.click(within(dialog).getByRole('checkbox', { name: 'Janet Testsmith' }))
    await user.type(within(dialog).getByRole('textbox', { name: 'Name' }), 'Mercer Street')
    await user.type(within(dialog).getByRole('textbox', { name: 'Value' }), '1200000')
    await user.click(within(dialog).getByRole('button', { name: /^add asset$/i }))

    const alert = await within(dialog).findByRole('alert')
    expect(alert.textContent).toBe('Shares must total 100%, not 90%.')
    /* And it is still open, so the reader can correct what they typed. The
       `open` attribute is toggled by the `showModal` stub in vitest.setup.ts —
       jsdom has no top layer, so modality itself is a browser check. */
    expect(dialog.open, 'the dialog closed on a failed save').toBe(true)
  })
})
