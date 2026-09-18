import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { act, fireEvent, render } from '@testing-library/react'
import { ValueBars } from '@/components/value-bars'

/**
 * The account value chart, as rendered.
 *
 * The arithmetic is in `value-series.test.ts`. What is checked here is what
 * Recharts and this component do with it — and above all **that the axis
 * starts at zero**, because a truncated bar axis is the misleading chart this
 * project has refused twice already in other forms.
 *
 * Recharts draws SVG, which is why any of this is visible to jsdom.
 * `ResponsiveContainer` is deliberately not used: it measures its parent and
 * renders nothing here.
 */
const at = (as_at: string, value: string | number) => ({ as_at, value })

const week = [
  at('2026-09-14', 100),
  at('2026-09-15', 120),
  at('2026-09-16', 110),
  at('2026-09-17', 140),
]

const bars = (c: HTMLElement) => Array.from(c.querySelectorAll('.recharts-bar-rectangle path'))

describe('the value chart', () => {
  test('draws one bar per day that has a valuation', () => {
    const { container } = render(<ValueBars rows={week} />)
    expect(bars(container)).toHaveLength(4)
  })

  /**
   * The gap is the point. Friday and Monday must not be drawn adjacent, so the
   * weekend occupies its own width with nothing in it.
   */
  test('and leaves a gap where a day has none', () => {
    const { container } = render(
      <ValueBars rows={[at('2026-09-14', 100), at('2026-09-17', 130)]} />,
    )
    /* Four days in the window, two of them empty: Recharts draws a rectangle
       only where there is a value. */
    expect(bars(container)).toHaveLength(2)
    expect(container.querySelectorAll('.recharts-cartesian-axis-tick')).not.toHaveLength(0)
  })

  /**
   * THE ONE THAT MATTERS. A bar's length is a quantity measured from nothing.
   * Cropping the axis to 100–140 would make a 40% rise look like a tenfold one.
   */
  test('measures from zero, not from the lowest value', () => {
    const { container } = render(<ValueBars rows={week} />)
    const heights = bars(container).map((b) => {
      const d = b.getAttribute('d') ?? ''
      const ys = [...d.matchAll(/[ML]\s*[\d.]+\s*,?\s*([\d.]+)/g)].map((m) => Number(m[1]))
      return Math.max(...ys) - Math.min(...ys)
    })
    /* 100 and 140 are the extremes. From zero their bars are in a 100:140
       ratio; from a cropped floor the shorter one would collapse toward zero. */
    const ratio = Math.min(...heights) / Math.max(...heights)
    expect(ratio).toBeGreaterThan(0.6)
    expect(ratio).toBeLessThan(0.8)
  })

  /* An account may be below zero since 17 September. The bar goes under the
     rule and takes the neutral, never colour alone. */
  test('a day below zero is drawn in the neutral and marked as negative', () => {
    const { container } = render(
      <ValueBars rows={[at('2026-09-16', 100), at('2026-09-17', -50)]} />,
    )
    const cells = Array.from(container.querySelectorAll('[data-side]'))
    expect(cells.map((c) => c.getAttribute('data-side'))).toEqual(['positive', 'negative'])
    /* The TONE, not just the marker. `data-side` alone passed while both bars
       were painted the chart ink — the mutation that proved this assertion was
       missing. The ramp's darkest step for a positive day, the neutral for one
       below zero, so the difference survives greyscale. The second day here is
       also the LATEST, and the sign wins: a latest day below zero is grey, not
       orange — its position already says it is the latest. */
    const fills = cells.map((c) => c.getAttribute('fill'))
    expect(fills[0]).toBe('var(--mix-5)')
    expect(fills[1]).toBe('#737373')
    expect(fills[0]).not.toBe(fills[1])
  })

  /**
   * ONE emphasised endpoint, since 18 September. The history is the ramp's
   * darkest step and the latest day is brand orange — the figure the trend
   * arrow above describes and the last thing the eye should land on. Thirty
   * orange bars would have shouted and said nothing.
   */
  test('draws the history dark and the latest day in brand orange', () => {
    const { container } = render(<ValueBars rows={week} />)
    const cells = Array.from(container.querySelectorAll('[data-side]'))
    const fills = cells.map((c) => c.getAttribute('fill'))
    expect(fills.slice(0, -1).every((f) => f === 'var(--mix-5)')).toBe(true)
    expect(fills.at(-1)).toBe('var(--mix-1)')
    /* And it is marked, so nothing has to infer "last" from position. */
    expect(cells.at(-1)!.getAttribute('data-latest')).toBe('true')
    expect(cells.slice(0, -1).some((c) => c.hasAttribute('data-latest'))).toBe(false)
  })

  /* There is deliberately NO test that the latest is "the last recorded day
     rather than the last calendar day": `valueSeries` bounds the calendar to
     end on the last recorded day, so the two cannot differ and a mutation
     swapping one for the other survived. A test that cannot fail is not a
     guard; the guarantee lives in `value-series.test.ts`. */

  /**
   * The box is the viewBox's own ratio. A 2:1 chart in a fixed-height box
   * letterboxes as soon as its column is narrower than the chart is wide —
   * which is exactly the half-width column it sits in from 18 September.
   */
  test('draws in a box of the viewBox’s own ratio, so nothing letterboxes', () => {
    const { container } = render(<ValueBars rows={week} />)
    const box = container.querySelector('[data-slot="value-chart"]')!
    expect(box.className).toContain('aspect-[2/1]')
    const svg = box.querySelector('svg')!
    const [, , w, h] = (svg.getAttribute('viewBox') ?? '').split(/\s+/).map(Number)
    expect(w / h).toBe(2)
  })

  test('and the zero rule is drawn only when something is below it', () => {
    const { container: withNeg } = render(
      <ValueBars rows={[at('2026-09-16', 100), at('2026-09-17', -50)]} />,
    )
    expect(withNeg.querySelector('.recharts-reference-line')).toBeTruthy()

    const { container: allPos } = render(<ValueBars rows={week} />)
    expect(allPos.querySelector('.recharts-reference-line')).toBeNull()
  })

  /**
   * The ends AND the extremes, on a window where they differ — 120 to 110,
   * low 100, high 140. The first fixture ran 100 up to 140, so its ends were
   * its extremes and the sentence could have dropped either pair and still
   * passed. A mutation removing the ends proved that, and this is the fix.
   */
  test('says itself in words, with the ends and the extremes', () => {
    const { container } = render(
      <ValueBars
        rows={[
          at('2026-09-14', 120),
          at('2026-09-15', 100),
          at('2026-09-16', 140),
          at('2026-09-17', 110),
        ]}
      />,
    )
    const label = container.querySelector('[role="img"]')!.getAttribute('aria-label')!
    expect(label).toContain('from $120.00 on 14 Sep')
    expect(label).toContain('to $110.00 on 17 Sep')
    expect(label).toContain('low $100.00, high $140.00')
  })

  test('labels at most three days on the axis', () => {
    const rows = Array.from({ length: 30 }, (_, i) =>
      at(`2026-09-${String(i + 1).padStart(2, '0')}`, 100 + i),
    )
    const { container } = render(<ValueBars rows={rows} />)
    expect(container.querySelectorAll('.recharts-cartesian-axis-tick')).toHaveLength(3)
  })

  /* Built and empty, so solid grey — not dashed, which would mean unbuilt, and
     not pulsing, which would promise something is arriving. */
  test('an account with no valuations shows a solid ghost and says why', () => {
    const { container } = render(<ValueBars rows={[]} />)
    const ghost = container.querySelector('[data-slot="value-ghost"]')!
    expect(ghost).toBeTruthy()
    /* The WHOLE subtree, not the wrapper's own class — a dashed border added
       to the bars inside slipped past the first version of this line. Dashed
       means unbuilt and pulsing means arriving; this is built and empty. */
    expect(ghost.outerHTML).not.toContain('dashed')
    expect(ghost.outerHTML).not.toContain('animate-pulse')
    expect(container.textContent).toContain('nothing to chart')
    expect(bars(container)).toHaveLength(0)
  })

  /* Two of the five production accounts have exactly one valuation today,
     because neither feed has run on its schedule yet. A lone bar with no note
     reads as a broken chart. */
  test('a single valuation draws its bar and explains itself', () => {
    const { container } = render(<ValueBars rows={[at('2026-09-16', 500)]} />)
    expect(bars(container)).toHaveLength(1)
    expect(container.querySelector('[data-slot="series-note"]')!.textContent).toContain(
      'One valuation recorded',
    )
  })

  test('and a window with holes counts them beneath', () => {
    const { container } = render(
      <ValueBars rows={[at('2026-09-14', 100), at('2026-09-17', 130)]} />,
    )
    expect(container.querySelector('[data-slot="series-note"]')!.textContent).toBe(
      '2 valuations over 4 days; 2 days have none.',
    )
  })
})

