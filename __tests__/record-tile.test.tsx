import { describe, expect, test } from 'vitest'
import { render } from '@testing-library/react'
import { AccountTypeTile, PolicyTile } from '@/components/ui'

/**
 * The leading tile on a record row, which carries the record's STATE as of
 * 11 September.
 *
 * ## What replaced what
 *
 * Status used to be a `Pill` beside the account name. The pill is
 * `whitespace-nowrap` and the name is `truncate`, so inside the row's flexible
 * text column the pill always won and the NAME was what got cut — obvious once
 * the list moved into the 65% column of a `TAB_SPLIT`. The tile is a fixed 36px
 * square and cannot squeeze anything, so the state moved onto it: a grey ground
 * and a different glyph, with the word on a tooltip.
 *
 * Three things are worth pinning here, and only the first is obvious:
 *
 * 1. A dormant record is grey and a live one is not.
 * 2. **The glyph really differs** between paused and ended. Both dormant tiles
 *    share every single class, so a class assertion cannot tell them apart —
 *    the path data has to be compared.
 * 3. The word survives for a screen reader. The tile is `aria-hidden`, so
 *    `title` reaches a pointer and nothing else, and this tile is now the only
 *    place an account's status is rendered anywhere in the app.
 */
const tile = (el: HTMLElement) => el.querySelector('span[class*="h-9"]')!
const srText = (el: HTMLElement) => el.querySelector('.sr-only')?.textContent ?? null
/* The glyph, as its path data. Identity of the drawing, not of a class name. */
const glyph = (el: HTMLElement) =>
  Array.from(el.querySelectorAll('path')).map((p) => p.getAttribute('d')).join('|')

describe('an account’s tile', () => {
  describe('while it is live', () => {
    test('keeps its type colour, and says nothing about status', () => {
      const { container } = render(<AccountTypeTile type="investment" status="active" />)
      const t = tile(container)
      expect(t.className).toContain('bg-gold-50')
      expect(t.getAttribute('title'), 'a live account needs no tooltip').toBeNull()
      expect(srText(container)).toBeNull()
    })

    test('and superannuation keeps its own colour and glyph, distinct from investment', () => {
      const { container: superan } = render(<AccountTypeTile type="superannuation" status="active" />)
      const { container: invest } = render(<AccountTypeTile type="investment" status="active" />)
      expect(tile(superan).className).toContain('bg-emerald-50')
      expect(glyph(superan)).not.toBe(glyph(invest))
    })
  })

  describe('once it is not live', () => {
    test('suspended turns grey and names itself', () => {
      const { container } = render(<AccountTypeTile type="investment" status="suspended" />)
      const t = tile(container)
      expect(t.className).toContain('bg-neutral-100')
      expect(t.className).toContain('text-neutral-500')
      expect(t.getAttribute('title')).toBe('Suspended')
      expect(srText(container), 'the word has to survive for a screen reader').toBe('Suspended')
    })

    test('closed turns grey and names itself', () => {
      const { container } = render(<AccountTypeTile type="superannuation" status="closed" />)
      expect(tile(container).className).toContain('bg-neutral-100')
      expect(tile(container).getAttribute('title')).toBe('Closed')
      expect(srText(container)).toBe('Closed')
    })

    /**
     * **Grey, and deliberately not amber.**
     *
     * Amber is the obvious pick for "suspended" and it is the wrong one. The
     * gold token exists to stay clear of it — `globals.css` says a gold tile
     * must not sit beside an amber mark and read as two warnings — and gold-50
     * `#fbf6e4` against amber-50 `#fffbeb` means a suspended INVESTMENT
     * account would shift from one pale warm yellow to an almost identical one.
     * No signal, and the separation that token was created for undone.
     */
    test('and it is never amber, whatever the account type', () => {
      for (const type of ['investment', 'superannuation']) {
        const { container } = render(<AccountTypeTile type={type} status="suspended" />)
        expect(tile(container).className, `${type} suspended`).not.toContain('amber')
        expect(tile(container).className).not.toContain('gold')
      }
    })

    /**
     * The ground says "not live"; the glyph says WHICH. Both tiles carry an
     * identical class list, so this is the only assertion that can separate
     * them, and without it one glyph for both states would pass everything
     * above.
     */
    test('a paused record and an ended one are drawn differently', () => {
      const { container: paused } = render(<AccountTypeTile type="investment" status="suspended" />)
      const { container: ended } = render(<AccountTypeTile type="investment" status="closed" />)

      expect(tile(paused).className, 'same ground').toBe(tile(ended).className)
      expect(glyph(paused), 'but not the same drawing').not.toBe(glyph(ended))
    })

    /* The type glyph is given up on a dormant row — the tile is saying
       something else. Asserted so the trade is recorded rather than assumed:
       the row's second line is what still names the type. */
    test('the type no longer changes the glyph, because the state owns it', () => {
      const { container: superan } = render(<AccountTypeTile type="superannuation" status="closed" />)
      const { container: invest } = render(<AccountTypeTile type="investment" status="closed" />)
      expect(glyph(superan)).toBe(glyph(invest))
    })

    /* A status nobody has taught the map about still reads as a state rather
       than rendering a blank tooltip. */
    test('an unknown status still marks the row, using the status itself', () => {
      const { container } = render(<AccountTypeTile type="investment" status="frozen" />)
      expect(tile(container).className).toContain('bg-neutral-100')
      expect(tile(container).getAttribute('title')).toBe('frozen')
    })
  })
})

describe('a policy’s tile', () => {
  test('in force keeps the insurance colour and says nothing', () => {
    const { container } = render(<PolicyTile status="in_force" />)
    expect(tile(container).className).toContain('bg-sky-50')
    expect(tile(container).getAttribute('title')).toBeNull()
    expect(srText(container)).toBeNull()
  })

  test('lapsed and cancelled grey out and name themselves', () => {
    const { container: lapsed } = render(<PolicyTile status="lapsed" />)
    const { container: cancelled } = render(<PolicyTile status="cancelled" />)

    expect(tile(lapsed).className).toContain('bg-neutral-100')
    expect(tile(lapsed).getAttribute('title')).toBe('Lapsed')
    expect(srText(cancelled)).toBe('Cancelled')
    // Same split as accounts: lapsed is paused, cancelled is over.
    expect(glyph(lapsed)).not.toBe(glyph(cancelled))
  })

  /* One language across the page: a lapsed policy and a suspended account are
     the same idea, so they are the same drawing on the same ground. */
  test('and share their state glyphs with accounts, rather than inventing new ones', () => {
    const { container: lapsed } = render(<PolicyTile status="lapsed" />)
    const { container: suspended } = render(<AccountTypeTile type="investment" status="suspended" />)
    expect(glyph(lapsed)).toBe(glyph(suspended))

    const { container: cancelled } = render(<PolicyTile status="cancelled" />)
    const { container: closed } = render(<AccountTypeTile type="investment" status="closed" />)
    expect(glyph(cancelled)).toBe(glyph(closed))
  })
})
