import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, test, vi } from 'vitest'
import { PolicyList, coverAmount, type PolicyRow } from '@/components/policy-list'

/**
 * The insurance-policy list and the drawer it opens.
 *
 * The shape is the account drawer's, and deliberately nothing else is. What
 * this file guards is what makes a policy a different record:
 *
 *  - an amount never appears without its basis, because $6,500 read as a lump
 *    sum where a monthly benefit was meant understates the cover twelvefold —
 *    the schema's own rule, "never interpret without the basis";
 *  - the two totals are shown as two figures and never added, which is why the
 *    database keeps them in separate columns;
 *  - the people are parties with ROLES, and the same person is routinely both,
 *    so the editor cannot be a flat list of names;
 *  - there is no allocation, and no code path pretends there is.
 */

vi.mock('@/app/(shell)/groups/actions', () => ({
  savePolicyDetails: vi.fn(async () => ({ ok: true as const })),
}))

const BUNDLE: PolicyRow = {
  policy_id: 'pol1',
  label: 'Janet — Life and IP',
  policy_number: 'TAL-99120',
  status: 'in_force',
  commenced_on: '2021-07-01',
  cancelled_on: null,
  insurer: 'TAL',
  owners: 'Janet Testsmith',
  lives_insured: 'Janet Testsmith',
  cover_types: 'life, income_protection',
  cover_count: 2,
  total_lump_sum_cover: 750000,
  total_monthly_benefit: 6500,
  premium: 187.4,
  premium_frequency: 'monthly',
  premium_structure: 'stepped',
  held_in_account_id: 'a2',
  held_in_account: 'Joint Super',
  /* The same party twice, under two roles — the table's own comment calls this
     the common case rather than a special one. */
  parties: [
    { party_id: 'p1', name: 'Janet Testsmith', role: 'owner' },
    { party_id: 'p1', name: 'Janet Testsmith', role: 'life_insured' },
  ],
  covers: [
    {
      cover_type: 'life',
      benefit_amount: 750000,
      benefit_basis: 'lump_sum',
      benefit_period: null,
      waiting_period: null,
      indexed: true,
    },
    {
      cover_type: 'income_protection',
      benefit_amount: 6500,
      benefit_basis: 'monthly',
      benefit_period: 'to age 65',
      waiting_period: '90 days',
      indexed: false,
    },
  ],
}

const LAPSED: PolicyRow = {
  ...BUNDLE,
  policy_id: 'pol2',
  label: 'Reece — Trauma',
  policy_number: 'AIA-4410',
  status: 'lapsed',
  insurer: null,
  total_monthly_benefit: null,
  cover_types: 'trauma',
  cover_count: 1,
  total_lump_sum_cover: 200000,
  premium: null,
  premium_frequency: null,
  premium_structure: null,
  held_in_account_id: null,
  held_in_account: null,
  parties: [{ party_id: 'p2', name: 'Reece Testsmith', role: 'owner' }],
  covers: [
    {
      cover_type: 'trauma',
      benefit_amount: 200000,
      benefit_basis: 'lump_sum',
      benefit_period: null,
      waiting_period: null,
      indexed: false,
    },
  ],
}

const MEMBERS = [
  { id: 'p1', name: 'Janet Testsmith' },
  { id: 'p2', name: 'Reece Testsmith' },
]

function list(policies: PolicyRow[] = [BUNDLE, LAPSED]) {
  return render(
    <ul>
      <PolicyList policies={policies} members={MEMBERS} groupName="Testsmith Household" />
    </ul>,
  )
}

const open = (name: string) =>
  act(() => {
    fireEvent.click(screen.getByRole('button', { name: `Open ${name}` }))
  })

const drawer = (container: HTMLElement) => container.querySelector('dialog')!

describe('coverAmount', () => {
  /* The unit the whole panel rests on: a number that carries what kind of
     number it is, everywhere it is printed including the text equivalent. */
  test('says what kind of amount it is', () => {
    expect(coverAmount(750000, 'lump_sum')).toBe('$750,000')
    expect(coverAmount(6500, 'monthly')).toBe('$6,500 a month')
    expect(coverAmount(78000, 'annual')).toBe('$78,000 a year')
  })
})

describe('the policy list', () => {
  test('renders one dialog for the whole list', () => {
    const { container } = list()
    expect(container.querySelectorAll('dialog')).toHaveLength(1)
    expect(drawer(container).textContent).toBe('')
  })

  test('the second row opens the second policy', () => {
    const { container } = list()
    open('Janet — Life and IP')
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Close panel' }))
    })
    open('Reece — Trauma')
    expect(within(drawer(container)).getByRole('heading', { level: 2 }).textContent).toBe(
      'Reece — Trauma',
    )
  })

  test('a policy that leaves the group says so rather than vanishing', () => {
    const { container, rerender } = list()
    open('Janet — Life and IP')
    rerender(
      <ul>
        <PolicyList policies={[LAPSED]} members={MEMBERS} groupName="Testsmith Household" />
      </ul>,
    )
    expect(within(drawer(container)).getByRole('heading', { level: 2 }).textContent).toBe(
      'Policy moved',
    )
  })
})

