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
  postAccountActivity: vi.fn(async () => ({ ok: true as const })),
  toggleAccountPostReaction: vi.fn(async () => ({ ok: true as const })),
  createPostMedia: vi.fn(),
  postWorkflowActivity: vi.fn(),
  redactPostMedia: vi.fn(),
  togglePostReaction: vi.fn(),
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
  /* A DAY LATER THAN `valued_on`, deliberately. The two dates disagree in
     production — a feed run refreshes cash nightly and dates the valuation
     from the provider's own strike — and while these two were the same day in
     the fixture, a panel that printed one date above both figures passed the
     test beneath. That is the same fixture flaw the value chart's aria-label
     test had, caught the same way: by mutating the component and watching
     nothing fail.

     A BARE DATE, as the column actually is. `snapshot_as_at` is a `date` in
     the database where `allocation_as_at` beneath it is a timestamptz, and an
     earlier draft of this fixture carried a full instant with a +10:00 offset,
     which a date column never produces. That shape hid a real defect: the
     panel was formatting this with `formatNoteDate`, which builds a Date and
     so reads UTC midnight, rendering the day before anywhere west of
     Greenwich. The fixture must be the shape the view returns, or it is
     testing a value the screen will never receive. */
  snapshot_as_at: '2026-09-16',
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
  value_series: [
    { as_at: '2026-09-13', value: 410000 },
    { as_at: '2026-09-14', value: 411000 },
    { as_at: '2026-09-15', value: 412350.55 },
  ],
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
  value_series: null,
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
/** One post on WRAP, one on the other account, so the drawer must filter. */
const POSTS = [
  {
    id: 'post-wrap',
    workflow_id: null,
    account_id: 'a1',
    task_id: null,
    author_staff_id: 's1',
    author_name: 'Sarah Chen',
    body: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Rebalanced today' }] }] },
    body_text: 'Rebalanced today',
    created_at: '2026-09-17T04:00:00Z',
    mentioned: [],
    reactions: [],
    media: [],
    entities: [],
    parent_post_id: null,
    root_post_id: null,
    parent_author_name: null,
  },
  {
    id: 'post-super',
    workflow_id: null,
    account_id: 'a2',
    task_id: null,
    author_staff_id: 's1',
    author_name: 'Sarah Chen',
    body: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'A different account' }] }] },
    body_text: 'A different account',
    created_at: '2026-09-17T05:00:00Z',
    mentioned: [],
    reactions: [],
    media: [],
    entities: [],
    parent_post_id: null,
    root_post_id: null,
    parent_author_name: null,
  },
] as never

const STAFF = [{ id: 's1', name: 'Sarah Chen' }]
const VIEWER = { id: 's1', name: 'Sarah Chen', canRemoveAnyImage: false }

const MEMBERS = [
  { id: 'p1', name: 'Janet Testsmith' },
  { id: 'p2', name: 'Reece Testsmith' },
  { id: 'p3', name: 'Janet Testsmith' },
]

function list(accounts: AccountRow[] = [WRAP, SUPER]) {
  return render(
    <ul>
      <AccountList
        accounts={accounts}
        members={MEMBERS}
        groupName="Testsmith Household"
        posts={POSTS}
        staff={STAFF}
        viewer={VIEWER}
      />
    </ul>,
  )
}

const open = (name: string) =>
  act(() => {
    fireEvent.click(screen.getByRole('button', { name: `Open ${name}` }))
  })

const drawer = (container: HTMLElement) => container.querySelector('dialog')!

