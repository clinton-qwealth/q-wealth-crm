import { describe, expect, test } from 'vitest'
import { fireEvent, render } from '@testing-library/react'
import { AllocationDonut } from '@/components/allocation-donut'

/**
 * The allocation ring that sits above the bars.
 *
 * The arithmetic is `allocation.test.ts`, shared with the bars. What is checked
 * here is the division of labour the two agreed on: the ring draws the positive
 * classes for shape, the bars beneath draw everything including the negative
 * one, and the ring **says what it left out** rather than presenting a circle
 * that looks like the whole account.
 */
const w = (asset_class: string, weight: number) => ({ asset_class, weight })

const mixed = [
  w('australian_shares', 0.4),
  w('international_shares', 0.3),
  w('australian_fixed_interest', 0.2),
  w('cash', 0.1228),
  w('other', -0.0228),
]

const arcs = (c: HTMLElement) => Array.from(c.querySelectorAll('.recharts-pie-sector path'))

describe('the allocation ring', () => {
  test('draws one arc per positive class', () => {
    const { container } = render(<AllocationDonut rows={mixed} />)
    expect(arcs(container)).toHaveLength(4)
  })

  /** A pie cannot draw a negative share. The bars beneath can and do. */
  test('leaves a negative class out of the ring', () => {
    const { container } = render(<AllocationDonut rows={mixed} />)
    const classes = Array.from(container.querySelectorAll('[data-class]')).map((c) =>
      c.getAttribute('data-class'),
    )
    expect(classes).not.toContain('other')
    expect(classes).toEqual([
      'australian_shares',
      'international_shares',
      'australian_fixed_interest',
      'cash',
    ])
  })

  test('and names it beneath, with its figure and its sign', () => {
    const { container } = render(<AllocationDonut rows={mixed} />)
    const note = container.querySelector('[data-slot="donut-omitted"]')!
    expect(note.textContent).toBe('Other is −2.3% and is not in the ring.')
  })

  test('says nothing about omissions when there are none', () => {
    const { container } = render(
      <AllocationDonut rows={[w('cash', 0.5), w('australian_shares', 0.5)]} />,
    )
    expect(container.querySelector('[data-slot="donut-omitted"]')).toBeNull()
  })

  test('and pluralises when it left out more than one', () => {
    const { container } = render(
      <AllocationDonut rows={[w('cash', 1.1), w('other', -0.05), w('direct_property', -0.05)]} />,
    )
    expect(container.querySelector('[data-slot="donut-omitted"]')!.textContent).toContain(
      'are not in the ring',
    )
  })

  /**
   * The ring and the bars are one picture split in two, so a class must not
   * change colour between them. Both read the same four family tokens.
   */
  test('colours by family, from the tokens the bars use', () => {
    const { container } = render(
      <AllocationDonut
        rows={[
          w('australian_shares', 0.25),
          w('australian_fixed_interest', 0.25),
          w('listed_property', 0.25),
          w('cash', 0.25),
        ]}
      />,
    )
    const fills = Array.from(container.querySelectorAll('[data-class]')).map((c) =>
      c.getAttribute('fill'),
    )
    expect(fills).toEqual([
      'var(--mix-1)',
      'var(--mix-2)',
      'var(--mix-3)',
      'var(--mix-4)',
    ])
  })

  /* Two classes of one family share its ink — that is the point of colouring
     by family rather than by class, and the label carries the class. */
  test('and two classes of one family share an ink', () => {
    const { container } = render(
      <AllocationDonut rows={[w('australian_shares', 0.5), w('international_shares', 0.5)]} />,
    )
    const fills = Array.from(container.querySelectorAll('[data-class]')).map((c) =>
      c.getAttribute('fill'),
    )
    expect(fills).toEqual(['var(--mix-1)', 'var(--mix-1)'])
  })

  test('says itself in words', () => {
    const { container } = render(<AllocationDonut rows={mixed} />)
    const label = container.querySelector('[role="img"]')!.getAttribute('aria-label')!
    expect(label).toContain('Australian shares 40.0%')
    expect(label).toContain('Cash 12.3%')
  })

  /**
   * The ghost ring, since 18 September — the group page's empty state, and the
   * ONE empty state for the allocation: the panel omits the class bars when
   * there is nothing to list, so this is where the absence is explained.
   * Solid grey, not dashed and not pulsing, per the three-way rule on
   * `account-donut`.
   */
  test('draws the ghost ring when there is no allocation, and says which kind of nothing', () => {
    const { container } = render(<AllocationDonut rows={[]} hasProvider />)
    expect(container.querySelector('[data-slot="alloc-ghost-ring"]')).toBeTruthy()
    expect(arcs(container)).toHaveLength(0)
    expect(container.querySelector('[data-slot="alloc-ring-empty"]')!.textContent).toContain(
      'No allocation has been reported',
    )
    for (const suspect of ['border-dashed', 'animate-pulse']) {
      expect(container.innerHTML).not.toContain(suspect)
    }
  })

  test('and says so differently when no provider is on file at all', () => {
    const { container } = render(<AllocationDonut rows={null} hasProvider={false} />)
    expect(container.querySelector('[data-slot="alloc-ring-empty"]')!.textContent).toContain(
      'recorded by hand',
    )
  })

  /* Something WAS reported, and all of it subtracts. "Not reported" would be
     false, and a ring cannot draw it. */
  test('and when every class is below zero, says that rather than "not reported"', () => {
    const { container } = render(<AllocationDonut rows={[w('other', -0.1)]} />)
    expect(container.querySelector('[data-slot="alloc-ghost-ring"]')).toBeTruthy()
    expect(container.querySelector('[data-slot="alloc-ring-empty"]')!.textContent).toContain(
      'below zero',
    )
  })

  /**
   * The ghost is drawn from the ring's own two radii, so the two cannot drift:
   * its stroke's centre line is the band's centre, its width the band's width.
   */
  test('the ghost is the ring’s own silhouette', () => {
    const { container } = render(<AllocationDonut rows={[]} />)
    const circle = container.querySelector('[data-slot="alloc-ghost-ring"]')!
    /* 0.6 and 0.94 of half of 240: centre at 92.4, width 40.8. */
    expect(Number(circle.getAttribute('r'))).toBeCloseTo(92.4, 3)
    expect(Number(circle.getAttribute('stroke-width'))).toBeCloseTo(40.8, 3)
  })
})

