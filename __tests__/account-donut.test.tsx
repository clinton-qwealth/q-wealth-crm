import { describe, expect, test } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { AccountDonut, type DonutAccount } from '@/components/account-donut'

/**
 * The investment mix donut, as rendered.
 *
 * The arithmetic is in `account-mix.test.ts` — pure, no renderer. What is
 * checked here is what Recharts and this component do with it: that a segment
 * exists per slice in the ramp's tones, that **hovering either the ring or the
 * legend highlights three**, that the centre counts accounts rather than money,
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

/* Three accounts, 70/20/10 — the shape the ring draws. */
const three = [
  account({ label: 'Joint Super', latest_value: 700 }),
  account({ label: 'Portfolio', latest_value: 200 }),
  account({ label: 'Cash', latest_value: 100 }),
]

const segments = () => Array.from(document.querySelectorAll('[data-slot="segment"]'))
/* The frame carries the hover as `data-active`, because the arcs cannot — see
   the node-identity test below. */
const frame = () => document.querySelector('[data-slot="mix-chart"]')!
const rows = () => Array.from(document.querySelectorAll('[data-slot="legend-row"]'))
const activeRows = () =>
  rows()
    .filter((r) => r.getAttribute('data-active') === 'true')
    .map((r) => r.getAttribute('data-label') ?? r.textContent)

