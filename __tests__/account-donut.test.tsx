import { describe, expect, test } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { AccountDonut, type DonutAccount } from '@/components/account-donut'

/**
 * The investment mix donut, as rendered.
 *
 * The arithmetic is in `account-mix.test.ts` — pure, no renderer. What is
 * checked here is what Recharts and this component do with it: that a segment
 * exists per slice in the ramp's tones, that **hovering either the ring or the
 * legend highlights both**, that the centre counts accounts rather than money,
 * that the omission notice appears, and that the ring says itself in words.
 *
 * Recharts renders SVG, which is the reason these assertions are possible at
 * all — a canvas chart would be invisible to jsdom, whose `getContext('2d')`
 * returns null. That was the deciding argument for it over Chart.js.
 */
const account = (o: Partial<DonutAccount> & { latest_value: string | number | null }): DonutAccount => ({
  account_id: `a${Math.random().toString(36).slice(2)}`,
  label: 'An account',
  ...o,
})

const three = [
  account({ label: 'Joint Super', latest_value: 700 }),
  account({ label: 'Portfolio', latest_value: 200 }),
  account({ label: 'Cash', latest_value: 100 }),
]

const segments = () => Array.from(document.querySelectorAll('[data-slot="segment"]'))
const rows = () => Array.from(document.querySelectorAll('[data-slot="legend-row"]'))
const activeRows = () =>
  rows()
    .filter((r) => r.getAttribute('data-active') === 'true')
    .map((r) => r.getAttribute('data-label') ?? r.textContent)

