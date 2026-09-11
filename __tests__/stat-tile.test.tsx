import { describe, expect, test } from 'vitest'
import { render, screen } from '@testing-library/react'
import { StatTile } from '@/components/ui'

/**
 * The headline tile, and the thirty-day change line added under it on
 * 11 September.
 *
 * The tone is decided inside the component rather than by the caller, the same
 * rule `Pill` states for its own: one green, one red, and no way for a second
 * tile to pick a different pair. What is asserted here is that the rule exists
 * and is read from the number — the arithmetic that produces the number is
 * `wealth-summary.test.ts`.
 */
/* By slot, not by text: `getByText` with a regex matches every ancestor whose
   combined text contains it, so the first version of this helper returned the
   whole tile and compared the label and the figure along with the line. */
const changeLine = () => document.querySelector('[data-slot="change"]') as HTMLElement
const pctMark = (text: string) => screen.getByText(text)

describe('StatTile’s change line', () => {
  test('is absent unless there is a change to show', () => {
    render(<StatTile label="Total wealth" value="$497,251" />)
    expect(changeLine()).toBeNull()
  })

  test('prints the signed percentage and the period it covers', () => {
    render(<StatTile label="Total wealth" value="$497,251" change={{ pct: 0.2, text: '+0.2%' }} />)
    expect(changeLine().textContent).toBe('+0.2% over the last 30 days')
  })

  test('a rise is green', () => {
    render(<StatTile label="Total wealth" value="$1" change={{ pct: 0.2, text: '+0.2%' }} />)
    expect(pctMark('+0.2%').className).toContain('text-emerald-700')
  })

  test('a fall is red', () => {
    render(<StatTile label="Total wealth" value="$1" change={{ pct: -3.6, text: '-3.6%' }} />)
    expect(pctMark('-3.6%').className).toContain('text-red-700')
  })

  /* Flat is grey, not a faint green. A figure that has not moved must not read
     as one that has.

     neutral-600 rather than 500: on the page ground behind these bare tiles,
     500 measures 4.35:1 and 12px text needs 4.5:1. The same call `PILL_TONES`
     already made, for the same ground. */
  test('flat is neutral, and neither of the two', () => {
    render(<StatTile label="Total wealth" value="$1" change={{ pct: 0, text: '0.0%' }} />)
    const mark = pctMark('0.0%')
    expect(mark.className).toContain('text-neutral-600')
    expect(mark.className).not.toContain('emerald')
    expect(mark.className).not.toContain('red')
  })

  /**
   * **The sign is in the text, so colour is never the only carrier.**
   *
   * A reader who cannot separate the green from the red still has "+" and "-"
   * in front of the number, which is why no `sr-only` gloss is needed here —
   * unlike the account rows' arrow, which is a glyph with nothing to read.
   */
  test('the direction is readable without the colour', () => {
    const { unmount } = render(<StatTile label="W" value="$1" change={{ pct: 5, text: '+5.0%' }} />)
    expect(changeLine().textContent).toContain('+')
    unmount()
    render(<StatTile label="W" value="$1" change={{ pct: -5, text: '-5.0%' }} />)
    expect(changeLine().textContent).toContain('-')
  })

  /* Only the percentage is coloured. Colouring the whole sentence would make a
     grey caption shout. */
  test('the words beside it stay quiet', () => {
    render(<StatTile label="W" value="$1" change={{ pct: 9, text: '+9.0%' }} />)
    expect(changeLine().className).toContain('text-neutral-600')
    expect(changeLine().className).not.toContain('emerald')
  })

  /* The change and the hint are different slots; a tile may carry both, and the
     change reads first because it is about the figure directly above it. */
  test('sits above the hint when a tile carries both', () => {
    render(
      <StatTile label="W" value="$1" hint="a caveat" change={{ pct: 1, text: '+1.0%' }} />,
    )
    const change = changeLine()
    const hint = screen.getByText('a caveat')
    expect(change.compareDocumentPosition(hint) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  /* The caveat about what the change covers is a tooltip, as the other wealth
     caveats already are — not a third line under a 160px headline. */
  test('the caveat stays a tooltip rather than a third line', () => {
    const { container } = render(
      <StatTile
        label="Total wealth"
        value="$497,251"
        title="30-day change covers 2 of 3 valued accounts"
        change={{ pct: 0.2, text: '+0.2%' }}
      />,
    )
    expect(container.firstElementChild!.getAttribute('title')).toBe(
      '30-day change covers 2 of 3 valued accounts',
    )
    expect(container.textContent).not.toContain('covers 2 of 3')
  })
})
