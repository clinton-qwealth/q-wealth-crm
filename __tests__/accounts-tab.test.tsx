import { describe, expect, test, vi } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'

/**
 * The Accounts tab's investment section: two columns, and no total.
 *
 * Both were asked for on 10 September — "two columns exactly the same as the
 * workflows tab, the investment records on the left" and "remove the total row
 * at the bottom of the investment records". This renders the REAL page module
 * rather than a copy of its markup, because the thing worth pinning is the
 * wiring: the split has to be the same object the Workflows tab uses, and the
 * total has to be absent from the section a person actually sees.
 *
 * `Tabs` builds a panel when its tab is first opened and keeps it after that,
 * so the helper below opens Accounts and then reads both panels.
 */
const ACCOUNTS = [
  {
    group_id: 'g1',
    account_id: 'a1',
    account_type: 'superannuation',
    label: 'Joint Super',
    status: 'active',
    owners: 'Janet Testsmith',
    latest_value: '486210',
    valued_on: '2026-09-01',
    change_amount: '1200',
    change_pct: '0.25',
    baseline_value: '485010',
    baseline_points: 30,
  },
  /* Deliberately unvalued. The removed total carried a note — "Excludes 1
     account with no recorded value" — and it only appeared when a row was
     missing a value. Without such a row the absence assertion below would pass
     for the wrong reason. */
  {
    group_id: 'g1',
    account_id: 'a2',
    account_type: 'investment',
    label: 'Unvalued Portfolio',
    status: 'active',
    owners: 'Janet Testsmith',
    latest_value: null,
    valued_on: null,
    change_amount: null,
    change_pct: null,
    baseline_value: null,
    baseline_points: null,
  },
]

const POLICIES = [
  {
    group_id: 'g1',
    policy_id: 'i1',
    policy_number: 'POL-1',
    label: 'Life cover',
    status: 'in_force',
    insurer: 'A Provider',
    owners: 'Janet Testsmith',
    lives_insured: 'Janet Testsmith',
    cover_types: 'life',
    total_lump_sum_cover: '500000',
    total_monthly_benefit: null,
    premium: '120',
    premium_frequency: 'monthly',
  },
]

const FIXTURES: Record<string, unknown[]> = {
  group_summary: [
    { group_id: 'g1', name: 'Testsmith Household', group_type: 'household', status: 'active' },
  ],
  client_groups: [
    { primary_contact_party_id: 'p1', owner_staff_id: 's1', staff_users: { full_name: 'A Adviser' } },
  ],
  contact_points: [{ party_id: 'p1', kind: 'phone_mobile', value: '0412 555 901', is_preferred: true }],
  client_group_members: [
    {
      party_id: 'p1',
      member_role: 'primary',
      is_primary_group: true,
      parties: { id: 'p1', display_name: 'Janet Testsmith', status: 'active', notes: null, party_type: 'person' },
    },
  ],
  persons: [{ party_id: 'p1', first_name: 'Janet', last_name: 'Testsmith' }],
  party_roles: [{ party_id: 'p1', role: 'client', status: 'active', start_date: '2026-01-01', parties: { display_name: 'A Provider' } }],
  group_financial_accounts: ACCOUNTS,
  group_insurance_policies: POLICIES,
  staff_users: [{ id: 's1', full_name: 'A Adviser', email: 'a@example.com', status: 'active' }],
  group_notes_summary: [],
  workflow_board: [
    {
      id: 'w1', name: 'Annual review 2026', workflow_type: 'annual_review', status: 'in_progress',
      priority: 'medium', group_id: 'g1', group_name: 'Testsmith Household', owner_name: 'A Adviser',
      started_at: '2026-07-01T00:00:00Z', completed_at: null, updated_at: '2026-07-06T02:00:00Z',
    },
  ],
  identity_verification_summary: [],
}

vi.mock('next/headers', () => ({ cookies: async () => ({ getAll: () => [], set: () => {} }) }))
vi.mock('next/navigation', () => ({
  redirect: () => { throw new Error('unexpected redirect') },
  notFound: () => { throw new Error('unexpected notFound') },
}))
vi.mock('@/lib/staff', () => ({
  getCurrentStaff: async () => ({
    id: 's1', full_name: 'A Adviser', email: 'a@example.com', status: 'active',
    access_profiles: { name: 'Admin', view_all_groups: true, view_sensitive: true, manage_groups: true, manage_staff: true, file_unmatched_notes: true },
  }),
}))
vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: async () => ({
    from: (table: string) => {
      const data = FIXTURES[table] ?? []
      const chain: Record<string, unknown> = {}
      for (const m of ['select', 'eq', 'is', 'in', 'neq', 'order', 'limit', 'gte', 'lte', 'not']) {
        chain[m] = () => chain
      }
      chain.maybeSingle = async () => ({ data: data[0] ?? null, error: null })
      chain.single = chain.maybeSingle
      chain.then = (res: (v: unknown) => unknown) => Promise.resolve({ data, error: null }).then(res)
      return chain
    },
    rpc: async () => ({ data: {}, error: null }),
  }),
}))

