import { render, screen } from '@testing-library/react'
import { describe, expect, test } from 'vitest'
import { AllocationBars } from '@/components/allocation-bars'

/**
 * The allocation picture.
 *
 * `allocation.test.ts` proves the arithmetic; this proves the arithmetic
 * actually reaches the DOM, which is the other half and the half that has
 * historically gone wrong — a correct number written to the wrong attribute
 * looks fine in a unit test and wrong on a screen.
 *
 * jsdom has no layout engine, so nothing here measures a bar. What it can read
 * is the inline style the component wrote, which is exactly what the browser
 * would lay out, and `balance-bar.test.tsx` works within the same limit.
 */

/** HUB24 account 24033810 as it landed on 15 September, negative `other`. */
const REAL = [
  { asset_class: 'australian_shares', weight: '0.245600' },
  { asset_class: 'international_shares', weight: '0.492800' },
  { asset_class: 'australian_fixed_interest', weight: '0.142500' },
  { asset_class: 'international_fixed_interest', weight: '0.045100' },
  { asset_class: 'cash', weight: '0.096800' },
  { asset_class: 'other', weight: '-0.022800' },
]

const rowFor = (container: HTMLElement, cls: string) =>
  container.querySelector<HTMLElement>(`[data-slot="alloc-row"][data-class="${cls}"]`)!

describe('the allocation bars', () => {
  test('draw one row per reported class, named in words', () => {
    const { container } = render(<AllocationBars rows={REAL} hasProvider />)
    expect(container.querySelectorAll('[data-slot="alloc-row"]')).toHaveLength(6)
    /* `direct_property` → "Direct property" is the pair whose label differs
       from its key, so this fails if the label map is dropped and the raw key
       printed. */
    const { container: c2 } = render(
      <AllocationBars rows={[{ asset_class: 'direct_property', weight: 1 }]} hasProvider />,
    )
    expect(c2.textContent).toContain('Direct property')
    expect(c2.textContent).not.toContain('direct_property')
  })

  test('put the computed geometry into the inline style', () => {
    const { container } = render(<AllocationBars rows={REAL} hasProvider />)
    const bar = rowFor(container, 'international_shares').querySelector<HTMLElement>(
      '[data-slot="alloc-bar"]',
    )!
    // zero sits at 0.0228 / 0.5156 of the track; the bar runs from there.
    expect(parseFloat(bar.style.left)).toBeCloseTo((0.0228 / 0.5156) * 100, 2)
    expect(parseFloat(bar.style.width)).toBeCloseTo((0.4928 / 0.5156) * 100, 2)
  })

  /**
   * The single most dishonest thing this component could do is draw a short
   * position as a holding.
   */
  test('draw a negative bar on the far side of the zero rule', () => {
    const { container } = render(<AllocationBars rows={REAL} hasProvider />)
    const row = rowFor(container, 'other')
    const bar = row.querySelector<HTMLElement>('[data-slot="alloc-bar"]')!
    expect(bar.dataset.side).toBe('negative')

    const zero = container.querySelector<HTMLElement>('[data-slot="alloc-zero"]')!
    const zeroPct = parseFloat(zero.style.left)
    const end = parseFloat(bar.style.left) + parseFloat(bar.style.width)
    expect(end).toBeCloseTo(zeroPct, 2)
    expect(parseFloat(bar.style.left)).toBeLessThan(zeroPct)
  })

  test('and print it with a real minus sign', () => {
    render(<AllocationBars rows={REAL} hasProvider />)
    expect(screen.getByText('−2.3%')).toBeTruthy()
  })

  test('draw no zero rule when nothing is negative', () => {
    const { container } = render(
      <AllocationBars rows={[{ asset_class: 'cash', weight: 1 }]} hasProvider />,
    )
    expect(container.querySelector('[data-slot="alloc-zero"]')).toBeNull()
  })

  /* Colour and length are screen-only; this is the rest of the picture. */
  test('carry every class and figure in one text equivalent, negatives included', () => {
    render(<AllocationBars rows={REAL} hasProvider />)
    const label = screen.getByRole('img').getAttribute('aria-label')!
    expect(label).toContain('Australian shares 24.6%')
    expect(label).toContain('Other −2.3%')
  })

  test('say so when the classes do not total one, and change nothing else', () => {
    const { container } = render(
      <AllocationBars
        rows={[
          { asset_class: 'australian_shares', weight: 0.5 },
          { asset_class: 'cash', weight: 0.477 },
        ]}
        hasProvider
      />,
    )
    expect(container.querySelector('[data-slot="alloc-note"]')!.textContent).toBe(
      'Classes total 97.7%, as reported',
    )
    expect(screen.getByText('50.0%')).toBeTruthy()
  })

  test('and say nothing when they do', () => {
    const { container } = render(<AllocationBars rows={REAL} hasProvider />)
    expect(container.querySelector('[data-slot="alloc-note"]')).toBeNull()
  })

  /**
   * The date is the allocation's own, not the account's snapshot date. The
   * promotion refreshes cash every run but skips the allocation when the
   * weights fail its checks, so the two legitimately disagree.
   */
  test('date the picture from what it was given', () => {
    render(<AllocationBars rows={REAL} asAt="2026-09-14" hasProvider />)
    expect(screen.getByText('As reported on 2026-09-14')).toBeTruthy()
  })

  describe('with nothing reported', () => {
    /* Built and empty is SOLID GREY. Dashed would claim unbuilt and pulsing
       would claim arriving — the two confusions account-donut.tsx documents. */
    test('show a solid grey shape, neither dashed nor pulsing', () => {
      const { container } = render(<AllocationBars rows={[]} hasProvider />)
      const ghost = container.querySelector<HTMLElement>('[data-slot="alloc-ghost"]')!
      expect(ghost).toBeTruthy()
      expect(ghost.innerHTML).not.toContain('border-dashed')
      expect(ghost.innerHTML).not.toContain('animate-pulse')
      expect(container.querySelector('[data-slot="alloc-row"]')).toBeNull()
    })

    test('and say which kind of empty it is', () => {
      render(<AllocationBars rows={null} hasProvider />)
      expect(screen.getByText(/No allocation has been reported/)).toBeTruthy()

      render(<AllocationBars rows={null} hasProvider={false} />)
      expect(screen.getByText(/recorded by hand/)).toBeTruthy()
    })
  })
})
