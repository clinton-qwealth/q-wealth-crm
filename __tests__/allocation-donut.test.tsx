import { describe, expect, test } from 'vitest'
import { render } from '@testing-library/react'
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
   * Renders nothing rather than an empty circle. No allocation at all is the
   * bars' ghost to draw, and this component must not put a second empty state
   * above it.
   */
  test('draws nothing at all when there is no allocation', () => {
    const { container } = render(<AllocationDonut rows={[]} />)
    expect(container.innerHTML).toBe('')
    expect(render(<AllocationDonut rows={null} />).container.innerHTML).toBe('')
  })

  test('and nothing when every class is below zero', () => {
    const { container } = render(<AllocationDonut rows={[w('other', -0.1)]} />)
    expect(container.innerHTML).toBe('')
  })
})