/**
 * The hover, asked for on 18 September.
 *
 * ## How jsdom is made to drive it
 *
 * Recharts places the pointer by measuring the chart's box, and jsdom measures
 * every box as zero, so a mouse move lands nowhere. Stubbing the measurement to
 * the chart's own logical size makes `clientX` the chart x, and from there the
 * library's arithmetic is the real thing. The handler is throttled on a timer,
 * so each move is followed by a tick before reading the tree — without it the
 * first version of this probe read "nothing happened" three times.
 *
 * The stub is put back after every test: it is `Element.prototype`, and a
 * measurement that lies to the next file is how a suite goes flaky.
 */
describe('the value chart’s hover', () => {
  const real = Element.prototype.getBoundingClientRect
  beforeEach(() => {
    const rect = { x: 0, y: 0, left: 0, top: 0, right: 320, bottom: 160, width: 320, height: 160, toJSON() {} }
    Element.prototype.getBoundingClientRect = () => rect as DOMRect
  })
  afterEach(() => {
    Element.prototype.getBoundingClientRect = real
  })

  const gapped = [at('2026-09-14', 100), at('2026-09-15', 120), at('2026-09-17', 140)]
  const tick = () => new Promise((r) => setTimeout(r, 60))
  const point = async (c: HTMLElement, x: number) => {
    await act(async () => {
      fireEvent.mouseMove(c.querySelector('.recharts-wrapper')!, { clientX: x, clientY: 80 })
      await tick()
    })
  }
  const tip = (c: HTMLElement) => c.querySelector('[data-slot="value-tip"]')

  test('pointing at a day marks its bar as the active one, for the stylesheet', async () => {
    const { container } = render(<ValueBars rows={gapped} />)
    await point(container, 40)
    const active = container.querySelectorAll('.recharts-active-bar path')
    expect(active).toHaveLength(1)
    expect(active[0].getAttribute('data-day')).toBe('2026-09-14')
    await point(container, 300)
    expect(container.querySelector('.recharts-active-bar path')!.getAttribute('data-day')).toBe('2026-09-17')
  })

  test('and prints the date and the figure on a sheet', async () => {
    const { container } = render(<ValueBars rows={gapped} />)
    await point(container, 300)
    expect(tip(container)!.textContent).toBe('17 Sep$140.00')
  })

  /**
   * A gap day is a real category — the calendar is filled so weekends keep
   * their width — and pointing at it must say the gap is a gap. This is the one
   * place the chart can state that, and "nothing appears" would read as the
   * hover being broken rather than the feed having skipped a day.
   */
  test('and on a day with no valuation says so, with no bar to mark', async () => {
    const { container } = render(<ValueBars rows={gapped} />)
    await point(container, 200)
    expect(tip(container)!.textContent).toBe('16 SepNo valuation recorded')
    expect(container.querySelectorAll('.recharts-active-bar')).toHaveLength(0)
  })

  /* The column behind the day, so a two-pixel bar is as easy to land on as
     the tallest. Drawn for a gap day too — that is what makes it reachable. */
  test('draws a column behind the pointed-at day, valuation or not', async () => {
    const { container } = render(<ValueBars rows={gapped} />)
    await point(container, 200)
    expect(container.querySelectorAll('.recharts-tooltip-cursor')).toHaveLength(1)
  })

  test('and clears everything as the pointer leaves', async () => {
    const { container } = render(<ValueBars rows={gapped} />)
    await point(container, 40)
    expect(tip(container)).toBeTruthy()
    await act(async () => {
      fireEvent.mouseLeave(container.querySelector('.recharts-wrapper')!)
      await tick()
    })
    expect(tip(container)).toBeNull()
    expect(container.querySelectorAll('.recharts-active-bar')).toHaveLength(0)
  })

  /**
   * The OTHER bars keep their nodes across a hover, so the recede transition in
   * the stylesheet has something to run on. The hovered bar does not: Recharts
   * re-renders it as its active layer, which is a new node — and that is the
   * right way round, because the active bar should arrive at full opacity at
   * once rather than fade up. The first version of this test claimed all three
   * survived, and the library corrected it.
   */
  test('the bars not under the pointer survive the hover as the same nodes', async () => {
    const { container } = render(<ValueBars rows={gapped} />)
    const before = new Map(
      Array.from(container.querySelectorAll('.recharts-bar-rectangle path')).map((n) => [n.getAttribute('data-day'), n]),
    )
    await point(container, 300) // the 17th
    const after = Array.from(container.querySelectorAll('.recharts-bar-rectangle path'))
    expect(after.map((n) => n.getAttribute('data-day'))).toEqual(['2026-09-14', '2026-09-15'])
    for (const n of after) expect(n).toBe(before.get(n.getAttribute('data-day')))
    expect(container.querySelector('.recharts-active-bar path')!.getAttribute('data-day')).toBe('2026-09-17')
  })
})
