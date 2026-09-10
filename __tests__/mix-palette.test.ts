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

const GROUND = token('mix-ground')
const RAMP = [1, 2, 3, 4, 5, 6].map((n) => token(`mix-${n}`))

describe('the investment-mix palette', () => {
  test('the ground is genuinely dark, not a mid grey', () => {
    expect(luminance(GROUND)).toBeLessThan(0.05)
  })

  /**
   * 3:1 is WCAG's floor for non-text graphics, which is what a chart segment
   * is — the legend beside it carries the text. Every colour clears it with
   * room; the deep values this replaced did not.
   */
  test('every segment colour clears the 3:1 non-text floor against the ground', () => {
    for (const [i, colour] of RAMP.entries()) {
      const ratio = contrast(colour, GROUND)
      expect(ratio, `--mix-${i + 1} (${colour}) against ${GROUND}`).toBeGreaterThan(3)
    }
  })

  /* And comfortably, rather than sitting on the line — so a later nudge to
     either end has somewhere to go before it breaks. */
  test('and clears it with margin, all six above 6:1', () => {
    for (const [i, colour] of RAMP.entries()) {
      expect(contrast(colour, GROUND), `--mix-${i + 1}`).toBeGreaterThan(6)
    }
  })

  test('all six are distinct, so a legend swatch identifies one segment', () => {
    expect(new Set(RAMP).size).toBe(RAMP.length)
  })

  /**
   * Adjacent segments touch on the ring, so consecutive colours have to be
   * told apart from each other and not only from the ground. Measured as a
   * luminance-or-hue difference: the pair may match in brightness as long as
   * the hue moves, which is how a violet can sit beside a cyan.
   */
  test('consecutive colours differ from each other, by lightness or by hue', () => {
    const hue = (hex: string) => {
      const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
      const [max, min] = [Math.max(r, g, b), Math.min(r, g, b)]
      if (max === min) return 0
      const d = max - min
      const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4
      return ((h * 60) % 360 + 360) % 360
    }
    for (let i = 0; i < RAMP.length - 1; i += 1) {
      const [a, b] = [RAMP[i], RAMP[i + 1]]
      const dHue = Math.min(Math.abs(hue(a) - hue(b)), 360 - Math.abs(hue(a) - hue(b)))
      const dLum = Math.abs(luminance(a) - luminance(b))
      expect(
        dHue > 25 || dLum > 0.12,
        `--mix-${i + 1} (${a}) and --mix-${i + 2} (${b}) are too close: ${dHue.toFixed(0)}° apart, Δluminance ${dLum.toFixed(3)}`,
      ).toBe(true)
    }
  })

  /**
   * No warm colour, whatever the reference image had in it. Orange is the
   * action colour across this app and red means the wrong direction, so a warm
   * slice beside a *Suspended* pill would read as a warning.
   */
  test('nothing warm, so no segment can be mistaken for a state', () => {
    for (const [i, colour] of RAMP.entries()) {
      const [r, g, b] = [1, 3, 5].map((k) => parseInt(colour.slice(k, k + 2), 16))
      expect(
        b > r * 0.6 || g > r * 0.9,
        `--mix-${i + 1} (${colour}) reads warm; orange and red already mean something here`,
      ).toBe(true)
    }
  })
})