describe('the policy drawer', () => {
  /**
   * The failure worth a test: $750,000 of life cover plus $6,500 a month is not
   * $756,500, and a panel that summed them would look entirely plausible.
   */
  test('shows the two totals as two figures and never their sum', () => {
    const { container } = list()
    open('Janet — Life and IP')
    const text = drawer(container).textContent!
    expect(text).toContain('$750,000')
    expect(text).toContain('$6,500')
    expect(text).not.toContain('$756,500')
    expect(text).toContain('never added together')
  })

  /* One total, so there is nothing to warn about — the sentence would be noise. */
  test('and drops the warning when only one kind of cover exists', () => {
    const { container } = list()
    open('Reece — Trauma')
    expect(drawer(container).textContent).not.toContain('never added together')
  })

  test('prints each cover with its basis', () => {
    const { container } = list()
    open('Janet — Life and IP')
    const covers = Array.from(drawer(container).querySelectorAll('[data-slot="cover"]'))
    expect(covers).toHaveLength(2)
    expect(covers[0].textContent).toContain('Life')
    expect(covers[0].textContent).toContain('$750,000')
    expect(covers[1].textContent).toContain('Income protection')
    /* The basis travels with the figure. A bare "$6,500" on this line is the
       twelvefold misreading the schema comment names. */
    expect(covers[1].textContent).toContain('$6,500 a month')
  })

  test('and the terms that decide what a cover is worth', () => {
    const { container } = list()
    open('Janet — Life and IP')
    const covers = drawer(container).querySelectorAll('[data-slot="cover"]')
    expect(covers[1].textContent).toContain('Benefit period to age 65')
    expect(covers[1].textContent).toContain('Waiting period 90 days')
    expect(covers[0].textContent).toContain('Indexed')
    expect(covers[1].textContent).not.toContain('Indexed')
  })

  test('states the premium with its frequency, and the account it is paid from', () => {
    const { container } = list()
    open('Janet — Life and IP')
    const text = drawer(container).textContent!
    expect(text).toContain('$187.40, monthly')
    expect(text).toContain('Joint Super')
  })

  /* A policy has no allocation and never will. This is the guard against a
     shared body switching on a `kind` flag being introduced later. */
  test('shows no asset allocation', () => {
    const { container } = list()
    open('Janet — Life and IP')
    expect(drawer(container).textContent).not.toContain('Asset allocation')
    expect(drawer(container).querySelector('[data-slot="alloc-row"]')).toBeNull()
    expect(drawer(container).querySelector('[data-slot="alloc-ghost"]')).toBeNull()
  })

  test('the read state contains no form control', () => {
    const { container } = list()
    open('Janet — Life and IP')
    expect(drawer(container).querySelectorAll('input, select, textarea')).toHaveLength(0)
  })

  /**
   * One person, both roles, two rows. A flat checkbox list could not say which
   * role a tick meant, which is why the view carries the role on each party.
   */
  test('reads the same person under both roles', () => {
    const { container } = list()
    open('Janet — Life and IP')
    const d = within(drawer(container))
    const owners = d.getByText('Owners').closest('div')!
    const lives = d.getByText('Lives insured').closest('div')!
    expect(owners.textContent).toContain('Janet Testsmith')
    expect(lives.textContent).toContain('Janet Testsmith')
  })

  /**
   * Two sentinels, one form, one RPC. The database checks the final state of
   * both roles together, so moving a person from life insured to owner is a
   * single legitimate save — two separate forms would refuse it halfway.
   */
  test('editing People submits both role sets with their own sentinels', () => {
    list()
    open('Janet — Life and IP')
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Edit people' }))
    })
    const box = screen.getByRole('button', { name: 'Save' }).closest('form')!
    expect(box.querySelector('input[name="owners_present"]')).toBeTruthy()
    expect(box.querySelector('input[name="lives_present"]')).toBeTruthy()
    const ticked = (field: string) =>
      Array.from(box.querySelectorAll<HTMLInputElement>(`input[name="${field}"]`))
        .filter((b) => b.defaultChecked)
        .map((b) => b.value)
    expect(ticked('owner_party_ids')).toEqual(['p1'])
    expect(ticked('life_insured_party_ids')).toEqual(['p1'])
  })

  test('editing Details offers the name alone', () => {
    list()
    open('Janet — Life and IP')
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Edit details' }))
    })
    const box = screen.getByRole('button', { name: 'Save' }).closest('form')!
    expect(
      Array.from(box.querySelectorAll('input, select')).map((el) => el.getAttribute('name')),
    ).toEqual(['policy_id', 'label'])
  })
})