describe('the investment mix donut', () => {
  /**
   * The "Mix by value" heading was removed on 10 September, and the chart's
   * sheet has to stay level with the records sheet beside it — which has a
   * heading above it. So the heading's BOX is still rendered, invisible.
   */
  /**
   * The ground, and the fact that it is white.
   *
   * A dark sheet was built on 10 September and reverted the same day — the
   * **third** dark surface this page has turned down, after charcoal stat cards
   * and a charcoal tab strip on 6 September. Asserted rather than left implicit,
   * because the tones have now swung three ways once and a half-reverted palette
   * — a light text token left on a white sheet — is invisible rather than
   * merely ugly.
   */
  describe('the ground', () => {
    const sheet = () => document.querySelector('[data-slot="mix-chart"] > :last-child')!

    test('is the site’s own white sheet, with its elevation', () => {
      render(<AccountDonut accounts={three} />)
      expect(sheet().className).toContain('bg-white')
      expect(sheet().className).toContain('shadow-[')
      expect(sheet().className).toContain('border-neutral-200')
    })

    test('and nothing is left over from the dark experiment', () => {
      const { container } = render(<AccountDonut accounts={three} />)
      const inside = container.innerHTML
      for (const darkOnly of ['bg-mix-ground', 'border-white/10', 'text-neutral-300', 'bg-white/10', 'stroke-white/']) {
        expect(inside, `${darkOnly} belongs to the dark ground and would be invisible here`).not.toContain(darkOnly)
      }
    })

    test('the legend and figures read on white', () => {
      const { container } = render(<AccountDonut accounts={three} />)
      const inside = container.querySelector('[data-slot="mix-chart"] > :last-child')!.innerHTML
      expect(inside).toContain('text-neutral-700')
      expect(inside).toContain('text-neutral-900')
      expect(inside).not.toContain('text-white')
    })

    test('the hover highlight is the light-ground grey', () => {
      render(<AccountDonut accounts={three} />)
      fireEvent.mouseEnter(rows()[0])
      expect(rows()[0].className).toContain('bg-neutral-100')
    })

    test('and the ghost is grey again, not a light wash', () => {
      render(<AccountDonut accounts={[]} />)
      const ring = document.querySelector('[data-slot="ghost-ring"]')!
      /* `getAttribute('class')`, not `.className`: on an SVG element that
         property is an `SVGAnimatedString`, so `toContain` compares nothing. */
      expect(ring.getAttribute('class')).toContain('stroke-neutral-200')
    })
  })

  /**
   * The ring's box, shared with the ghost so the placeholder is the same size
   * as the thing it stands in for — they were two copies of the cap and had
   * already drifted once.
   */
  describe('the ring’s size', () => {
    test('the ring and its ghost sit in the same box', () => {
      render(<AccountDonut accounts={three} />)
      const real = screen.getByRole('img').className
      cleanup()
      render(<AccountDonut accounts={[]} />)
      const ghostBox = document.querySelector('[data-slot="ghost-ring"]')!.closest('div')!.className
      for (const cls of ['aspect-square', 'w-full', 'max-w-[10rem]']) {
        expect(real, `real ring: ${cls}`).toContain(cls)
        expect(ghostBox, `ghost: ${cls}`).toContain(cls)
      }
    })

    /**
     * Capped a little inside the column, and the number was arrived at by
     * overshooting once.
     *
     * The cap is the only thing that bites: the reserved column carries ~174px
     * of content at 1440, so the original 220px cap did nothing and the ring
     * filled the column. Asked for smaller, it went to 9rem/144px — a 17% cut,
     * which read as too small — and settled at 10rem/160px, about 8% inside
     * the column. Both rejected values are asserted against, so a revert to
     * either fails rather than looking like a fresh decision.
     */
    test('is capped a little inside the column, at neither of the rejected sizes', () => {
      render(<AccountDonut accounts={three} />)
      const cls = screen.getByRole('img').className
      expect(cls).toContain('max-w-[10rem]')
      expect(cls).not.toContain('max-w-[9rem]')
      expect(cls).not.toContain('max-w-[220px]')
    })
  })

  describe('lining up with the records list', () => {
    test('carries no heading text at all', () => {
      render(<AccountDonut accounts={three} />)
      expect(screen.queryByText('Mix by value')).toBeNull()
      expect(screen.queryByRole('heading')).toBeNull()
    })

    test('but keeps the heading’s box, invisible and unannounced, above the sheet', () => {
      const { container } = render(<AccountDonut accounts={three} />)
      const spacer = container.querySelector('[data-slot="mix-chart"] > :first-child')!
      // `invisible` is visibility:hidden — it keeps the box. `hidden` would not.
      expect(spacer.className).toContain('invisible')
      expect(spacer.className).not.toContain('hidden')
      expect(spacer.getAttribute('aria-hidden')).toBe('true')
      // The shared token, so it cannot drift from the real heading's metrics.
      expect(spacer.className).toContain('mb-2.5')
      expect(spacer.className).toContain('text-xs')
      // Not a heading element: an invisible one would still sit in the outline.
      expect(spacer.tagName).toBe('DIV')
    })
  })

  test('the ring is fluid and scales with its column, not a fixed 128px box', () => {
    render(<AccountDonut accounts={three} />)
    const ring = screen.getByRole('img')
    expect(ring.className).toContain('w-full')
    expect(ring.className).toContain('aspect-square')
    // The wrapper Recharts sizes inline is overridden, or it would stay fixed.
    expect(ring.className).toContain('recharts-wrapper')
    expect(ring.getAttribute('style')).toBeNull()
  })

  /**
   * The gap and the rounded ends, asked for on 10 September — and three had to be
   * measured out of the path data, because Recharts' props are not visible in
   * the DOM.
   *
   * The first attempt at this was vacuous and a mutation said so: it asserted
   * `d.length > 40` and that the three paths differed, which is true with the
   * gap and the corners three switched off. What follows are the two signatures
   * that actually separate them.
   */
  describe('the shape of the ring', () => {
    /**
     * Rounded ends show up as arc commands. A square-ended donut sector is two
     * arcs — the outer sweep and the inner sweep back. Each rounded corner adds
     * one more, so a sector with `cornerRadius` carries six. Measured: 2 → 6.
     */
    test('every segment has round ends, not square ones', () => {
      render(<AccountDonut accounts={three} />)
      for (const seg of segments()) {
        const arcs = (seg.getAttribute('d')!.match(/A/g) ?? []).length
        expect(arcs, 'arc commands: 2 is square-ended, 6 is rounded').toBe(6)
      }
    })

    /**
     * **Fully** round, which is what was asked for — not merely rounded.
     *
     * The comparison ring the treatment was chosen from was a dashed circle
     * with `stroke-linecap="round"`: a semicircular cap spanning the whole
     * band. Recharts reaches that only when `cornerRadius` is half the band,
     * and the tell is where the path starts. A fully round cap is a semicircle
     * whose apex sits on the band's MIDLINE; a smaller radius starts nearer the
     * outer edge. Mutation found this: an arbitrary `cornerRadius={7}` passed
     * the arc-count test above, because any rounding at all gives six arcs.
     */
    test('the ends are FULLY round — the cap spans the whole band', () => {
      render(<AccountDonut accounts={three} />)
      const half = 120 // SIZE / 2
      const outer = 0.94 * half // 112.8
      const halfBand = ((0.94 - 0.6) * half) / 2 // 20.4
      const [, x, y] = segments()[0].getAttribute('d')!.match(/^M\s*([-\d.]+),\s*([-\d.]+)/)!
      const inset = outer - Math.hypot(Number(x) - half, Number(y) - half)

      /* Measured, not predicted: a full-band corner radius insets the path's
         start 22.7 from the outer edge, where the arbitrary 7 it started at
         insets only 11.9. (I first asserted the cap apex would land exactly on
         the band's midline at 92.4 — it lands at 90.1, so Recharts' cap is not
         quite the semicircle that construction implies. The inset is the
         property that actually separates the two.) */
      expect(
        inset,
        `cap insets ${inset.toFixed(1)} from the outer edge; half the band is ${halfBand.toFixed(1)}`,
      ).toBeGreaterThan(halfBand * 0.9)
    })

    /**
     * The gap shows up in where each segment STARTS.
     *
     * Without one, the segments partition the circle exactly, so the nth starts
     * after `sum of the shares before it × 360°` of travel. A `paddingAngle`
     * makes every segment narrower than its share, so each subsequent one
     * starts after LESS travel than that. Measured with 70/20/10: starts move
     * from 252° and 324° to 248.7° and 321.9°.
     *
     * Note the span between consecutive starts still sums to 360° whichever way
     * — the gap lives inside each segment, not between the start points. That
     * was the first thing tried, and it could not tell them apart.
     */
    test('the segments are separated, so each starts before its share would put it', () => {
      render(<AccountDonut accounts={three} />)
      const cx = 120 // SIZE / 2, in viewBox units
      const travelled = segments().map((seg) => {
        const [, x, y] = seg.getAttribute('d')!.match(/^M\s*([-\d.]+),\s*([-\d.]+)/)!
        const deg = (Math.atan2(cx - Number(y), Number(x) - cx) * 180) / Math.PI
        // Clockwise degrees travelled from the twelve o'clock start.
        return (((90 - deg) % 360) + 360) % 360
      })

      // 70 / 20 / 10, so with no gap the starts would be exactly here.
      const ifTouching = [0, 0.7 * 360, 0.9 * 360]
      expect(travelled[0]).toBeCloseTo(0, 5)
      expect(travelled[1]).toBeLessThan(ifTouching[1] - 1)
      expect(travelled[2]).toBeLessThan(ifTouching[2] - 1)
      expect(travelled[1]).toBeLessThan(travelled[2])

      /*
       * And the gap is the SIZE that was asked for, not merely non-zero.
       *
       * With n arcs each inset by g degrees, the second starts at
       * `share1 × (360 − n·g) + g`, so g falls out of where it actually starts.
       * Mutation found this: narrowing 11° back to 3° passed every assertion
       * above, because they only ask that a gap exists.
       */
      const n = 3
      const share1 = 0.7
      const gap = (share1 * 360 - travelled[1]) / (share1 * n - 1)
      expect(gap, `measured gap ${gap.toFixed(1)}°`).toBeCloseTo(11, 0)
    })

    /**
     * A lone account is a closed annulus — two arcs, the outer sweep and the
     * inner one back — and **no corner arcs, because a full ring has no
     * corners.** So the six-arc rule above does not apply to it, which is why
     * it is asserted separately rather than folded into that loop.
     *
     * Recharts also ignores `paddingAngle` here of its own accord: the path is
     * byte-identical at 0 and at 3, which is what retired the conditional that
     * used to guard this case.
     */
    test('a lone segment is a closed ring, drawn, with no notch in it', () => {
      render(<AccountDonut accounts={[account({ label: 'Only', latest_value: 500 })]} />)
      expect(segments()).toHaveLength(1)
      const d = segments()[0].getAttribute('d')!
      expect((d.match(/A/g) ?? []).length, 'a full ring is two arcs').toBe(2)
      // A real path, not a degenerate move-to — which is what it looks like
      // until you notice Recharts writes these across several lines.
      expect(d.replace(/\s+/g, ' ')).toMatch(/^M .* A .* L .* A .* Z$/)

      /* And it is a RING, not a hairline and not a pie. The two arc radii are
         the outer and inner edges, so their difference is the band. Asserted
         here rather than on the three-slice ring because a lone segment has no
         corner arcs to sort out of the way — 108.1 and 69, a band of 36% of the
         outer radius. Caught by mutation: pushing the inner radius to 92% left
         every other assertion in this file passing. */
      const radii = Array.from(d.matchAll(/A\s*([\d.]+),/g)).map((m) => Number(m[1]))
      const [outer, inner] = [Math.max(...radii), Math.min(...radii)]
      const band = (outer - inner) / outer
      expect(band, 'band as a fraction of the outer radius').toBeGreaterThan(0.2)
      expect(band, 'a donut, not a pie').toBeLessThan(0.7)

      /*
       * And the radii are EXACTLY the shared constants against half the
       * viewBox — which is what ties the real ring to its own ghost.
       *
       * This is the assertion that pins `margin={{ 0,0,0,0 }}` on the chart.
       * Recharts defaults that margin to 5, which resolves a percentage radius
       * against 115 rather than 120: the ring quietly shrinks ~4% while the
       * ghost, computed from `SIZE`, does not follow. Every other assertion in
       * this file passed with the margin removed — this is the one that caught
       * it.
       */
      const half = 120 // SIZE / 2
      expect(outer, 'outer edge at OUTER_RADIUS of half the viewBox').toBeCloseTo(0.94 * half, 4)
      expect(inner, 'inner edge at INNER_RADIUS of half the viewBox').toBeCloseTo(0.6 * half, 4)
    })

    /**
     * The ring nearly fills its box, which is what "larger" meant on
     * 10 September — and what percentage radii buy over pixel ones. Measured:
     * `60%`/`94%` puts the outer edge at 0.84 of the half-viewBox, where the
     * pixel radii it replaced sat at 0.46 — a ring half the size in the same
     * square.
     */
    test('the ring fills its box rather than floating small inside it', () => {
      render(<AccountDonut accounts={three} />)
      const half = 120 // SIZE / 2
      const [, , y] = segments()[0].getAttribute('d')!.match(/^M\s*([-\d.]+),\s*([-\d.]+)/)!
      const outer = half - Number(y)
      expect(outer / half).toBeGreaterThan(0.75)
    })
  })

  test('draws one segment per account, darkest share first', () => {
    render(<AccountDonut accounts={three} />)
    const fills = segments().map((s) => s.getAttribute('fill'))
    /* Positional: darkest first, so the largest share is the heaviest arc and
       the ring reads in order before the legend is consulted. */
    expect(fills).toEqual(['var(--mix-1)', 'var(--mix-2)', 'var(--mix-3)'])
    expect(new Set(fills).size).toBe(3)
  })

  /**
   * The fourth tone is a NEUTRAL, carrying the grouped tail — there is no
   * fourth indigo that both clears the 3:1 floor on white and reads as
   * distinct from the third.
   */
  test('a grouped tail is drawn in the neutral, not a fourth indigo', () => {
    render(
      <AccountDonut
        accounts={Array.from({ length: 7 }, (_, i) =>
          account({ label: `Account ${i}`, latest_value: 100 - i }),
        )}
      />,
    )
    const fills = segments().map((s) => s.getAttribute('fill'))
    expect(fills).toEqual(['var(--mix-1)', 'var(--mix-2)', 'var(--mix-3)', 'var(--mix-4)'])
    expect(rows()[3].textContent).toContain('4 smaller accounts')
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
    test('pointing at a legend row marks the ring and shades that row', () => {
      render(<AccountDonut accounts={three} />)
      expect(activeRows()).toEqual([])
      expect(frame().getAttribute('data-active'), 'at rest').toBeNull()

      fireEvent.mouseEnter(rows()[1])

      expect(rows()[1].getAttribute('data-active')).toBe('true')
      expect(rows()[1].className).toContain('bg-neutral-100')
      expect(frame().getAttribute('data-active'), 'the ring knows which arc').toBe('1')
    })

    /**
     * **The whole reason the hover works at all**, and the assertion that
     * would have caught the bug on 11 September.
     *
     * Reported twice as instant, the second time after a correct
     * `transition-property: fill-opacity,transform` had been added and
     * verified in the built stylesheet. The stylesheet was never the problem.
     * Recharts keys its sector subtree on an animation id regenerated whenever
     * the Pie's props change by reference, and passes that id as a React key —
     * so a `fillOpacity` that moved with the hover remounted every arc, and a
     * transition cannot run on a node that has only just been inserted. It
     * starts at its final value.
     *
     * Node identity is therefore the thing to assert, not the styling: if the
     * arcs are replaced, no amount of correct CSS will animate.
     */
    test('the arcs survive a hover as the same DOM nodes, so the browser can animate them', () => {
      render(<AccountDonut accounts={three} />)
      const before = segments()
      expect(before).toHaveLength(3)

      fireEvent.mouseEnter(rows()[1])
      const during = segments()
      expect(during).toHaveLength(3)
      during.forEach((node, i) => {
        expect(node, `arc ${i} while hovered`).toBe(before[i])
      })

      fireEvent.mouseLeave(rows()[1])
      segments().forEach((node, i) => {
        expect(node, `arc ${i} after the pointer leaves`).toBe(before[i])
      })
    })

    /* The stylesheet pairs `[data-active="n"]` on the frame with
       `[data-index="n"]` on an arc, so the index has to be on the arc and has
       to be its position in the ring. */
    test('each arc carries its own index, which is what the stylesheet matches on', () => {
      render(<AccountDonut accounts={three} />)
      expect(segments().map((s) => s.getAttribute('data-index'))).toEqual(['0', '1', '2'])
    })

    test('and pointing at a segment activates its legend row', () => {
      render(<AccountDonut accounts={three} />)
      fireEvent.mouseEnter(segments()[2])
      expect(activeRows()).toHaveLength(1)
      expect(rows()[2].getAttribute('data-active')).toBe('true')
      expect(frame().getAttribute('data-active')).toBe('2')
    })

    test('leaving puts everything back, rather than latching on the last one', () => {
      render(<AccountDonut accounts={three} />)
      fireEvent.mouseEnter(rows()[0])
      expect(activeRows()).toHaveLength(1)
      fireEvent.mouseLeave(rows()[0])
      expect(activeRows()).toEqual([])
      expect(frame().getAttribute('data-active')).toBeNull()
    })

    /* `null` is "nothing hovered" and index 0 is the largest segment. A -1 or 0
       sentinel would make the first slice permanently highlighted — and on the
       frame, an EMPTY string would too, because the dim rule keys off the
       attribute merely being present. */
    test('nothing is highlighted before the pointer arrives, including the first slice', () => {
      render(<AccountDonut accounts={three} />)
      expect(rows()[0].getAttribute('data-active')).toBe('false')
      expect(frame().hasAttribute('data-active')).toBe(false)
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

  /**
   * The omission notice was **removed on instruction, 10 September.**
   *
   * It read "2 accounts with no recorded value are not shown", and it was
   * argued for hard before that: nothing writes a valuation after an account's
   * opening one, so unvalued accounts are the normal case and a chart that
   * dropped them silently is the defect the wealth summary was built around.
   *
   * This asserts the removal rather than deleting the tests, because the reason
   * it was safe is worth pinning: **the omission is still visible on screen.**
   * The centre counts only what the ring draws, and the list beside it prints
   * "No value recorded" against every account it cannot draw. What went is the
   * summary of it here, not the fact itself.
   */
  describe('the omission notice, removed on instruction', () => {
    test('no longer appears, even with accounts it cannot draw', () => {
      render(
        <AccountDonut
          accounts={[
            account({ latest_value: 500 }),
            account({ latest_value: null }),
            account({ latest_value: 0 }),
          ]}
        />,
      )
      expect(screen.queryByText(/not shown/)).toBeNull()
      expect(screen.queryByText(/no recorded value/)).toBeNull()
    })

    /* The fact survives where the reader can still see it: one segment drawn,
       and a centre count that does not claim three. */
    test('but the ring still draws only what it can, and counts only that', () => {
      render(
        <AccountDonut
          accounts={[
            account({ latest_value: 500 }),
            account({ latest_value: null }),
            account({ latest_value: 0 }),
          ]}
        />,
      )
      expect(segments()).toHaveLength(1)
      expect(document.querySelector('[aria-hidden="true"].absolute')!.textContent).toBe('1account')
    })
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

    /**
     * The grey silhouette, asked for on 10 September. Its whole job is to be
     * the shape of the thing that belongs here — so what is asserted is that it
     * appears in **three** empty states, that it matches the real ring's
     * geometry, and above all that it is **neither of the app's other two grey
     * stand-ins**: not dashed (which means "not built") and not pulsing (which
     * means "arriving", and nothing is arriving).
     */
    describe('the ghost ring', () => {
      const ghost = () => document.querySelector('[data-slot="ghost-ring"]')

      test('stands in when there are no accounts at all', () => {
        render(<AccountDonut accounts={[]} />)
        expect(ghost()).toBeTruthy()
        expect(segments()).toHaveLength(0)
      })

      test('and when accounts exist but none has a value', () => {
        render(
          <AccountDonut
            accounts={[account({ latest_value: null }), account({ latest_value: 0 })]}
          />,
        )
        expect(ghost()).toBeTruthy()
        expect(segments()).toHaveLength(0)
      })

      test('but never alongside a real ring', () => {
        render(<AccountDonut accounts={three} />)
        expect(ghost()).toBeNull()
        expect(segments()).toHaveLength(3)
      })

      /**
       * The distinction that matters. A pulse would promise a value that is
       * never coming, and a dashed edge would say the chart is unbuilt.
       */
      test('does not pulse, and is not dashed', () => {
        const { container } = render(<AccountDonut accounts={[]} />)
        expect(container.innerHTML).not.toContain('animate-pulse')
        expect(container.innerHTML).not.toContain('animate-')
        expect(container.innerHTML).not.toContain('border-dashed')
        expect(container.innerHTML).not.toContain('dashed')
      })

      test('is decorative, and the sentence carries the meaning', () => {
        render(<AccountDonut accounts={[]} />)
        expect(ghost()!.closest('[aria-hidden="true"]')).toBeTruthy()
        expect(screen.getByText(/Once this group holds investment accounts/)).toBeTruthy()
      })

      /* Same band as the real ring, from the same two constants — so a nudge to
         the chart's proportions cannot leave its own placeholder behind. */
      test('matches the real ring’s band, derived from the same constants', () => {
        render(<AccountDonut accounts={[]} />)
        const c = ghost()!
        const half = 120 // SIZE / 2
        const r = Number(c.getAttribute('r'))
        const w = Number(c.getAttribute('stroke-width'))
        // Real ring: inner 60%, outer 94% of half.
        expect(r - w / 2).toBeCloseTo(0.6 * half, 5)
        expect(r + w / 2).toBeCloseTo(0.94 * half, 5)
      })

      test('scales with the column like the real ring does', () => {
        render(<AccountDonut accounts={[]} />)
        const box = ghost()!.closest('div')!
        expect(box.className).toContain('w-full')
        expect(box.className).toContain('aspect-square')
      })
    })

    test('and the sheet still stands, so the column is never bare', () => {
      const { container } = render(<AccountDonut accounts={[]} />)
      expect(container.querySelector('[data-slot="mix-chart"]')).toBeTruthy()
      // The alignment spacer is there in the empty state too, or the sentence
      // would sit higher than the records list beside it.
      expect(container.querySelector('.invisible')).toBeTruthy()
    })
  })

  /** Colour carries the mapping on screen, so the ring says itself in words. */
  test('the ring has a text equivalent naming every share', () => {
    render(<AccountDonut accounts={three} />)
    const label = screen.getByRole('img').getAttribute('aria-label')!
    expect(label).toContain('$1,000.00 in total')
    /* A Recharts `Cell` takes no children, so it cannot carry a `<title>` the
       way the hand-rolled `<circle>` did — this label is the whole spoken
       version of the ring. */
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
   * Two environment notes, three measured rather than assumed. jsdom leaves
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

  /**
   * The legend row's half of the tempo. The ring's half is in `globals.css`
   * and is asserted in `mix-hover-css.test.ts`, which also checks the two
   * agree — pointing at either moves both, so a mismatch would be on screen
   * every time.
   *
   * Stated rather than left to Tailwind's 150ms default, which across this
   * highlight reads as a snap rather than a glide.
   */
  test('the legend row states its tempo rather than taking the default', () => {
    render(<AccountDonut accounts={three} />)
    expect(rows()[0].className).toContain('transition-colors')
    expect(rows()[0].className).toContain('duration-300')
    expect(rows()[0].className).toContain('ease-out')
  })

})
