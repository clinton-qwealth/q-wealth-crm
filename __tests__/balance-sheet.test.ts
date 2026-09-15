import { migrationSource } from './helpers/migration'
import { describe, expect, test } from 'vitest'
import {
  ASSET_TYPES,
  balanceSplit,
  ITEM_TYPE_LABEL,
  LIABILITY_TYPES,
  balanceTotals,
  shareFor,
  type BalanceRow,
} from '@/lib/balance-sheet'

const MIGRATION = migrationSource('a_group_s_assets_and_liabilities')

const row = (o: Partial<BalanceRow> & { value: string | number | null }): BalanceRow => ({
  item_id: Math.random().toString(36).slice(2),
  side: 'asset',
  status: 'active',
  ...o,
})

/**
 * **The lists in `lib/balance-sheet.ts` and the enum in the database are one
 * taxonomy kept in two places**, which is a thing that goes wrong silently: a
 * type added to the enum and forgotten here can never be recorded, and looks
 * exactly like a type that does not exist. So the migration is read and
 * compared, in both directions.
 */
describe('the type taxonomy matches the database', () => {
  const enumValues = () => {
    const block = /create type public\.asset_liability_type as enum \(([\s\S]*?)\);/.exec(MIGRATION)
    expect(block, 'the enum is not in the migration under the name this test expects').toBeTruthy()
    return [...block![1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1])
  }

  /** The asset arm of `balance_side_of`. Everything else falls to `else`. */
  const sqlAssets = () => {
    const fn = /create or replace function public\.balance_side_of[\s\S]*?\$function\$([\s\S]*?)\$function\$/.exec(
      MIGRATION,
    )
    expect(fn).toBeTruthy()
    return [...fn![1].matchAll(/when '([a-z_]+)'\s+then 'asset'/g)].map((m) => m[1])
  }

  test('every enum value is offered, and nothing is offered that the enum lacks', () => {
    const offered = [...ASSET_TYPES, ...LIABILITY_TYPES].map(([v]) => v)
    expect([...offered].sort()).toEqual([...enumValues()].sort())
  })

  /* Not a restatement of the line above: this is the SIDE, which the database
     derives with its own `case` and the app splits with two lists. They agree
     or a car loan can be offered in the assets column. */
  test('the asset list is exactly the side the database derives', () => {
    expect(ASSET_TYPES.map(([v]) => v)).toEqual(sqlAssets())
    /* Both counts, so a change that moved a type from one list to the other
       and edited the SQL to match still has to be deliberate. */
    expect(ASSET_TYPES).toHaveLength(12)
    expect(LIABILITY_TYPES).toHaveLength(10)
  })

  test('every type has a label, and no two types share one', () => {
    const all = [...ASSET_TYPES, ...LIABILITY_TYPES]
    for (const [value, label] of all) {
      expect(ITEM_TYPE_LABEL[value], `${value} has no label`).toBe(label)
      expect(label.trim()).not.toBe('')
    }
    expect(new Set(all.map(([, l]) => l)).size).toBe(all.length)
  })
})