/** Open one of the drawer's three tabs. Overview is selected on open. */
const tab = (name: 'Overview' | 'Activity' | 'Details') =>
  act(() => {
    fireEvent.click(screen.getByRole('tab', { name }))
  })

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
          posts={POSTS}
          staff={STAFF}
          viewer={VIEWER}
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
        <AccountList
          accounts={[SUPER]}
          members={MEMBERS}
          groupName="Testsmith Household"
          posts={POSTS}
          staff={STAFF}
          viewer={VIEWER}
        />
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
    tab('Details')
    const d = drawer(container)
    expect(within(d).getByRole('heading', { level: 2 }).textContent).toBe('Netwealth Wrap')
    const product = within(d).getByText('HUB24 SUPER - ACTIVE - PLATINUM')
    expect(product.closest('div')!.textContent).toContain('Product')
  })

  test('and omits the product row entirely when no feed has sent one', () => {
    const { container } = list()
    open('Joint Super')
    tab('Details')
    expect(within(drawer(container)).queryByText('Product')).toBeNull()
  })

  /**
   * BOTH pictures, and they divide the labour. The ring cannot draw a negative
   * share, so it takes the positive classes; the bars beneath take every class
   * with its sign. Asked for as "both" on 17 September precisely so nothing is
   * hidden — which is why this asserts the bars still carry the minus.
   */
  test('draws the allocation as a ring and bars, negatives included in the bars', () => {
    const { container } = list()
    open('Netwealth Wrap')
    const d = drawer(container)
    /* The bars are a <ul>, the ring a <div>; both say themselves in words. */
    const bars = d.querySelector('ul[role="img"]')!
    const ring = d.querySelector('[data-slot="allocation-ring"]')!
    expect(bars.getAttribute('aria-label')).toContain('Australian shares')
    expect(bars.getAttribute('aria-label')).toContain('−')
    expect(ring.getAttribute('aria-label')).toContain('Australian shares')
    /* And the ring says what it left out, so a reader who stops at the circle
       is not left thinking it is the whole account. */
    expect(d.querySelector('[data-slot="donut-omitted"]')!.textContent).toContain('not in the ring')
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
  /**
   * Per tab, because the Activity tab legitimately holds a composer. What must
   * not happen is a stray control in a READ state: a form that posts an empty
   * value over a real one.
   */
  test('the Overview and Details read states contain no form control', () => {
    const { container } = list()
    open('Netwealth Wrap')
    expect(drawer(container).querySelectorAll('input, select, textarea')).toHaveLength(0)
    tab('Details')
    expect(drawer(container).querySelectorAll('input, select, textarea')).toHaveLength(0)
  })

  test('editing Details offers the name and the type, and nothing else', () => {
    const { container } = list()
    open('Netwealth Wrap')
    tab('Details')
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
    tab('Details')
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

/**
 * The three tabs, added 17 September.
 *
 * The drawer was one scrolling column until its own docblock's promotion
 * threshold arrived — "when a third panel arrives that is a stream". Two did at
 * once: a valuation history and a feed.
 */
describe('the account drawer’s tabs', () => {
  test('are Overview, Activity and Details, in that order', () => {
    list()
    open('Netwealth Wrap')
    expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual([
      'Overview',
      'Activity',
      'Details',
    ])
  })

  test('and Overview is the one open on arrival', () => {
    list()
    open('Netwealth Wrap')
    expect(screen.getByRole('tab', { name: 'Overview' }).getAttribute('aria-selected')).toBe('true')
  })
})

describe('the Overview tab', () => {
  test('charts the thirty days the view supplied', () => {
    const { container } = list()
    open('Netwealth Wrap')
    const chart = drawer(container).querySelector('[data-slot="value-chart"]')!
    expect(chart.getAttribute('aria-label')).toContain('$410,000.00 on 13 Sep')
    expect(chart.getAttribute('aria-label')).toContain('$412,350.55 on 15 Sep')
  })

  test('and says so rather than drawing nothing when there is no series', () => {
    const { container } = list()
    open('Joint Super')
    expect(drawer(container).querySelector('[data-slot="value-ghost"]')).toBeTruthy()
    expect(drawer(container).textContent).toContain('nothing to chart')
  })

  /**
   * The two figures carry SEPARATE dates, because they genuinely disagree — a
   * feed run refreshes cash every day and dates the valuation from the
   * provider. One "as at" above both would be wrong for one of them.
   */
  test('states the balance and the cash, each with its own date', () => {
    const { container } = list()
    open('Netwealth Wrap')
    const rows = Array.from(drawer(container).querySelectorAll('[data-slot="figure"]'))
    expect(rows).toHaveLength(2)
    expect(rows[0].textContent).toContain('Balance')
    expect(rows[0].textContent).toContain('$412,350.55')
    expect(rows[0].textContent).toContain('As at 15 Sep 2026')
    expect(rows[1].textContent).toContain('Available cash')
    expect(rows[1].textContent).toContain('$8,421.20')
    /* The SIXTEENTH. The cash was refreshed the night after the valuation was
       struck, and each figure carries its own date rather than sharing one. */
    expect(rows[1].textContent).toContain('As at 16 Sep 2026')
    expect(rows[1].textContent).not.toContain('15 Sep')
  })

  test('and keeps the sentence that stops the two being added', () => {
    const { container } = list()
    open('Netwealth Wrap')
    expect(drawer(container).textContent).toContain('not added together')
  })

  /**
   * THE LAYOUT OF 18 SEPTEMBER, asked for as: figures near the top, the bar
   * chart and the ring on one row, the class bars beneath. Order in the DOM is
   * order on the screen here — the panel is one column with a two-column row
   * inside it — so the DOM is what this asserts.
   */
  test('puts the figures first, the two charts level, and the classes beneath', () => {
    const { container } = list()
    open('Netwealth Wrap')
    const d = drawer(container)
    const figures = d.querySelector('[data-slot="figure"]')!
    const value = d.querySelector('[data-slot="value-chart"]')!
    const ring = d.querySelector('[data-slot="allocation-ring"]')!
    const bars = d.querySelector('ul[role="img"]')!
    const before = (a: Element, b: Element) => Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING)
    expect(before(figures, value), 'figures before the value chart').toBe(true)
    expect(before(value, ring), 'value chart before the ring').toBe(true)
    expect(before(ring, bars), 'ring before the class bars').toBe(true)
    /* Level: the two charts share one grid row, which is one parent. */
    const row = value.closest('.grid')!
    expect(row.contains(ring)).toBe(true)
    expect(row.className).toContain('sm:grid-cols-2')
    expect(row.contains(bars), 'the class bars are below the row, not in it').toBe(false)
  })

  /**
   * The group page's frame — heading, then sheet — on all three pictures, so
   * the drawer's charts and the page's read as one system. Three headings by
   * NAME, because a heading that said "Asset allocation" twice was the first
   * draft and the second one is the ring's detail, not its twin.
   */
  test('frames each picture the way the group page does', () => {
    const { container } = list()
    open('Netwealth Wrap')
    const d = drawer(container)
    const headings = Array.from(d.querySelectorAll('h3')).map((h) => h.textContent)
    expect(headings).toEqual(['Value, last 30 days', 'Asset allocation', 'Allocation by class'])
    for (const slot of ['value-chart', 'allocation-ring']) {
      const sheet = d.querySelector(`[data-slot="${slot}"]`)!.closest('section > div')!
      expect(sheet.className, `${slot} sits on the sheet`).toContain('rounded-lg border border-neutral-200 bg-white')
    }
  })

  /* One absence, one empty state: the ring's ghost explains it and the class
     bars are omitted rather than ghosted beneath. */
  test('omits the class bars when there is no allocation, leaving the ring’s ghost to explain', () => {
    const { container } = list()
    open('Joint Super')
    const d = drawer(container)
    expect(d.querySelector('[data-slot="alloc-ghost-ring"]')).toBeTruthy()
    expect(d.querySelector('ul[role="img"]')).toBeNull()
    expect(Array.from(d.querySelectorAll('h3')).map((h) => h.textContent)).not.toContain('Allocation by class')
    expect(d.querySelector('[data-slot="alloc-ghost"]'), 'the bars’ own ghost is not drawn as well').toBeNull()
  })

  /**
   * The hover that couples the ring and the class bars, carried by the panel
   * because it is the one element that holds both sheets. Pointing at a class
   * row shades the row and tells the stylesheet which arc to pop; pointing at
   * an arc does the same in reverse. Keyed by CLASS, not index, because the
   * ring omits negatives and the two lists do not line up.
   */
  test('pointing at a class row marks the panel, so the stylesheet can pop its arc', () => {
    const { container } = list()
    open('Netwealth Wrap')
    const d = drawer(container)
    const panel = d.querySelector('[data-slot="alloc-chart"]')!
    const cashRow = d.querySelector('[data-slot="alloc-row"][data-class="cash"]')!
    expect(panel.hasAttribute('data-active'), 'at rest').toBe(false)
    fireEvent.mouseEnter(cashRow)
    expect(panel.getAttribute('data-active')).toBe('cash')
    expect(cashRow.getAttribute('data-active')).toBe('true')
    fireEvent.mouseLeave(cashRow)
    expect(panel.hasAttribute('data-active')).toBe(false)
  })

  test('and pointing at an arc marks the same panel with the same class', () => {
    const { container } = list()
    open('Netwealth Wrap')
    const d = drawer(container)
    const panel = d.querySelector('[data-slot="alloc-chart"]')!
    const arc = d.querySelector('.recharts-pie-sector path[data-class="cash"]')!
    fireEvent.mouseEnter(arc)
    expect(panel.getAttribute('data-active')).toBe('cash')
    expect(d.querySelector('[data-slot="alloc-row"][data-class="cash"]')!.getAttribute('data-active')).toBe('true')
  })
})

describe('the Activity tab', () => {
  /* The page hands down every post on the group's accounts, the same way the
     task panel is handed the whole workflow's. The drawer shows one account's. */
  test('shows this account’s posts and not another’s', () => {
    const { container } = list()
    open('Netwealth Wrap')
    tab('Activity')
    expect(drawer(container).textContent).toContain('Rebalanced today')
    expect(drawer(container).textContent).not.toContain('A different account')
  })

  test('and the second account sees its own', () => {
    const { container } = list()
    open('Joint Super')
    tab('Activity')
    expect(drawer(container).textContent).toContain('A different account')
    expect(drawer(container).textContent).not.toContain('Rebalanced today')
  })

  /**
   * No uploader on an account, so the composer's two attach buttons are
   * DISABLED rather than absent — which is the composer's own existing
   * contract (`disabled={!uploader}`), not something added here. The first
   * version of this test expected them gone and was wrong about the component.
   *
   * Media is keyed and path-derived by workflow, and the account write path
   * refuses a document naming a file, so a working button would be a promise
   * the database breaks.
   */
  test('disables the attach buttons, because an account post carries no files', () => {
    const { container } = list()
    open('Netwealth Wrap')
    tab('Activity')
    const d = drawer(container)
    /* `aria-disabled`, which is how the shared `Tool` button marks itself —
       not the `disabled` attribute, and not jest-dom's `toBeDisabled`, which
       this suite does not load. Both earlier drafts of this line failed on the
       assertion rather than on the component, which is the right way round. */
    expect(within(d).getByRole('button', { name: 'Image' }).getAttribute('aria-disabled')).toBe(
      'true',
    )
    expect(
      within(d).getByRole('button', { name: 'Attach file' }).getAttribute('aria-disabled'),
    ).toBe('true')
  })

  test('but does offer a composer', () => {
    const { container } = list()
    open('Netwealth Wrap')
    tab('Activity')
    expect(within(drawer(container)).getByRole('button', { name: /post/i })).toBeTruthy()
  })
})

