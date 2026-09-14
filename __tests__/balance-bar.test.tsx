import { describe, expect, test } from 'vitest'
import { render } from '@testing-library/react'
import { BalanceBar } from '@/components/balance-bar'
import type { BalanceTotals } from '@/lib/balance-sheet'

/**
 * The assets-versus-liabilities bar, asked for on 14 September.
 *
 * What is worth pinning is that the picture and the words agree, and that
 * neither can say something the figures do not.
 */
const totals = (assets: number, liabilities: number): BalanceTotals => ({
  assets,
  liabilities,
  net: assets - liabilities,
  closed: 0,
})

const bar = (container: HTMLElement) => ({
  assets: container.querySelector('[data-slot="bar-assets"]') as HTMLElement | null,
  liabilities: container.querySelector('[data-slot="bar-liabilities"]') as HTMLElement | null,
  picture: container.querySelector('[role="img"]') as HTMLElement | null,
})

describe('the balance bar', () => {
  test('draws each side in proportion to the two added together', () => {
    const { container } = render(<BalanceBar totals={totals(750_000, 250_000)} />)
    const { assets, liabilities } = bar(container)
    expect(assets!.style.flexBasis).toBe('75%')
    expect(liabilities!.style.flexBasis).toBe('25%')
  })

  /* Blue owned, red owed — asked for by name. Pinned because a swap would be
     invisible to every other assertion here and is the worst possible error
     this component could make. */
  test('blue is what is owned and red is what is owed', () => {
    const { container } = render(<BalanceBar totals={totals(750_000, 250_000)} />)
    const { assets, liabilities } = bar(container)
    expect(assets!.className).toContain('bg-blue-600')
    expect(assets!.className).not.toContain('red')
    expect(liabilities!.className).toContain('bg-red-600')
    expect(liabilities!.className).not.toContain('blue')
  })

  /**
   * **The join is drawn, not implied.** Blue-600 and red-600 measure 1.07:1
   * against each other — in greyscale, or to a viewer with no colour vision,
   * the bar would be one solid block. The white border sits inside the
   * segment's own box, so it marks the boundary without taking a pixel off
   * either proportion.
   */
  test('the two segments are separated by a drawn edge, not only by hue', () => {
    const { container } = render(<BalanceBar totals={totals(750_000, 250_000)} />)
    const { liabilities } = bar(container)
    expect(liabilities!.className).toContain('border-l-2')
    expect(liabilities!.className).toContain('border-white')
  })

  /**
   * The percentages are printed, so colour is never the only thing carrying
   * the reading (WCAG 1.4.1) — and they are the numbers the bar is drawing.
   */
  test('prints both percentages, and names both sides', () => {
    const { container } = render(<BalanceBar totals={totals(750_000, 250_000)} />)
    expect(container.textContent).toContain('Assets')
    expect(container.textContent).toContain('75%')
    expect(container.textContent).toContain('Liabilities')
    expect(container.textContent).toContain('25%')
  })

  /** A screen reader gets the figures, not just "a chart" — the same treatment
   *  the investment ring takes. */
  test('the picture carries both figures for a screen reader', () => {
    const { container } = render(<BalanceBar totals={totals(750_000, 250_000)} />)
    const label = bar(container).picture!.getAttribute('aria-label')!
    expect(label).toContain('$750,000.00')
    expect(label).toContain('$250,000.00')
    expect(label).toContain('75%')
    expect(label).toContain('25%')
  })

  /**
   * **A group that owes nothing gets no red at all.** A minimum width applied
   * to a zero side would put six pixels of debt on a sheet that has none,
   * which is the one thing this bar must never say.
   */
  test('a side with nothing in it is not drawn', () => {
    const { container } = render(<BalanceBar totals={totals(500_000, 0)} />)
    const { assets, liabilities } = bar(container)
    expect(assets).toBeTruthy()
    expect(liabilities, 'a group with no debts has a red segment').toBeNull()
    expect(container.textContent).toContain('0%')
  })

  /* But a side that exists and is tiny IS drawn, with a floor under its width,
     rather than rounded out of sight. */
  test('a very small debt is still visible, and still labelled honestly', () => {
    const { container } = render(<BalanceBar totals={totals(1_000_000, 1_000)} />)
    const { liabilities } = bar(container)
    expect(liabilities).toBeTruthy()
    expect(liabilities!.className).toContain('min-w-')
    expect(container.textContent).toContain('<1%')
  })

  /** Nothing to divide is no bar: one colour, or none, says less than the
   *  space it would take. */
  test('an empty balance sheet renders nothing at all', () => {
    const { container } = render(<BalanceBar totals={totals(0, 0)} />)
    expect(container.innerHTML).toBe('')
  })

  /* Thick, asked for by name. The height is the one dimension a reader
     specified, so a change to it should be deliberate. */
  test('the bar is thick', () => {
    const { container } = render(<BalanceBar totals={totals(750_000, 250_000)} />)
    expect(bar(container).picture!.className).toContain('h-7')
  })
})
