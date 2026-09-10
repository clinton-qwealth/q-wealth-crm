import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, test } from 'vitest'

/**
 * The investment-mix palette, measured against its own ground.
 *
 * ## Why this can be a unit test when contrast usually cannot
 *
 * The standing line in this project is that **contrast is measured in a browser
 * or not at all** — and it holds, because most of what matters there is
 * composited: opacity, blend modes, an image behind a surface. A computed style
 * cannot tell you the ratio and neither can a class name.
 *
 * This case is different in kind. The chart's seven colours are **literal hex
 * values in one token block** in `globals.css`, and the segments are painted
 * flat with no opacity over the ground. So the ratio is arithmetic on two
 * numbers, exactly, and there is nothing a browser would add.
 *
 * ## Why it is worth having
 *
 * The palette had to **invert** when the chart's ground went dark on
 * 10 September. The values before it were deepened specifically to clear 3:1
 * against white; measured against the dark ground they fall to 2.98–5.12:1,
 * with the fuchsia **under** the 3:1 non-text floor.
 *
 * Nothing caught that. The component paints `var(--mix-1)`, so a revert of the
 * token values is invisible to every other test in the suite — which a mutation
 * proved by doing exactly that and watching 634 tests pass. This is the file
 * that fails instead.
 */
/* Resolved from the working directory, not from `import.meta.url`: under
   vitest's jsdom transform that is not a `file:` URL and `readFileSync` refuses
   it. Vitest runs from the project root. */
const CSS = readFileSync(resolve(process.cwd(), 'app/globals.css'), 'utf8')

const token = (name: string) => {
  const m = CSS.match(new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`))
  if (!m) throw new Error(`--${name} is not a literal hex in globals.css`)
  return m[1].toLowerCase()
}

/** Relative luminance, per WCAG. */
const luminance = (hex: string) => {
  const channel = (v: number) => {
    const c = v / 255
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16))
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
}

const contrast = (a: string, b: string) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

/*
 * White, because the chart sits on the site's own sheet. A `--mix-ground` token
 * existed for a few hours on 10 September while a dark surface was tried, and
 * went with it — the third dark surface this page has rejected.
 */
/** Hue in degrees, 0 = red. */
const hue = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
  const [max, min] = [Math.max(r, g, b), Math.min(r, g, b)]
  if (max === min) return 0
  const d = max - min
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4
  return (((h * 60) % 360) + 360) % 360
}

const GROUND = '#ffffff'
const UI = readFileSync(resolve(process.cwd(), 'components/ui.tsx'), 'utf8')

/**
 * Just `AccountTypeTile`'s own source, not the whole file.
 *
 * Scoped because the first version of these assertions searched all of
 * `ui.tsx` for `text-emerald-700` — and passed off the **success pill** on
 * another line entirely, so recolouring the tile to teal broke nothing. Found
 * by mutation; the lesson is that `toContain` against a whole module is a
 * search, not an assertion.
 */
const TILE = (() => {
  const start = UI.indexOf('export function AccountTypeTile')
  if (start < 0) throw new Error('AccountTypeTile is gone from ui.tsx')
  return UI.slice(start, UI.indexOf('\n}', start))
})()

/** The two arcs, keyed by account type — see `globals.css`. */
const SUPER = token('mix-superannuation')
/** Investment points at the existing gold token, so resolve one more hop. */
const INVESTMENT = token('gold-700')

describe('the mix arcs wear the tiles’ own colours', () => {
  /**
   * The point of grouping by account type. The list beside the ring paints an
   * emerald shield for superannuation and a gold rising line for investment;
   * a per-account ring gave the same account a third, unrelated colour
   * eighteen pixels away. These assertions are what keep the two in step.
   */
  test('the investment arc IS the gold token the tile glyph uses', () => {
    expect(CSS).toMatch(/--mix-investment:\s*var\(--gold-700\)/)
    expect(TILE, 'the tile still paints its glyph gold-700').toContain('text-gold-700')
  })

  /**
   * Emerald has no project token — the tile uses Tailwind's `text-emerald-700`
   * utility — so the value has to be copied. The guard is the pair: the token
   * holds emerald-700's value AND the tile is asserted still to use that
   * family, so recolouring the tile without the ring fails here.
   */
  test('the superannuation arc is emerald-700, the shield’s own colour', () => {
    expect(SUPER).toBe('#047857')
    expect(TILE, 'the tile still paints its shield emerald-700').toContain('text-emerald-700')
  })

  test('both clear the 3:1 non-text floor on the white sheet', () => {
    expect(contrast(SUPER, GROUND)).toBeGreaterThan(3)
    expect(contrast(INVESTMENT, GROUND)).toBeGreaterThan(3)
  })

  /* Two arcs that touch, so they have to be told apart from each other as well
     as from the sheet. Green against gold is a wide hue gap and a real
     lightness difference. */
  test('and are distinguishable from each other', () => {
    expect(SUPER).not.toBe(INVESTMENT)
    const gap = Math.min(
      Math.abs(hue(SUPER) - hue(INVESTMENT)),
      360 - Math.abs(hue(SUPER) - hue(INVESTMENT)),
    )
    expect(gap, `${SUPER} and ${INVESTMENT} are ${gap.toFixed(0)}° apart`).toBeGreaterThan(25)
  })

  /**
   * No ramp any more. Six numbered tokens existed through three failed
   * palettes; they are gone, and this asserts they have not crept back — a
   * stray `--mix-1` would be a positional colour, which is exactly what made
   * the ring disagree with the tiles.
   */
  test('no numbered ramp survives, so colour cannot go back to being positional', () => {
    expect(CSS).not.toMatch(/--mix-[1-6]\s*:/)
    expect(CSS).not.toContain('--mix-ground')
  })
})
