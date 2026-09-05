import { describe, expect, test } from 'vitest'
import { render, screen } from '@testing-library/react'
import { AccountValue } from '@/components/ui'

/**
 * The trend mark makes a claim about an account's direction, so the cases that
 * matter are the ones where it should stay silent as much as the ones where it
 * should speak.
 */
describe('AccountValue', () => {
  test('a value above its 30-day average is marked as increasing', () => {
    const { container } = render(
      <AccountValue
        value="284350.75"
        changeAmount="4990.18"
        changePct="1.79"
        baselineValue="279360.57"
        baselinePoints={30}
      />,
    )

    expect(screen.getByText(/284,350\.75/)).toBeDefined()
    expect(screen.getByText('increasing')).toBeDefined()
    expect(container.querySelector('.bg-emerald-50')).not.toBeNull()
    expect(container.querySelector('.bg-red-50')).toBeNull()
  })

  test('a value below its 30-day average is marked as decreasing', () => {
    const { container } = render(
      <AccountValue
        value="112900.00"
        changeAmount="-4170.00"
        changePct="-3.56"
        baselineValue="117070.00"
        baselinePoints={30}
      />,
    )

    expect(screen.getByText('decreasing')).toBeDefined()
    expect(container.querySelector('.bg-red-50')).not.toBeNull()
    expect(container.querySelector('.bg-emerald-50')).toBeNull()
  })

  test('the hover detail names the baseline the arrow was judged against', () => {
    render(
      <AccountValue
        value="284350.75"
        changeAmount="4990.18"
        changePct="1.79"
        baselineValue="279360.57"
        baselinePoints={30}
      />,
    )

    const detail = screen.getByTitle(/30-day average/)
    expect(detail.title).toContain('Up')
    expect(detail.title).toContain('1.79%')
    expect(detail.title).toContain('from 30 valuations')
  })

  /* A single valuation is not a trend. Drawing an arrow here would assert a
     direction the data does not show. */
  test('an account with no baseline gets no arrow', () => {
    const { container } = render(<AccountValue value="100000.00" baselinePoints={0} />)

    expect(screen.getByText(/100,000\.00/)).toBeDefined()
    expect(screen.queryByText('increasing')).toBeNull()
    expect(screen.queryByText('decreasing')).toBeNull()
    expect(container.querySelector('.rounded-full')).toBeNull()
  })

  /* ...but it still reserves the badge's width, so amounts share a right edge
     down the column whether or not a direction can be shown. */
  test('the arrowless case still holds the badge width open', () => {
    const { container } = render(<AccountValue value="100000.00" baselinePoints={0} />)

    const spacer = container.querySelector('[aria-hidden="true"]')
    expect(spacer).not.toBeNull()
    expect(spacer?.className).toContain('size-[18px]')
  })

  /**
   * This used to assert that an unvalued account rendered NOTHING, and that was
   * changed deliberately on 5 Sep 2026: a blank right-hand side reads as a
   * rendering fault rather than as missing data, and the section total now
   * states how many accounts it excludes, so the rows it means should say so
   * themselves.
   */
  test('an account with no valuation says so rather than rendering blank', () => {
    const { container } = render(<AccountValue value={null} />)
    expect(container.firstChild).not.toBeNull()
    expect(container.textContent).toContain('No value recorded')
  })

  /* Quiet on purpose. The row styles values large and dark, and this is the
     absence of a figure — it must not be mistaken for one at a glance. */
  test('the no-value note is not styled like an amount', () => {
    const { container } = render(<AccountValue value={null} />)
    /* The element that actually HOLDS the text, not its wrapper: the wrapper's
       textContent is identical, so matching on text alone finds the outer span
       and reads the wrong classes off it. */
    const note = [...container.querySelectorAll('span')].find(
      (el) => el.children.length === 0 && el.textContent === 'No value recorded',
    )
    expect(note?.className).toContain('text-neutral-400')
    expect(note?.className).toContain('text-xs')
    expect(note?.className).toContain('font-normal')
    expect(note?.className).not.toContain('tabular-nums')
  })

  /* Still on the column's right edge, like every valued row. */
  test('the no-value case holds the badge width open too', () => {
    const { container } = render(<AccountValue value={null} />)
    const spacer = container.querySelector('[aria-hidden="true"]')
    expect(spacer?.className).toContain('size-[18px]')
  })

  /* Exactly on the average is not a direction either. */
  test('a value level with its baseline gets no arrow', () => {
    const { container } = render(
      <AccountValue value="100000.00" changeAmount="0" baselineValue="100000.00" baselinePoints={30} />,
    )
    expect(container.querySelector('.rounded-full')).toBeNull()
  })
})
