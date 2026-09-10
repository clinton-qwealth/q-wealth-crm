import { describe, expect, test } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { AccountDonut, type DonutAccount } from '@/components/account-donut'

/**
 * The investment mix donut — a trial in the Accounts tab's right column.
 *
 * Two kinds of assertion here, and the second is the reason this file is long.
 *
 * The first is what a reader sees: shares not amounts, a count in the centre,
 * and — the one that matters — **it says how many accounts it cannot show**.
 * Nothing writes a valuation after an account's opening one, so unvalued
 * accounts are the normal case, and a chart that dropped them silently would be
 * the defect the wealth summary was built to avoid.
 *
 * The second is the geometry. A hand-rolled ring fails quietly: the arcs still
 * draw, they just add up to the wrong thing. So the dash lengths and offsets are
 * checked against the circumference directly, because nothing else will notice.
 */
const R = 40
const C = 2 * Math.PI * R

const account = (o: Partial<DonutAccount> & { latest_value: string | number | null }): DonutAccount => ({
  account_id: Math.random().toString(36).slice(2),
  label: 'An account',
  ...o,
})

const segments = () => Array.from(document.querySelectorAll('circle'))
const legend = () => screen.getByRole('list')

describe('the investment mix donut', () => {
  test('one segment per account, ordered largest share first', () => {
    render(
      <AccountDonut
        accounts={[
          account({ label: 'Small', latest_value: 100 }),
          account({ label: 'Large', latest_value: 700 }),
          account({ label: 'Middle', latest_value: 200 }),
        ]}
      />,
    )
    expect(segments()).toHaveLength(3)
    const rows = within(legend()).getAllByRole('listitem')
    expect(rows.map((r) => r.textContent)).toEqual(['Large70%', 'Middle20%', 'Small10%'])
  })

  /**
   * The arithmetic. Shares must sum to the full circumference — if they do not,
   * the ring has a gap or overlaps itself and no assertion about text would
   * ever say so.
   */
  test('the arcs fill the ring exactly: shares sum to one circumference', () => {
    render(
      <AccountDonut
        accounts={[
          account({ label: 'A', latest_value: 700 }),
          account({ label: 'B', latest_value: 200 }),
          account({ label: 'C', latest_value: 100 }),
        ]}
      />,
    )
    const arcs = segments().map((c) => ({
      dash: Number(c.getAttribute('stroke-dasharray')!.split(' ')[0]),
      start: -Number(c.getAttribute('stroke-dashoffset')),
    }))

    // Each arc begins where the previous one's full share ended.
    expect(arcs[0].start).toBeCloseTo(0, 5)
    expect(arcs[1].start).toBeCloseTo(C * 0.7, 5)
    expect(arcs[2].start).toBeCloseTo(C * 0.9, 5)

    // And each is its share long, less the separator it can afford.
    expect(arcs[0].dash).toBeCloseTo(C * 0.7 - 2, 5)
    expect(arcs[2].dash).toBeCloseTo(C * 0.1 - 2, 5)
  })

  test('a single account is a closed ring with no separator', () => {
    render(<AccountDonut accounts={[account({ label: 'Only', latest_value: 500 })]} />)
    const [arc] = segments()
    expect(Number(arc.getAttribute('stroke-dasharray')!.split(' ')[0])).toBeCloseTo(C, 5)
    // `toBeCloseTo`, not `toBe(-0)`: Object.is(-0, 0) is false and the
    // attribute serialises as "0".
    expect(Number(arc.getAttribute('stroke-dashoffset'))).toBeCloseTo(0, 5)
  })

  /**
   * A sliver keeps a visible arc rather than being consumed by its own gap —
   * the case that makes a naive `length - gap` render nothing at all.
   */
  test('a sliver stays drawn instead of being eaten by its separator', () => {
    render(
      <AccountDonut
        accounts={[
          account({ label: 'Nearly all', latest_value: 100000 }),
          account({ label: 'A rounding error', latest_value: 1 }),
        ]}
      />,
    )
    const dashes = segments().map((c) => Number(c.getAttribute('stroke-dasharray')!.split(' ')[0]))
    expect(dashes.every((d) => d > 0)).toBe(true)
    // And it is reported as a share rather than as 0%, which would read as absent.
    expect(within(legend()).getByText('<1%')).toBeTruthy()
  })

  /** THE assertion. An omission is stated, every time, in words. */
  test('says how many accounts it cannot show', () => {
    render(
      <AccountDonut
        accounts={[
          account({ label: 'Valued', latest_value: 500 }),
          account({ label: 'Not valued', latest_value: null }),
          account({ label: 'Also not', latest_value: null }),
        ]}
      />,
    )
    expect(screen.getByText('2 accounts with no recorded value are not shown.')).toBeTruthy()
    expect(segments()).toHaveLength(1)
  })

  test('one omission reads as singular', () => {
    render(
      <AccountDonut
        accounts={[account({ latest_value: 500 }), account({ latest_value: null })]}
      />,
    )
    expect(screen.getByText('1 account with no recorded value is not shown.')).toBeTruthy()
  })

  test('nothing is said when nothing is missing', () => {
    render(<AccountDonut accounts={[account({ latest_value: 500 })]} />)
    expect(screen.queryByText(/not shown/)).toBeNull()
  })

  /**
   * No ring rather than an empty one. A zero-valued account is a *valued*
   * account that cannot be drawn, and it is what would divide by zero.
   */
  test('accounts recorded at zero produce a sentence, not a ring', () => {
    render(
      <AccountDonut accounts={[account({ latest_value: 0 }), account({ latest_value: '0' })]} />,
    )
    expect(segments()).toHaveLength(0)
    expect(screen.getByText(/no value has been recorded against any of these accounts/i)).toBeTruthy()
  })

  test('no accounts at all says what will appear here', () => {
    render(<AccountDonut accounts={[]} />)
    expect(segments()).toHaveLength(0)
    expect(screen.getByText(/Once this group holds investment accounts/)).toBeTruthy()
  })

  test('the centre counts the accounts drawn, and never the money', () => {
    render(
      <AccountDonut
        accounts={[
          account({ latest_value: 486210 }),
          account({ latest_value: 212940 }),
          account({ latest_value: null }),
        ]}
      />,
    )
    const svg = document.querySelector('svg')!
    expect(within(svg as unknown as HTMLElement).getByText('2')).toBeTruthy()
    expect(within(svg as unknown as HTMLElement).getByText('accounts')).toBeTruthy()

    /* Scoped to the drawn <text>, not the whole <svg>: each segment's <title>
       legitimately carries its amount for the hover, so asserting on the svg's
       whole textContent would fail for the right reason in the wrong place —
       which it did on the first run. The claim is about what is PAINTED in the
       centre. */
    const painted = Array.from(svg.querySelectorAll('text')).map((t) => t.textContent).join('|')
    expect(painted).toBe('2|accounts')
    expect(painted).not.toContain('$')
    expect(painted).not.toContain('699,150')
  })

  test('one account drawn reads “account”, not “accounts”', () => {
    render(<AccountDonut accounts={[account({ latest_value: 5 })]} />)
    expect(within(document.querySelector('svg') as unknown as HTMLElement).getByText('account')).toBeTruthy()
  })

  /**
   * The legend carries shares. Amounts are in the row immediately to the left,
   * and a 200px column repeating them would say nothing new.
   */
  test('the legend shows shares, not amounts', () => {
    render(
      <AccountDonut
        accounts={[account({ label: 'Joint Super', latest_value: 750 }), account({ label: 'Portfolio', latest_value: 250 })]}
      />,
    )
    expect(legend().textContent).toBe('Joint Super75%Portfolio25%')
    expect(legend().textContent).not.toContain('$')
  })

  /**
   * More accounts than the ramp has steps: the tail is grouped rather than two
   * accounts sharing a colour, which would make the legend ambiguous.
   */
  test('beyond six accounts the tail is grouped, not recoloured', () => {
    render(
      <AccountDonut
        accounts={Array.from({ length: 9 }, (_, i) =>
          account({ label: `Account ${i}`, latest_value: 100 - i }),
        )}
      />,
    )
    expect(segments()).toHaveLength(6)
    const rows = within(legend()).getAllByRole('listitem')
    expect(rows).toHaveLength(6)
    expect(rows[5].textContent).toContain('4 smaller accounts')
  })

  test('every segment wears a distinct tone, so the legend can be trusted', () => {
    render(
      <AccountDonut
        accounts={Array.from({ length: 4 }, (_, i) => account({ label: `A${i}`, latest_value: 10 - i }))}
      />,
    )
    const tones = segments().map(
      (c) => Array.from(c.classList).find((k) => k.startsWith('text-violet-'))!,
    )
    expect(new Set(tones).size).toBe(tones.length)
    // Purple, as asked — and no colour that already means a state here.
    expect(tones.every((t) => t.startsWith('text-violet-'))).toBe(true)
  })

  /** Colour carries the mapping on screen, so the ring says itself in words. */
  test('the ring has a text equivalent naming every share', () => {
    render(
      <AccountDonut
        accounts={[account({ label: 'Joint Super', latest_value: 750 }), account({ label: 'Portfolio', latest_value: 250 })]}
      />,
    )
    const label = screen.getByRole('img').getAttribute('aria-label')!
    expect(label).toContain('Joint Super 75%')
    expect(label).toContain('Portfolio 25%')
    expect(label).toContain('$1,000.00')
  })

  test('a swatch is decorative and adds no text of its own', () => {
    render(<AccountDonut accounts={[account({ label: 'Only', latest_value: 5 })]} />)
    const row = within(legend()).getAllByRole('listitem')[0]
    expect(row.firstElementChild!.getAttribute('aria-hidden')).toBe('true')
    expect(row.firstElementChild!.textContent).toBe('')
  })
})
