import { describe, expect, test } from 'vitest'
import { render } from '@testing-library/react'
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
       missing. Indigo for a positive day, the neutral for one below zero, so
       the difference survives greyscale. */
    const fills = cells.map((c) => c.getAttribute('fill'))
    expect(fills[0]).toBe('var(--mix-1)')
    expect(fills[1]).toBe('#525252')
    expect(fills[0]).not.toBe(fills[1])
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