const { default: GroupDetailPage } = await import('@/app/(shell)/groups/[id]/page')
const { TAB_SPLIT } = await import('@/components/ui')

const panels = async () => {
  render(await GroupDetailPage({ params: Promise.resolve({ id: 'g1' }) }))
  /* Opened, not merely present. Since 11 September a panel is built the first
     time its tab is chosen — so that the investment ring draws on the click
     rather than invisibly at page load — and Workflows is the tab that opens
     first. Workflows stays mounted once left, so both are readable after this. */
  fireEvent.click(screen.getByRole('tab', { name: 'Accounts' }))
  const get = (id: string) => {
    const el = document.getElementById(`panel-${id}`)
    if (!el) throw new Error(`no panel-${id}`)
    return el as HTMLElement
  }
  return { accounts: get('accounts'), workflows: get('workflows') }
}

/**
 * The investment section IS the left column of the split, so it is addressed
 * that way rather than by walking up from its heading. `DataSection` renders a
 * plain `div`, so a `closest('section')` walk would fall back to counting
 * parents — which would still pass today and quietly point at the wrong element
 * the moment the markup gains a wrapper.
 */
const investmentSection = (accounts: HTMLElement) => {
  const grid = accounts.querySelector(`[class="${TAB_SPLIT}"]`)
  if (!grid) throw new Error('the investment section is not in a TAB_SPLIT grid')
  const left = grid.children[0] as HTMLElement
  // Prove it is the section we mean before anything is asserted about it.
  expect(within(left).getByText('Investment Accounts')).toBeTruthy()
  return left
}

