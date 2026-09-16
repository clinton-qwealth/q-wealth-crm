import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, test, vi } from 'vitest'
import { AccountList, type AccountRow } from '@/components/account-list'

/**
 * The investment-account list and the drawer it opens.
 *
 * ## What this file is really guarding
 *
 * Not that fields appear — that is the cheap half. The three things worth a
 * test are the ones where a plausible-looking screen would be WRONG:
 *
 *  1. one dialog for the whole list, so twenty accounts are not twenty records
 *     in the document, and the second row opens the second account rather than
 *     re-rendering the first;
 *  2. `product_display_name` never used as a name, because eleven of the first
 *     twenty HUB24 accounts share one string and every closed one's contains
 *     the word ACTIVE;
 *  3. the asset allocation offering no way to edit it, because
 *     `financial_account_allocations` has no write policy for staff at all and
 *     a pencil there would be a promise the database will not keep.
 *
 * The server actions are stubbed. What they do with a patch is
 * `save-record-details.test.ts`'s subject; what reaches them from a form is
 * this file's, and the two must not be tested through each other.
 */

vi.mock('@/app/(shell)/groups/actions', () => ({
  saveAccountDetails: vi.fn(async () => ({ ok: true as const })),
}))

const WRAP: AccountRow = {
  account_id: 'a1',
  account_type: 'investment',
  label: 'Netwealth Wrap',
  account_number: '24033810',
  status: 'active',
  opened_on: '2019-04-01',
  closed_on: null,
  provider: 'HUB24',
  owners: 'Janet Testsmith',
  owner_count: 1,
  latest_value: 412350.55,
  valued_on: '2026-09-15',
  change_amount: 1200,
  change_pct: 0.29,
  baseline_value: 411150.55,
  baseline_points: 30,
  available_cash: 8421.2,
  snapshot_as_at: '2026-09-15T22:10:00+10:00',
  snapshot_source_system: 'hub24',
  product_display_name: 'HUB24 SUPER - ACTIVE - PLATINUM',
  valuation_source: 'HUB24 daily feed',
  valuation_source_system: 'hub24',
  owner_parties: [{ party_id: 'p1', name: 'Janet Testsmith' }],
  allocation: [
    { asset_class: 'australian_shares', weight: 0.4123 },
    { asset_class: 'cash', weight: 0.1 },
    { asset_class: 'other', weight: -0.0228 },
  ],
  allocation_as_at: '2026-09-14T22:10:00+10:00',
}

const SUPER: AccountRow = {
  ...WRAP,
  account_id: 'a2',
  account_type: 'superannuation',
  label: 'Joint Super',
  account_number: '99887766',
  provider: null,
  product_display_name: null,
  latest_value: null,
  valued_on: null,
  change_amount: null,
  change_pct: null,
  baseline_value: null,
  baseline_points: null,
  available_cash: null,
  snapshot_as_at: null,
  valuation_source: null,
  allocation: null,
  allocation_as_at: null,
  owners: 'Janet Testsmith, Reece Testsmith',
  owner_parties: [
    { party_id: 'p1', name: 'Janet Testsmith' },
    { party_id: 'p2', name: 'Reece Testsmith' },
  ],
}

/**
 * TWO MEMBERS SHARE A NAME, on purpose.
 *
 * This is the case `owner_parties` was added to the view for. The older
 * `owners` column is names joined with commas and cannot be turned back into
 * ids — with a second Janet Testsmith in the group, a picker that ticked boxes
 * by matching that string would tick both of them and hand the save an owner
 * who does not own the account. A fixture where every name is unique lets that
 * bug pass, which is precisely what happened before this comment existed.
 */
const MEMBERS = [
  { id: 'p1', name: 'Janet Testsmith' },
  { id: 'p2', name: 'Reece Testsmith' },
  { id: 'p3', name: 'Janet Testsmith' },
]