describe('balanceTotals', () => {
  const ROWS: BalanceRow[] = [
    row({ side: 'asset', value: '900000' }),
    row({ side: 'asset', value: '35000.50' }),
    row({ side: 'liability', value: '420000' }),
    row({ side: 'liability', value: '12000.25' }),
  ]

  test('sums each side and subtracts one from the other', () => {
    const t = balanceTotals(ROWS)
    expect(t.assets).toBe(935000.5)
    expect(t.liabilities).toBe(432000.25)
    expect(t.net).toBe(503000.25)
  })

  /**
   * **A liability is stored positive and subtracted here.** The value column is
   * positive on both sides, so a total built by simply adding everything up
   * would report a group's debts as wealth — the single worst arithmetic error
   * this page could make. The fixture's liabilities are large enough that such
   * a total would be obviously wrong here.
   */
  test('a liability never adds to the assets figure', () => {
    const t = balanceTotals(ROWS)
    expect(t.assets).toBeLessThan(t.assets + t.liabilities)
    expect(t.net).toBeLessThan(t.assets)
  })

  /**
   * **Closed rows count for nothing.** A sold house and a repaid loan are
   * history, and both sides are checked: excluding closed assets but counting
   * closed debts would understate the group's position, which is the direction
   * a mistake is least likely to be noticed.
   */
  test('a sold asset and a repaid loan are both excluded, and counted as excluded', () => {
    const t = balanceTotals([
      ...ROWS,
      row({ side: 'asset', value: '500000', status: 'closed' }),
      row({ side: 'liability', value: '250000', status: 'closed' }),
    ])
    expect(t.assets).toBe(935000.5)
    expect(t.liabilities).toBe(432000.25)
    expect(t.closed).toBe(2)
  })

  test('nothing recorded is three zeroes, not a crash', () => {
    expect(balanceTotals([])).toEqual({ assets: 0, liabilities: 0, net: 0, closed: 0 })
  })

  /* PostgREST sends `numeric` as a string to keep its precision, so the totals
     have to survive that. A row whose value never arrived contributes nothing
     rather than a NaN that poisons the whole figure. */
  test('string amounts add up, and a missing one does not become NaN', () => {
    const t = balanceTotals([row({ value: '100.10' }), row({ value: null }), row({ value: 50 })])
    expect(t.assets).toBeCloseTo(150.1, 2)
  })

  /** Owing more than you own is a real answer. */
  test('net position can be negative', () => {
    expect(
      balanceTotals([row({ side: 'asset', value: '10' }), row({ side: 'liability', value: '25' })])
        .net,
    ).toBe(-15)
  })
})

describe('balanceSplit', () => {
  const split = (assets: number, liabilities: number) =>
    balanceSplit({ assets, liabilities, net: assets - liabilities, closed: 0 })

  /**
   * **The denominator is both sides added together**, not the assets. A group
   * with $1.2m of property and $540k of debt reads 70 / 30 — the shape of the
   * sheet. Dividing the debt by the assets gives 45%, with no second number to
   * draw beside it, and that is the mistake this test exists to catch.
   */
  test('divides the two sides by their sum, not one by the other', () => {
    const s = split(1_200_000, 540_000)!
    expect(s.assets.text).toBe('69%')
    expect(s.liabilities.text).toBe('31%')
    // The trap, stated as a number so its absence is unmistakable.
    expect(Math.round((540_000 / 1_200_000) * 100)).toBe(45)
    expect(s.liabilities.text).not.toBe('45%')
  })

  /* Exact and complementary, so a bar drawn from them never shows a sliver of
     its own ground at one end. */
  test('the widths always total exactly 100', () => {
    for (const [a, l] of [[1, 2], [1_200_000, 540_000], [3, 7], [999_999, 1]] as const) {
      const s = split(a, l)!
      expect(s.assets.width + s.liabilities.width).toBe(100)
    }
  })

  /**
   * **The two labels always total 100 too.** Rounded independently, 69.5 and
   * 30.5 both round up and the bar reads "70% / 31%" — a pair that does not add
   * up reads as an arithmetic error even though each number is right on its
   * own. The liability's label is the complement of the asset's rounded value.
   */
  test('and so do the labels, even where both sides would round up alone', () => {
    const s = split(69.5, 30.5)!
    expect(Math.round(30.5)).toBe(31) // what independent rounding would print
    expect([s.assets.text, s.liabilities.text]).toEqual(['70%', '30%'])
  })

  /* A side that exists but rounds to nothing still says it exists — the bar is
     drawing it, and a label reading 0% would deny what is on screen. */
  test('a side too small to round to a percent reads “<1%”', () => {
    const s = split(1_000_000, 1_000)!
    expect(s.liabilities.text).toBe('<1%')
    expect(s.assets.text).toBe('>99%')
    expect(s.liabilities.width).toBeGreaterThan(0)
  })

  /** And the reverse: everything owed, almost nothing owned. */
  test('the guards work the other way round too', () => {
    const s = split(1_000, 1_000_000)!
    expect(s.assets.text).toBe('<1%')
    expect(s.liabilities.text).toBe('>99%')
  })

  /* Exactly one side, exactly 100 — no guard, because nothing is being denied. */
  test('a sheet with no debts is a flat 100 / 0', () => {
    const s = split(500_000, 0)!
    expect([s.assets.text, s.liabilities.text]).toEqual(['100%', '0%'])
    expect(s.liabilities.width).toBe(0)
  })

  test('an even split is 50 / 50', () => {
    const s = split(250_000, 250_000)!
    expect([s.assets.text, s.liabilities.text]).toEqual(['50%', '50%'])
    expect(s.assets.width).toBe(50)
  })

  /** Nothing to divide is no bar at all — one colour, or none, says less than
   *  an empty space does. */
  test('nothing on either side has no split', () => {
    expect(split(0, 0)).toBeNull()
  })

  /* Reachable: every row recorded at zero. The sum is not positive, so there is
     still nothing to divide — and dividing by it would be an infinity. */
  test('a zero sum is null rather than NaN', () => {
    const s = balanceSplit({ assets: 0, liabilities: 0, net: 0, closed: 3 })
    expect(s).toBeNull()
  })

  /** The totals it reads have already dropped the closed rows, so a sold house
   *  cannot widen the blue. Asserted through `balanceTotals` rather than by
   *  hand, so the two cannot drift. */
  test('closed rows do not reach the bar', () => {
    const live = balanceTotals([
      row({ side: 'asset', value: '750000' }),
      row({ side: 'liability', value: '250000' }),
    ])
    const withClosed = balanceTotals([
      row({ side: 'asset', value: '750000' }),
      row({ side: 'liability', value: '250000' }),
      row({ side: 'asset', value: '2000000', status: 'closed' }),
    ])
    expect(balanceSplit(withClosed)).toEqual(balanceSplit(live))
    expect(balanceSplit(live)!.assets.text).toBe('75%')
  })
})