describe('the Accounts tab’s investment section', () => {
  test('sits in a two-column split, records on the left and the donut on the right', async () => {
    const { accounts } = await panels()
    const grid = accounts.querySelector(`[class="${TAB_SPLIT}"]`)
    expect(grid, 'the shared split is applied verbatim').toBeTruthy()

    const [left, right] = Array.from(grid!.children) as HTMLElement[]
    expect(grid!.children).toHaveLength(2)

    // The records are on the left, named by their own heading.
    expect(within(left).getByText('Investment Accounts')).toBeTruthy()
    expect(within(left).getByText('Joint Super')).toBeTruthy()

    /* The right half held a dashed `ReservedColumn` until 10 September and now
       holds the mix donut — a trial. What is pinned is that it is the RIGHT
       half: the records must not end up beside it in the other order. */
    /* Identified by slot, not by a heading: "Mix by value" was removed on
       10 September so the chart lines up with the first record rather than
       sitting under a label of its own. */
    expect(right.getAttribute('data-slot')).toBe('mix-chart')
    /* The Accounts tab is open by the time `panels()` returns, so the ring is
       in the accessibility tree and no `hidden` option is needed. */
    expect(within(right).getByRole('img')).toBeTruthy()
  })

  /**
   * **The two columns start their sheets on the same line.**
   *
   * Asked for on 11 September — the chart sat "a little higher" than the
   * records. It was 8px, and the cause was a wrong model of the left column:
   * the chart's spacer copied the HEADING, a 16px text line, but a header row
   * is as tall as its tallest child and that is the 24px add control beside
   * the heading.
   *
   * Both boxes are built from one token now, and this compares the two as
   * RENDERED, on the real page, rather than trusting that they were. Heights
   * cannot be measured here — jsdom lays nothing out — but the boxes are
   * siblings-in-kind: identical classes and identical content metrics mean
   * identical heights, and a difference in either is what used to be there.
   */
  test('the chart’s spacer and the records header are the same box, so the sheets line up', async () => {
    const { accounts } = await panels()
    const grid = accounts.querySelector(`[class="${TAB_SPLIT}"]`)!
    const [left, right] = Array.from(grid.children) as HTMLElement[]

    const header = left.querySelector('[data-slot="section-toolbar"]')!
    const spacer = right.querySelector('[data-slot="chart-spacer"]')!

    /* Layout classes compared exactly. `justify-*` is dropped because it moves
       things across the row and cannot change its height, and `invisible` is
       the whole point of the spacer. */
    const box = (el: Element) =>
      el.className
        .split(/\s+/)
        .filter((c) => c !== 'invisible' && !c.startsWith('justify-'))
        .sort()

    expect(box(spacer), 'the spacer is not the same box as the header row').toEqual(box(header))

    /* And the same tallest child. The row's height comes from the control, so
       equal rows need the control's own box to match too — this is the part
       that was missing entirely. */
    const control = (el: Element) =>
      Array.from(el.children)
        .map((c) => c.className)
        .find((c) => c.includes('py-1'))

    expect(control(spacer), 'the spacer has no control to set its height').toBeTruthy()
    expect(control(spacer)).toBe(control(header))

    // Both sheets then start immediately after their box, on the same line.
    expect(header.nextElementSibling!.className).toBe(spacer.nextElementSibling!.className)
  })

  /**
   * The two tabs share the SPLIT and nothing else. The Workflows tab still
   * reserves its right half, and this is what keeps "shared measurements, own
   * content" true rather than a sentence in a comment.
   */
  test('the Workflows tab still reserves its right half', async () => {
    const { workflows } = await panels()
    const grid = workflows.querySelector(`[class="${TAB_SPLIT}"]`)!
    const right = grid.children[1] as HTMLElement
    expect(right.getAttribute('data-slot')).toBe('placeholder')
    expect(right.getAttribute('aria-hidden')).toBe('true')
    expect(right.textContent).toBe('')
    // And it is not carrying the accounts tab's chart.
    expect(workflows.querySelector('[data-slot="mix-chart"]')).toBeNull()
  })

  /**
   * The split is the SAME constant the Workflows tab uses, which is the point
   * of the request — "exactly the same as the workflows tab". Comparing the two
   * rendered class strings is what would catch one being changed alone.
   */
  /* The proportion itself, so a silent change to 55/45 fails rather than
     quietly re-laying both tabs. Changing it deliberately means changing this
     line, which is the intent. */
  test('the split is 65 / 35, proportional, and shrinkable on both tracks', () => {
    expect(TAB_SPLIT).toContain('lg:grid-cols-[minmax(0,13fr)_minmax(0,7fr)]')
    expect(TAB_SPLIT).toContain('grid-cols-1')
  })

  test('uses the identical split the Workflows tab uses', async () => {
    const { accounts, workflows } = await panels()
    const a = accounts.querySelector(`[class="${TAB_SPLIT}"]`)
    const w = workflows.querySelector(`[class="${TAB_SPLIT}"]`)
    expect(a, 'accounts tab').toBeTruthy()
    expect(w, 'workflows tab').toBeTruthy()
    expect(a!.className).toBe(w!.className)
  })

  /**
   * The removal. There is an unvalued account in the fixture, so the total this
   * replaced would have rendered both a figure and its "Excludes 1 account…"
   * note — neither may appear.
   */
  test('has no total row, figure or excluded-accounts note', async () => {
    const { accounts } = await panels()
    const investment = investmentSection(accounts)

    expect(within(investment).queryByText('Total')).toBeNull()
    expect(within(investment).queryByText(/Excludes \d+ account/)).toBeNull()
    /* The real assertion: no total BAND. The label is caller-supplied, so the
       two text queries above would pass for the wrong reason if a caller ever
       labelled it anything but "Total" — data-section's own test asserts this
       slot exists when a total IS passed, which is what stops this line from
       becoming vacuous. */
    expect(investment.querySelector('[data-slot="total"]')).toBeNull()
  })

  /**
   * The Insurance section below is deliberately still full width — only the
   * investment section was asked for. Pinned so that matching it later is a
   * decision somebody makes on purpose rather than a drift nobody notices.
   */
  test('leaves the Insurance section full width, outside the split', async () => {
    const { accounts } = await panels()
    const grid = accounts.querySelector(`[class="${TAB_SPLIT}"]`)!
    expect(within(accounts).getByText('Insurance Policies')).toBeTruthy()
    expect(within(grid as HTMLElement).queryByText('Insurance Policies')).toBeNull()
  })

  test('the accounts still render their own values, so nothing else was lost', async () => {
    const { accounts } = await panels()
    const investment = investmentSection(accounts)
    expect(within(investment).getByText('Unvalued Portfolio')).toBeTruthy()
    expect(within(investment).getByText(/No value recorded/)).toBeTruthy()
  })
})