function list(accounts: AccountRow[] = [WRAP, SUPER]) {
  return render(
    <ul>
      <AccountList accounts={accounts} members={MEMBERS} groupName="Testsmith Household" />
    </ul>,
  )
}

const open = (name: string) =>
  act(() => {
    fireEvent.click(screen.getByRole('button', { name: `Open ${name}` }))
  })

const drawer = (container: HTMLElement) => container.querySelector('dialog')!

describe('the account list', () => {
  test('gives every row a trigger named after the account', () => {
    list()
    expect(screen.getByRole('button', { name: 'Open Netwealth Wrap' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Open Joint Super' })).toBeTruthy()
  })

  /* The whole reason `selectedId` lives here rather than a dialog per row. */
  test('renders ONE dialog however many accounts there are', () => {
    const { container } = list()
    expect(container.querySelectorAll('dialog')).toHaveLength(1)
  })

  test('which holds nothing until a row is opened', () => {
    const { container } = list()
    expect(drawer(container).textContent).toBe('')
  })

  test('and empties again on close', () => {
    const { container } = list()
    open('Netwealth Wrap')
    expect(drawer(container).textContent).toContain('Netwealth Wrap')
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Close panel' }))
    })
    expect(drawer(container).textContent).toBe('')
  })

  /**
   * The failure this catches is a drawer that copies its record into state when
   * it opens: the first account would keep showing after the second row is
   * clicked, which looks like nothing happening.
   */
  test('the second row opens the second account, not the first again', () => {
    const { container } = list()
    open('Netwealth Wrap')
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Close panel' }))
    })
    open('Joint Super')
    const d = within(drawer(container))
    expect(d.getByRole('heading', { level: 2 }).textContent).toBe('Joint Super')
    expect(drawer(container).textContent).not.toContain('Netwealth Wrap')
  })

  /**
   * A rename revalidates the page, which re-renders this list with new rows.
   * The panel reads its account out of that array, so the open heading follows.
   */
  test('a renamed account updates the open drawer', () => {
    const { container, rerender } = list()
    open('Netwealth Wrap')
    rerender(
      <ul>
        <AccountList
          accounts={[{ ...WRAP, label: 'Netwealth Wrap (Janet)' }, SUPER]}
          members={MEMBERS}
          groupName="Testsmith Household"
        />
      </ul>,
    )
    expect(within(drawer(container)).getByRole('heading', { level: 2 }).textContent).toBe(
      'Netwealth Wrap (Janet)',
    )
  })

  /**
   * Changing owners can move an account out of the group it was opened from —
   * permitted deliberately, because this is the only ownership-editing UI in
   * the product. What must not happen is the drawer emptying mid-read with no
   * explanation.
   */
  test('an account that leaves the group says so rather than vanishing', () => {
    const { container, rerender } = list()
    open('Netwealth Wrap')
    rerender(
      <ul>
        <AccountList accounts={[SUPER]} members={MEMBERS} groupName="Testsmith Household" />
      </ul>,
    )
    const d = within(drawer(container))
    expect(d.getByRole('heading', { level: 2 }).textContent).toBe('Account moved')
    expect(drawer(container).textContent).toContain('Testsmith Household')
  })
})