describe('the investment mix donut', () => {
  test('draws one segment per slice, in the mix ramp’s tones', () => {
    render(<AccountDonut accounts={three} />)
    const fills = segments().map((s) => s.getAttribute('fill'))
    expect(fills).toEqual(['var(--mix-1)', 'var(--mix-2)', 'var(--mix-3)'])
    // Distinct, so the legend's swatches can be trusted to identify a segment.
    expect(new Set(fills).size).toBe(3)
  })

  test('the legend lists shares, largest first, and never amounts', () => {
    render(<AccountDonut accounts={three} />)
    expect(rows().map((r) => r.textContent)).toEqual([
      'Joint Super70%',
      'Portfolio20%',
      'Cash10%',
    ])
    expect(screen.queryByText(/\$/)).toBeNull()
  })

  describe('hovering highlights the ring and the legend together', () => {
    test('pointing at a legend row activates that row and dims the other segments', () => {
      render(<AccountDonut accounts={three} />)
      expect(activeRows()).toEqual([])
      // Every segment starts at full strength.
      expect(segments().map((s) => s.getAttribute('fill-opacity'))).toEqual(['1', '1', '1'])

      fireEvent.mouseEnter(rows()[1])

      expect(rows()[1].getAttribute('data-active')).toBe('true')
      expect(rows()[1].className).toContain('bg-neutral-100')
      // The hovered segment keeps its strength; the rest recede.
      expect(segments().map((s) => s.getAttribute('fill-opacity'))).toEqual(['0.4', '1', '0.4'])
    })

    test('and pointing at a segment activates its legend row', () => {
      render(<AccountDonut accounts={three} />)
      fireEvent.mouseEnter(segments()[2])
      expect(activeRows()).toHaveLength(1)
      expect(rows()[2].getAttribute('data-active')).toBe('true')
      expect(segments().map((s) => s.getAttribute('fill-opacity'))).toEqual(['0.4', '0.4', '1'])
    })

    test('leaving puts everything back, rather than latching on the last one', () => {
      render(<AccountDonut accounts={three} />)
      fireEvent.mouseEnter(rows()[0])
      expect(activeRows()).toHaveLength(1)
      fireEvent.mouseLeave(rows()[0])
      expect(activeRows()).toEqual([])
      expect(segments().map((s) => s.getAttribute('fill-opacity'))).toEqual(['1', '1', '1'])
    })

    /* `null` is "nothing hovered" and index 0 is the largest segment. A -1 or 0
       sentinel would make the first slice permanently highlighted. */
    test('nothing is highlighted before the pointer arrives, including the first slice', () => {
      render(<AccountDonut accounts={three} />)
      expect(rows()[0].getAttribute('data-active')).toBe('false')
    })
  })

  test('the centre counts the accounts, and never the money', () => {
    render(
      <AccountDonut
        accounts={[
          account({ latest_value: 486210 }),
          account({ latest_value: 212940 }),
          account({ latest_value: null }),
        ]}
      />,
    )
    const centre = document.querySelector('[aria-hidden="true"].absolute')!
    expect(centre.textContent).toBe('2accounts')
    expect(centre.textContent).not.toContain('$')
    expect(centre.textContent).not.toContain('699,150')
  })

  test('one account drawn reads “account”, not “accounts”', () => {
    render(<AccountDonut accounts={[account({ latest_value: 5 })]} />)
    expect(document.querySelector('[aria-hidden="true"].absolute')!.textContent).toBe('1account')
  })

  /** THE assertion. An omission is stated, every time, in words. */
  test('says how many accounts it cannot show', () => {
    render(
      <AccountDonut
        accounts={[
          account({ latest_value: 500 }),
          account({ latest_value: null }),
          account({ latest_value: 0 }),
        ]}
      />,
    )
    expect(screen.getByText('2 accounts with no recorded value are not shown.')).toBeTruthy()
    expect(segments()).toHaveLength(1)
  })

  test('one omission reads as singular', () => {
    render(<AccountDonut accounts={[account({ latest_value: 500 }), account({ latest_value: null })]} />)
    expect(screen.getByText('1 account with no recorded value is not shown.')).toBeTruthy()
  })

  test('nothing is said when nothing is missing', () => {
    render(<AccountDonut accounts={[account({ latest_value: 500 })]} />)
    expect(screen.queryByText(/not shown/)).toBeNull()
  })

  describe('nothing to draw', () => {
    test('accounts recorded at zero produce a sentence, not a ring', () => {
      render(<AccountDonut accounts={[account({ latest_value: 0 }), account({ latest_value: '0' })]} />)
      expect(segments()).toHaveLength(0)
      expect(screen.getByText(/no value has been recorded against any of these accounts/i)).toBeTruthy()
    })

    test('a single unvalued account reads in the singular', () => {
      render(<AccountDonut accounts={[account({ latest_value: null })]} />)
      expect(screen.getByText(/no value has been recorded against this account/i)).toBeTruthy()
    })

    test('no accounts at all says what will appear here', () => {
      render(<AccountDonut accounts={[]} />)
      expect(segments()).toHaveLength(0)
      expect(screen.getByText(/Once this group holds investment accounts/)).toBeTruthy()
    })

    test('and the heading stands either way, so the column is never blank', () => {
      render(<AccountDonut accounts={[]} />)
      expect(screen.getByText('Mix by value')).toBeTruthy()
    })
  })

  /** Colour carries the mapping on screen, so the ring says itself in words. */
  test('the ring has a text equivalent naming every share', () => {
    render(<AccountDonut accounts={three} />)
    const label = screen.getByRole('img').getAttribute('aria-label')!
    expect(label).toContain('$1,000.00 in total')
    expect(label).toContain('Joint Super 70%')
    expect(label).toContain('Portfolio 20%')
    expect(label).toContain('Cash 10%')
  })

  test('a legend swatch is decorative and adds no text of its own', () => {
    render(<AccountDonut accounts={[account({ label: 'Only', latest_value: 5 })]} />)
    const swatch = rows()[0].firstElementChild!
    expect(swatch.getAttribute('aria-hidden')).toBe('true')
    expect(swatch.textContent).toBe('')
  })

  test('the centre overlay is hidden from assistive technology and unclickable', () => {
    render(<AccountDonut accounts={three} />)
    const centre = document.querySelector('[aria-hidden="true"].absolute')!
    // The role="img" label already says the whole ring; this would repeat it.
    expect(centre.className).toContain('pointer-events-none')
  })

  /**
   * Reduced motion is **not** handled by this component, and that is the point.
   *
   * Recharts honours `prefers-reduced-motion` inside its own animation layer —
   * it reads the same media query, SSR-safely, and subscribes to changes. A
   * second read was written here first and taken out: it duplicated the
   * library's and was worse, because it sampled the preference once and never
   * listened. Testing a dependency's internals is not this suite's job.
   *
   * What IS this component's job is the hover fade, which is its own CSS — so
   * it carries `motion-reduce:transition-none`, the same idiom the loading
   * skeleton and the modals use. That is assertable, and it is asserted.
   *
   * Two environment notes, both measured rather than assumed. jsdom leaves
   * `matchMedia` as an accessor returning undefined, so `vitest.setup.ts`
   * replaces it — and Recharts calls `addEventListener` on the result, so the
   * stub needs the full shape. The stub reports **reduce**, because jsdom has no
   * animation clock and a Recharts pie with animation enabled renders **zero
   * sectors** there. **The animated path is exercised in a browser or not at
   * all**, the same standing limit as contrast.
   */
  /**
   * `"auto"` rather than `true`, which is the difference between honouring the
   * reader's preference and overriding it: Recharts resolves
   * `isActiveProp === 'auto' ? !isSsr && !prefersReducedMotion : isActiveProp`,
   * so `true` animates for somebody who asked not to be. It was written as
   * `true` first, and this is what caught it — with animation forced on, jsdom
   * (which has no animation clock) renders **zero sectors**, so every assertion
   * about the arcs failed at once.
   */
  test('animation defers to the reader’s motion preference, not to a hardcoded true', () => {
    // The setup stub reports "reduce", so honouring it means the arcs are
    // painted at their final geometry rather than mid-animation.
    render(<AccountDonut accounts={three} />)
    expect(segments()).toHaveLength(3)
    expect(segments()[0].getAttribute('d')).toBeTruthy()
  })

  test('the hover fade is CSS, and stands still under reduced motion', () => {
    render(<AccountDonut accounts={three} />)
    for (const seg of segments()) {
      expect(seg.getAttribute('class')).toContain('transition-[fill-opacity]')
      expect(seg.getAttribute('class')).toContain('motion-reduce:transition-none')
    }
  })

})