/**
 * The legend is by FAMILY, and that is the whole reason it exists: the class
 * rows beneath the ring already name every class and print its weight, so a
 * class legend here would say it all twice. What nothing else says is what the
 * colours mean — that three orange arcs are all shares.
 */
describe('the family legend', () => {
  test('sums each family’s positive weight, in ramp order', () => {
    const { container } = render(<AllocationDonut rows={mixed} />)
    const rows = Array.from(container.querySelectorAll('[data-slot="alloc-legend"] li'))
    expect(rows.map((r) => r.getAttribute('data-family'))).toEqual(['shares', 'fixed_interest', 'cash'])
    /* 0.4 + 0.3 = 70.0% — the sum the class rows make you do in your head. */
    expect(rows[0].textContent).toBe('Shares70.0%')
    expect(rows[1].textContent).toBe('Fixed interest20.0%')
    /* The negative `other` is NOT in the cash family's sum: the legend describes
       the ring, and the ring did not draw it. */
    expect(rows[2].textContent).toBe('Cash12.3%')
  })

  test('names "other" when it is positive and in the cash family’s sum', () => {
    const { container } = render(<AllocationDonut rows={[w('cash', 0.5), w('other', 0.5)]} />)
    const rows = Array.from(container.querySelectorAll('[data-slot="alloc-legend"] li'))
    expect(rows.map((r) => r.textContent)).toEqual(['Cash and other100.0%'])
  })

  test('each swatch takes its family’s ink', () => {
    const { container } = render(<AllocationDonut rows={mixed} />)
    const swatches = Array.from(container.querySelectorAll('[data-slot="alloc-legend"] li > span[aria-hidden]'))
    expect(swatches.map((s) => (s as HTMLElement).style.background)).toEqual([
      'var(--mix-1)',
      'var(--mix-2)',
      'var(--mix-4)',
    ])
  })
})

/**
 * The hover's half that this component owns: reporting which class the
 * pointer is on. The other half — the panel's `data-active` and the arc that
 * pops — is `account-drawer.test.tsx`'s and the stylesheet's.
 */
describe('the ring’s hover', () => {
  test('reports the class under the pointer by KEY, and null as it leaves', () => {
    const seen: (string | null)[] = []
    const { container } = render(<AllocationDonut rows={mixed} onActivate={(k) => seen.push(k)} />)
    const sectors = arcs(container)
    /* Recharts attaches the Pie's handlers to each sector. */
    fireEvent.mouseEnter(sectors[3])
    fireEvent.mouseLeave(sectors[3])
    expect(seen).toEqual(['cash', null])
  })

  test('marks every arc with its class for the stylesheet', () => {
    const { container } = render(<AllocationDonut rows={mixed} />)
    const marked = Array.from(container.querySelectorAll('[data-slot="alloc-segment"]'))
    expect(marked).toHaveLength(4)
    expect(marked.every((m) => m.hasAttribute('data-class'))).toBe(true)
  })
})