describe('the account drawer', () => {
  test('names the group and the provider above the account', () => {
    const { container } = list()
    open('Netwealth Wrap')
    expect(drawer(container).textContent).toContain('Testsmith Household · HUB24')
  })

  test('and says only the group when no provider is on file', () => {
    const { container } = list()
    open('Joint Super')
    const eyebrow = drawer(container).querySelector('p')!
    expect(eyebrow.textContent).toBe('Testsmith Household')
  })

  test('labels the value with the date it was struck and what recorded it', () => {
    const { container } = list()
    open('Netwealth Wrap')
    expect(drawer(container).textContent).toContain('As at 15 Sep 2026')
    expect(drawer(container).textContent).toContain('HUB24 daily feed')
  })

  /**
   * `product_display_name` is a fee-schedule identifier. This asserts the
   * string appears ONLY against its own label — never as the heading, which is
   * the failure its column comment warns about and the MCP's select list was
   * changed to prevent.
   */
  test('prints the product string as a field and never as the name', () => {
    const { container } = list()
    open('Netwealth Wrap')
    const d = drawer(container)
    expect(within(d).getByRole('heading', { level: 2 }).textContent).toBe('Netwealth Wrap')
    const product = within(d).getByText('HUB24 SUPER - ACTIVE - PLATINUM')
    expect(product.closest('div')!.textContent).toContain('Product')
  })

  test('and omits the product row entirely when no feed has sent one', () => {
    const { container } = list()
    open('Joint Super')
    expect(within(drawer(container)).queryByText('Product')).toBeNull()
  })

  test('draws the allocation, negatives included', () => {
    const { container } = list()
    open('Netwealth Wrap')
    const bars = drawer(container).querySelector('[role="img"]')!
    expect(bars.getAttribute('aria-label')).toContain('Australian shares')
    expect(bars.getAttribute('aria-label')).toContain('−')
  })

  test('and says so plainly when there is none', () => {
    const { container } = list()
    open('Joint Super')
    expect(drawer(container).textContent).toContain('recorded by hand')
  })

  /**
   * No pencil on the allocation, ever. `financial_account_allocations` has a
   * select policy and no insert, update or delete policy for staff, by design:
   * the next feed run would overwrite a hand edit. An editable-looking
   * allocation is a lie the database will not honour.
   */
  test('offers no way to edit the allocation', () => {
    const { container } = list()
    open('Netwealth Wrap')
    expect(within(drawer(container)).queryByRole('button', { name: /asset allocation/i })).toBeNull()
  })

  /* Cash is a PART of the value above, not a balance beside it. */
  test('shows cash with the sentence that stops it being added to the value', () => {
    const { container } = list()
    open('Netwealth Wrap')
    expect(drawer(container).textContent).toContain('$8,421.20')
    expect(drawer(container).textContent).toContain('not added together')
  })

  /**
   * The read state is a form's view half, so no control in it can be submitted.
   * A stray input here would post an empty value over a real one.
   */
  test('the read state contains no form control', () => {
    const { container } = list()
    open('Netwealth Wrap')
    const d = drawer(container)
    expect(d.querySelectorAll('input, select, textarea')).toHaveLength(0)
  })

  test('editing Details offers the name and the type, and nothing else', () => {
    const { container } = list()
    open('Netwealth Wrap')
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Edit details' }))
    })
    const box = screen.getByRole('button', { name: 'Save' }).closest('form')!
    const names = Array.from(box.querySelectorAll('input, select')).map((el) =>
      el.getAttribute('name'),
    )
    expect(names).toEqual(['account_id', 'label', 'account_type'])
    expect(within(drawer(container)).getAllByText('24033810').length).toBeGreaterThan(0)
  })

  /**
   * The sentinel that gives an emptied owner list a meaning distinct from a
   * form that never carried the control. Without it the two are the same `[]`.
   */
  test('editing Owners submits a presence sentinel beside the ticks', () => {
    list()
    open('Netwealth Wrap')
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Edit owners' }))
    })
    const box = screen.getByRole('button', { name: 'Save' }).closest('form')!
    expect(box.querySelector('input[name="owners_present"]')).toBeTruthy()
    const boxes = Array.from(
      box.querySelectorAll<HTMLInputElement>('input[name="owner_party_ids"]'),
    )
    expect(boxes.map((b) => b.value)).toEqual(['p1', 'p2', 'p3'])
    /* Ticked from `owner_parties`, the id/name pairs. The account's `owners`
       string says "Janet Testsmith", and TWO members answer to that — so this
       assertion fails the moment the ticks are derived from the string. */
    expect(boxes.filter((b) => b.defaultChecked).map((b) => b.value)).toEqual(['p1'])
  })
})