describe('shareFor', () => {
  /* 60/40, deliberately NOT 50/50: an even split is the number a hardcoded
     "half of it" would also produce, so the test would pass without reading
     the shares at all. This is what the share column exists for. */
  const HOUSE = row({
    side: 'asset',
    value: '1000000',
    owner_shares: [
      { party_id: 'p1', name: 'Janet', share_percent: '60' },
      { party_id: 'p2', name: 'John', share_percent: '40' },
    ],
  })
  const LOAN = row({
    side: 'liability',
    value: '400000',
    owner_shares: [
      { party_id: 'p1', name: 'Janet', share_percent: '75' },
      { party_id: 'p2', name: 'John', share_percent: '25' },
    ],
  })

  test('each member gets their own share, on both sides', () => {
    expect(shareFor([HOUSE, LOAN], 'p1')).toMatchObject({
      assets: 600000,
      liabilities: 300000,
      net: 300000,
    })
    expect(shareFor([HOUSE, LOAN], 'p2')).toMatchObject({
      assets: 400000,
      liabilities: 100000,
      net: 300000,
    })
  })

  test('the shares add back up to the whole', () => {
    const whole = balanceTotals([HOUSE, LOAN])
    const p1 = shareFor([HOUSE, LOAN], 'p1')
    const p2 = shareFor([HOUSE, LOAN], 'p2')
    expect(p1.assets + p2.assets).toBe(whole.assets)
    expect(p1.liabilities + p2.liabilities).toBe(whole.liabilities)
  })

  /**
   * A row with no shares recorded contributes **nothing** to anybody, rather
   * than everything to the person asking. A silent 100% would be a figure
   * nobody entered appearing in a figure somebody reads out.
   */
  test('a row with no shares gives nobody anything', () => {
    const orphan = row({ side: 'asset', value: '500000', owner_shares: null })
    expect(shareFor([orphan], 'p1').assets).toBe(0)
  })

  test('somebody who owns none of it gets nothing', () => {
    expect(shareFor([HOUSE, LOAN], 'p9')).toMatchObject({ assets: 0, liabilities: 0, net: 0 })
  })

  /* Closed rows are excluded here for the same reason they are excluded from
     the group total: the member's share of a house they have sold is nothing. */
  test('a member’s share of a closed item is nothing', () => {
    const sold = row({
      side: 'asset',
      value: '900000',
      status: 'closed',
      owner_shares: [{ party_id: 'p1', name: 'Janet', share_percent: '100' }],
    })
    expect(shareFor([HOUSE, sold], 'p1').assets).toBe(600000)
  })
})
