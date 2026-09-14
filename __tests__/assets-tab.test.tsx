import { describe, expect, test, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'

/**
 * The Assets + Liabilities tab: two columns, two totals and a net position.
 *
 * The real page module is rendered rather than a copy of its markup, for the
 * reason the accounts tab's test gives — what is worth pinning is the wiring:
 * which side a row lands on, which rows a total counts, and that the headline
 * figures above stop being three copies of one number once this data exists.
 */
/* Declared, not inferred: an inferred union of four literal shapes refuses a
   fifth row built by spreading one of them with different nulls. */
type BalanceFixture = {
  item_id: string
  item_type: string
  side: string
  label: string
  value: string
  valued_on: string
  status: string
  closed_on: string | null
  institution: string | null
  secured_against_id: string | null
  secured_against: string | null
  owners: string
  owner_count: number
  owner_shares: { party_id: string; name: string; share_percent: string }[]
}

const BALANCE: BalanceFixture[] = [
  /* Closed, and FIRST, so a page that forgot to sink it renders it at the head
     of the list and fails. The live rows behind it are in non-alphabetical
     order, so a sink that sorted by name instead of bucketing fails too. */
  {
    item_id: 'b4', item_type: 'holiday_home_or_land', side: 'asset', label: 'Aardvark Block',
    value: '250000', valued_on: '2026-01-01', status: 'closed', closed_on: '2026-06-30',
    institution: null, secured_against_id: null, secured_against: null,
    owners: 'Janet Testsmith', owner_count: 1,
    owner_shares: [{ party_id: 'p1', name: 'Janet Testsmith', share_percent: '100' }],
  },
  {
    item_id: 'b1', item_type: 'principal_residence', side: 'asset', label: 'Mercer Street',
    value: '1200000', valued_on: '2026-09-01', status: 'active', closed_on: null,
    institution: null, secured_against_id: null, secured_against: null,
    owners: 'Janet Testsmith, John Testsmith', owner_count: 2,
    /* 60/40, not an even split: a row that ignored the shares and halved the
       value would produce the same numbers from 50/50 and pass. */
    owner_shares: [
      { party_id: 'p1', name: 'Janet Testsmith', share_percent: '60' },
      { party_id: 'p2', name: 'John Testsmith', share_percent: '40' },
    ],
  },
  {
    item_id: 'b2', item_type: 'cash_at_bank', side: 'asset', label: 'Everyday account',
    value: '48000', valued_on: '2026-09-01', status: 'active', closed_on: null,
    institution: 'A Provider', secured_against_id: null, secured_against: null,
    owners: 'Janet Testsmith', owner_count: 1,
    owner_shares: [{ party_id: 'p1', name: 'Janet Testsmith', share_percent: '100' }],
  },
  {
    item_id: 'b3', item_type: 'home_loan', side: 'liability', label: 'Mercer Street mortgage',
    value: '540000', valued_on: '2026-09-01', status: 'active', closed_on: null,
    institution: 'A Provider', secured_against_id: 'b1', secured_against: 'Mercer Street',
    owners: 'Janet Testsmith, John Testsmith', owner_count: 2,
    owner_shares: [
      { party_id: 'p1', name: 'Janet Testsmith', share_percent: '60' },
      { party_id: 'p2', name: 'John Testsmith', share_percent: '40' },
    ],
  },
]

const ACCOUNTS = [
  {
    group_id: 'g1', account_id: 'a1', account_type: 'superannuation', label: 'Joint Super',
    status: 'active', owners: 'Janet Testsmith', latest_value: '486210', valued_on: '2026-09-01',
    change_amount: '1200', change_pct: '0.25', baseline_value: '485010', baseline_points: 30,
  },
]

let balance = BALANCE

const FIXTURES = (): Record<string, unknown[]> => ({
  group_summary: [
    { group_id: 'g1', name: 'Testsmith Household', group_type: 'household', status: 'active' },
  ],
  client_groups: [
    { primary_contact_party_id: 'p1', owner_staff_id: 's1', staff_users: { full_name: 'A Adviser' } },
  ],
  contact_points: [],
  client_group_members: [
    {
      party_id: 'p1', member_role: 'primary', is_primary_group: true,
      parties: { id: 'p1', display_name: 'Janet Testsmith', status: 'active', notes: null, party_type: 'person' },
    },
  ],
  persons: [{ party_id: 'p1', first_name: 'Janet', last_name: 'Testsmith' }],
  party_roles: [{ party_id: 'p1', role: 'client', status: 'active', start_date: '2026-01-01', parties: { display_name: 'A Provider' } }],
  group_financial_accounts: ACCOUNTS,
  group_insurance_policies: [],
  group_assets_liabilities: balance,
  staff_users: [{ id: 's1', full_name: 'A Adviser', email: 'a@example.com', status: 'active' }],
  group_notes_summary: [],
  workflow_board: [],
  identity_verification_summary: [],
})

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
      const data = FIXTURES()[table] ?? []
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
const { BALANCE_SPLIT, TAB_SPLIT, WELL, WORKING_AREA } = await import('@/components/ui')

beforeEach(() => {
  balance = BALANCE
})

/** Opens the tab and returns its panel. Panels are built on first open. */
const openTab = async () => {
  render(await GroupDetailPage({ params: Promise.resolve({ id: 'g1' }) }))
  fireEvent.click(screen.getByRole('tab', { name: 'Assets + Liabilities' }))
  const el = document.getElementById('panel-assets-liabilities')
  if (!el) throw new Error('no panel-assets-liabilities')
  return el as HTMLElement
}

const columns = (panel: HTMLElement) => {
  const grid = panel.querySelector(`[class="${BALANCE_SPLIT}"]`)
  if (!grid) throw new Error('the two sections are not in a BALANCE_SPLIT grid')
  const [assets, liabilities] = Array.from(grid.children) as HTMLElement[]
  return { grid, assets, liabilities }
}

const labels = (section: HTMLElement) =>
  Array.from(section.querySelectorAll('li')).map(
    (li) => li.querySelector('.font-semibold')?.textContent ?? '',
  )

describe('the Assets + Liabilities tab', () => {
  test('splits into two columns, owned on the left and owed on the right', async () => {
    const panel = await openTab()
    const { grid, assets, liabilities } = columns(panel)
    expect(grid.children).toHaveLength(2)

    expect(within(assets).getByText('Assets')).toBeTruthy()
    expect(within(liabilities).getByText('Liabilities')).toBeTruthy()

    /* The rows, not just the headings: a page that put both sections in place
       and then filtered neither would pass on headings alone. */
    expect(labels(assets)).toContain('Mercer Street')
    expect(labels(assets)).not.toContain('Mercer Street mortgage')
    expect(labels(liabilities)).toEqual(['Mercer Street mortgage'])
  })

  /**
   * These two columns are peers and split evenly, where the Accounts tab's
   * split is 65/35 because it holds a list beside a chart. Sharing that token
   * would make a change to one tab silently re-lay the other.
   */
  test('the split is even, and is not the accounts tab’s 65 / 35', async () => {
    const panel = await openTab()
    expect(BALANCE_SPLIT).toContain('lg:grid-cols-2')
    expect(BALANCE_SPLIT).not.toBe(TAB_SPLIT)
    expect(panel.querySelector(`[class="${TAB_SPLIT}"]`)).toBeNull()
    // Same gap and breakpoint as the other tab, so the page still feels like one.
    expect(BALANCE_SPLIT).toContain('gap-4')
    expect(BALANCE_SPLIT).toContain('grid-cols-1')
  })

  test('a sold asset sinks below the ones still held, which keep their order', async () => {
    const panel = await openTab()
    expect(labels(columns(panel).assets)).toEqual([
      'Mercer Street',
      'Everyday account',
      'Aardvark Block',
    ])
  })

  describe('the totals', () => {
    const total = (section: HTMLElement) =>
      section.querySelector('[data-slot="total"]') as HTMLElement | null

    test('each column totals its own side, and the closed row is left out', async () => {
      const panel = await openTab()
      const { assets, liabilities } = columns(panel)

      /* 1,200,000 + 48,000. The sold block is 250,000 and would show as
         $1,498,000 if it were counted. */
      expect(total(assets)!.textContent).toContain('$1,248,000.00')
      expect(total(assets)!.textContent).not.toContain('$1,498,000')
      expect(total(liabilities)!.textContent).toContain('\u2212$540,000.00')
    })

    /** A total that quietly drops rows is worse than no total at all. */
    test('the assets total says what it left out, and the liabilities total has nothing to say', async () => {
      const panel = await openTab()
      const { assets, liabilities } = columns(panel)
      expect(total(assets)!.textContent).toContain('1 closed item excluded')
      expect(total(liabilities)!.textContent).not.toContain('excluded')
    })

    /**
     * Net position is the subtraction neither column can state, so it sits
     * under both rather than inside either — where it would read as that
     * column's own total.
     */
    test('net position is stated once, below both columns', async () => {
      const panel = await openTab()
      const { grid } = columns(panel)
      const net = within(panel).getByText('Net position').closest('div') as HTMLElement
      expect(net.textContent).toContain('$708,000.00')
      expect(grid.contains(net), 'net position is inside a column').toBe(false)
    })

    /* With nothing owed, net position equals the assets total above it and says
       nothing — so it is not shown. The same is true with nothing owned. */
    test('with one side empty there is no net position to state', async () => {
      balance = BALANCE.filter((b) => b.side === 'asset')
      const panel = await openTab()
      expect(within(panel).queryByText('Net position')).toBeNull()
      expect(within(panel).getByText('No liabilities yet')).toBeTruthy()
      // Nor a bar: one colour says nothing the total above it has not said.
      expect(panel.querySelector('[data-slot="balance-bar"]')).toBeNull()
    })

    /**
     * **The bar sits above the net position**, asked for on 14 September: the
     * two column totals give the figures and the net gives the difference, and
     * neither shows the SHAPE of the sheet.
     *
     * Order is asserted by document position rather than by reading the markup,
     * so a refactor that moves one of them fails here.
     */
    test('a proportion bar sits above the net position, outside both columns', async () => {
      const panel = await openTab()
      const { grid } = columns(panel)
      const bar = panel.querySelector('[data-slot="balance-bar"]') as HTMLElement
      const net = within(panel).getByText('Net position').closest('div') as HTMLElement

      expect(bar, 'no balance bar on a sheet with both sides').toBeTruthy()
      expect(grid.contains(bar), 'the bar is inside a column').toBe(false)
      /* DOCUMENT_POSITION_FOLLOWING: the net card comes after the bar. */
      expect(bar.compareDocumentPosition(net) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    })

    /* The bar reads the same totals the two columns do — closed rows excluded —
       so the sold block cannot widen the blue. 1,248,000 against 540,000 is
       70 / 30; counting it would be 1,498,000 against 540,000, or 73 / 27. */
    test('the bar is drawn from the same totals, with the closed row left out', async () => {
      const panel = await openTab()
      const bar = panel.querySelector('[data-slot="balance-bar"]') as HTMLElement
      expect(bar.textContent).toContain('70%')
      expect(bar.textContent).toContain('30%')
      expect(bar.textContent).not.toContain('73%')

      /* The WIDTH is the unrounded figure, not the 70% on the label: the two
         segments have to total exactly 100 or the bar shows a sliver of its
         own ground at one end. */
      const assets = bar.querySelector('[data-slot="bar-assets"]') as HTMLElement
      const liabilities = bar.querySelector('[data-slot="bar-liabilities"]') as HTMLElement
      expect(assets.className).toContain('bg-blue-600')
      expect(parseFloat(assets.style.flexBasis)).toBeCloseTo(69.7987, 3)
      expect(
        parseFloat(assets.style.flexBasis) + parseFloat(liabilities.style.flexBasis),
      ).toBe(100)
    })
  })

  describe('a row', () => {
    const rowFor = (panel: HTMLElement, text: string) =>
      Array.from(panel.querySelectorAll('li')).find((li) => li.textContent?.includes(text))!

    test('names its type, its owners and their shares', async () => {
      const panel = await openTab()
      const row = rowFor(panel, 'Mercer Street mortgage')
      expect(row.textContent).toContain('Home loan')
      /* The shares are the whole reason this table records them, and 60/40 is
         not what an even split would print. */
      expect(row.textContent).toContain('Janet Testsmith 60%')
      expect(row.textContent).toContain('John Testsmith 40%')
    })

    /** One name already means all of it; "Janet 100%" is noise. */
    test('a sole owner is named without a percentage', async () => {
      const panel = await openTab()
      const row = rowFor(panel, 'Everyday account')
      expect(row.textContent).toContain('Janet Testsmith')
      expect(row.textContent).not.toContain('100%')
    })

    /** The one thing on a row that points at another row. */
    test('a secured loan says what it is secured against', async () => {
      const panel = await openTab()
      expect(rowFor(panel, 'Mercer Street mortgage').textContent).toContain(
        'Secured against Mercer Street',
      )
      expect(rowFor(panel, 'Everyday account').textContent).not.toContain('Secured against')
    })

    test('shows its value', async () => {
      const panel = await openTab()
      expect(rowFor(panel, 'Mercer Street').textContent).toContain('$1,200,000.00')
    })

    /**
     * **What separates the two columns, decided 14 September** after they read
     * as one list: a liability's figure is SIGNED — a true minus, U+2212, not a
     * hyphen — and a shade lighter, and its total is signed the same way. An
     * asset's figure carries no sign at all. Both halves are asserted, because
     * a hyphen would pass a loose "contains a dash" check and is the wrong
     * glyph: short, low, and the one that appears in names.
     */
    test('a liability’s figure is signed with a true minus, and an asset’s is not', async () => {
      const panel = await openTab()
      const owed = rowFor(panel, 'Mercer Street mortgage')
      expect(owed.textContent).toContain('\u2212$540,000.00')
      expect(owed.textContent).not.toContain('-$')

      const owned = rowFor(panel, 'Everyday account')
      expect(owned.textContent).toContain('$48,000.00')
      expect(owned.textContent).not.toMatch(/[\u2212-]\$48,000/)
    })

    test('and a shade lighter than an asset’s, without touching the row’s weight', async () => {
      const panel = await openTab()
      /* The INNERMOST span holding the figure: the lighter tone sits on an
         inner span so `DataRow`'s own semibold, size and 900 still apply
         around it. An asset's figure has no inner span at all — it sits
         directly in the row's figure column. */
      const figure = (text: string) =>
        Array.from(rowFor(panel, text).querySelectorAll('span'))
          .filter((el) => el.children.length === 0 && /\$[\d,]+\.\d\d$/.test(el.textContent ?? ''))
          .at(-1)!
      expect(figure('Mercer Street mortgage').className).toContain('text-neutral-600')
      expect(figure('Mercer Street mortgage').parentElement!.className).toContain('text-neutral-900')
      expect(figure('Everyday account').className).not.toContain('text-neutral-600')
      expect(figure('Everyday account').className).toContain('text-neutral-900')
    })

    /**
     * The tile carries the type as a glyph, because it carries no colour — and
     * a closed row gives the glyph up for the archive and takes the dormant
     * grey, which here also means "not counted in the total below".
     */
    /**
     * **Owned is neutral, owed is a very light red.** The other half of the
     * 14 September separation, asked for after a dark-filled tile was tried:
     * the tile carries the SIDE, not the type.
     *
     * Red is spent knowingly — it is the falling half of `PILL_TONES` — so what
     * is pinned here is that the asset side stays clear of it entirely. A
     * change that tinted both would undo the whole point and is the thing most
     * likely to happen by accident.
     */
    test('an asset’s tile is neutral and a liability’s is light red', async () => {
      const panel = await openTab()
      const tile = (text: string) =>
        rowFor(panel, text).querySelector('span[aria-hidden="true"]') as HTMLElement

      const owned = tile('Mercer Street')
      expect(owned.className).toContain('bg-neutral-100')
      expect(owned.className).toContain('text-neutral-700')
      expect(owned.className).not.toContain('red')

      const owed = tile('Mercer Street mortgage')
      expect(owed.className).toContain('bg-red-50')
      expect(owed.className).toContain('text-red-700')
      expect(owed.className).not.toBe(owned.className)

      /* Neither side borrows a hue that names a KIND of holding elsewhere on
         this page — gold investments, emerald super, sky insurance — which
         would say these rows are one of those. */
      for (const t of [owned, owed]) {
        for (const spoken of ['bg-gold-50', 'bg-emerald-50', 'bg-sky-50']) {
          expect(t.className).not.toContain(spoken)
        }
      }
    })

    /**
     * The tile is the only red on the row. The figure stays neutral: red
     * numerals in a column read as an error state rather than as the ordinary
     * way a balance sheet prints what is owed, and the minus sign already says
     * it.
     */
    test('the red stops at the tile — the figure beside it is not red', async () => {
      const panel = await openTab()
      const row = rowFor(panel, 'Mercer Street mortgage')
      const figures = Array.from(row.querySelectorAll('span')).filter(
        (el) => el.children.length === 0 && /\$[\d,]+\.\d\d$/.test(el.textContent ?? ''),
      )
      expect(figures.length).toBeGreaterThan(0)
      for (const f of figures) expect(f.className).not.toContain('red')
    })

    /* Closed collapses both sides to the same dormant grey: a repaid loan and a
       sold house are equally finished, and "not counted" outranks "which
       side" once a row is out of the total. */
    test('a closed row’s tile is the dormant grey whichever side it is on, and is marked', async () => {
      balance = [
        ...BALANCE,
        {
          ...BALANCE[3], item_id: 'b5', label: 'Old car loan', item_type: 'car_loan',
          status: 'closed', closed_on: '2026-03-01', secured_against_id: null, secured_against: null,
        },
      ]
      const panel = await openTab()
      const tile = (text: string) =>
        rowFor(panel, text).querySelector('span[aria-hidden="true"]') as HTMLElement

      const soldAsset = tile('Aardvark Block')
      const repaidLoan = tile('Old car loan')
      expect(soldAsset.className).toContain('text-neutral-500')
      expect(repaidLoan.className).toBe(soldAsset.className)
      // The red goes with it: a repaid loan is not owed any more.
      expect(repaidLoan.className).not.toContain('red')

      expect(soldAsset.getAttribute('title')).toBe('Closed')
      // And the word survives for a screen reader, since nothing else says it.
      expect(rowFor(panel, 'Aardvark Block').querySelector('.sr-only')!.textContent).toBe('Closed')
      // The repaid loan is still signed — it is a debt that was, not an asset.
      expect(rowFor(panel, 'Old car loan').textContent).toContain('\u2212$540,000.00')

      /* And both closed figures are lighter still (400) — lighter than a live
         liability's 600 — because a figure that is not in the total below
         should not read with the weight of one that is. Found by mutation: the
         closed branch could be removed and nothing here noticed. */
      const figure = (text: string) =>
        Array.from(rowFor(panel, text).querySelectorAll('span'))
          .filter((el) => el.children.length === 0 && /\$[\d,]+\.\d\d$/.test(el.textContent ?? ''))
          .at(-1)!
      expect(figure('Aardvark Block').className).toContain('text-neutral-400')
      expect(figure('Old car loan').className).toContain('text-neutral-400')
      expect(figure('Old car loan').className).not.toContain('text-neutral-600')
    })

    /* Each type gets its OWN glyph — asserted by drawn path, not merely by
       "there is an svg here", which every row would pass. */
    test('two different types draw two different glyphs', async () => {
      const panel = await openTab()
      const glyph = (text: string) =>
        rowFor(panel, text).querySelector('svg')!.innerHTML
      expect(glyph('Everyday account')).not.toBe(glyph('Mercer Street'))
      // The mortgage is a house, like the house it is against — same glyph.
      expect(glyph('Mercer Street mortgage')).toBe(glyph('Mercer Street'))
    })
  })

  /**
   * **The three headline figures stop being the same number.** They were
   * identical while assets and liabilities did not exist, and two of them
   * carried a tooltip admitting it. This is the join point the whole feature
   * exists for, so it is asserted on the rendered header rather than in the
   * arithmetic alone.
   */
  test('the headline figures now differ, and wealth is assets less debts', async () => {
    render(await GroupDetailPage({ params: Promise.resolve({ id: 'g1' }) }))
    /* Addressed by label rather than by position, so a reordering of the three
       fails loudly instead of quietly comparing the wrong pair. */
    const figure = (label: string) =>
      screen.getByText(label).nextElementSibling!.textContent

    // 486,210 super + 1,248,000 assets = 1,734,210, less 540,000 owed.
    expect(figure('Total investments')).toBe('$486,210')
    expect(figure('Total assets')).toBe('$1,734,210')
    expect(figure('Total wealth')).toBe('$1,194,210')

    const all = ['Total wealth', 'Total investments', 'Total assets'].map(figure)
    expect(new Set(all).size, 'the three headline figures are still one number').toBe(3)
  })

  /**
   * **What a new loan can be secured against is the group's LIVE assets.**
   * Offering a house they have sold creates a link somebody then has to notice
   * is wrong — and the database would accept it, since a closed asset is still
   * an asset.
   */
  test('the add-liability form offers the assets still held, and not the sold one', async () => {
    const panel = await openTab()
    fireEvent.click(within(panel).getByRole('button', { name: 'Add liability' }))
    const select = within(panel).getByRole<HTMLSelectElement>('combobox', {
      name: 'Secured against',
      hidden: true,
    })
    const offered = [...select.options].map((o) => o.textContent)
    expect(offered).toContain('Mercer Street')
    expect(offered).toContain('Everyday account')
    expect(offered).not.toContain('Aardvark Block')
  })

  /**
   * **The middle column keeps a working area**, asked for on 14 September: a
   * group with two assets left the centre card barely taller than its own
   * heading, beside a file-notes column three times its height.
   *
   * Asserted on the real page and across more than one tab, because the floor
   * is only worth having if it is the same on all of them — a floor on the tall
   * tab alone would produce the jump it exists to remove.
   */
  test('every tab panel has a floor of half the viewport, carrying the grey ground', async () => {
    render(await GroupDetailPage({ params: Promise.resolve({ id: 'g1' }) }))
    /* Named, not swept up by role: the member panel on this same page has tabs
       of its own, and those deliberately DO NOT take the floor — they fill a
       fixed-height slide-out, where a viewport minimum would push the strip off the
       top. Listing the ids also fails if a tab is renamed without a thought for
       this. */
    const ids = ['workflows', 'accounts', 'assets-liabilities', 'goals']
    for (const id of ids) {
      const p = document.getElementById(`panel-${id}`)
      expect(p, `no panel-${id}`).toBeTruthy()
      expect(p!.className, id).toContain(WORKING_AREA)
      // Same box as the well, or the grey stops short of the card's edge.
      expect(p!.className, id).toContain(WELL)
    }

    /* And the member panel's tabs are untouched — the floor is the middle
       column's, not every tab strip's in the app. */
    const member = document.getElementById('panel-personal')
    expect(member, 'the member panel no longer renders, so this proves nothing').toBeTruthy()
    expect(member!.className).not.toContain(WORKING_AREA)
  })

  /* The figure itself, so a silent change to 40% fails here rather than
     quietly re-laying the page. Changing it deliberately means changing this
     line, which is the intent. */
  test('and that floor is 50vh, not some other fraction', () => {
    expect(WORKING_AREA).toBe('min-h-[50vh]')
  })

  test('with nothing recorded the tab still offers both sides', async () => {
    balance = []
    const panel = await openTab()
    expect(within(panel).getByText('No assets yet')).toBeTruthy()
    expect(within(panel).getByText('No liabilities yet')).toBeTruthy()
    expect(within(panel).queryByText('Net position')).toBeNull()
    expect(panel.querySelector('[data-slot="total"]')).toBeNull()
  })
})
