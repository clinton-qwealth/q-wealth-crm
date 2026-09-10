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
/** Saturation, 0–1, as HSV — how far the colour is from grey. */
const saturation = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16))
  const max = Math.max(r, g, b)
  return max === 0 ? 0 : (max - Math.min(r, g, b)) / max
}

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
const RAMP = [1, 2, 3, 4].map((n) => token(`mix-${n}`))

describe('the investment-mix ramp', () => {
  /**
   * One hue, stepped — chosen on sight from six treatments drawn at real size.
   * These arcs are the same kind of thing in different amounts, which is what a
   * sequential ramp says; the categorical palettes that preceded it implied
   * different kinds.
   */
  test('the first three are one hue, and the fourth is neutral', () => {
    const [a, b, c, tail] = RAMP
    for (const [i, indigo] of [a, b, c].entries()) {
      const h = hue(indigo)
      expect(h, `--mix-${i + 1} (${indigo}) should be indigo`).toBeGreaterThan(225)
      expect(h, `--mix-${i + 1} (${indigo}) should be indigo`).toBeLessThan(255)
    }
    /* Grey for "and the rest" — a fourth indigo would be either under the floor
       or a near-twin of the third. */
    const [r, g, bl] = [1, 3, 5].map((i) => parseInt(tail.slice(i, i + 2), 16))
    expect(Math.max(r, g, bl) - Math.min(r, g, bl), `--mix-4 (${tail}) should be neutral`).toBeLessThan(8)
  })

  /**
   * 3:1 is WCAG's floor for non-text graphics, which is what an arc is — the
   * legend carries the text. Worth pinning because the obvious greys fail it:
   * neutral-300 measures 1.5:1 against white and neutral-400 2.3:1, so the tail
   * uses neutral-500 at 4.6:1.
   */
  test('every tone clears the 3:1 non-text floor against the white sheet', () => {
    for (const [i, colour] of RAMP.entries()) {
      expect(contrast(colour, GROUND), `--mix-${i + 1} (${colour})`).toBeGreaterThan(3)
    }
  })

  /**
   * A ramp is judged on whether NEIGHBOURING steps can be told apart — and
   * within one hue, only lightness does that work. Tailwind's adjacent steps
   * are far too close: indigo-900 beside indigo-800 differ by 0.014 in relative
   * luminance. Every other step is skipped so each indigo pair clears a real
   * margin.
   *
   * **The last boundary is separated by chroma instead**, and the first version
   * of this test failed on it for the right reason. Indigo-500 and neutral-500
   * sit 0.014 apart in luminance — but one is a saturated indigo and the other
   * a pure grey, which the eye separates easily. Lightness is the criterion
   * inside the hue; saturation is the criterion at the step out of it.
   */
  test('consecutive steps are told apart by lightness, or by chroma where they leave the hue', () => {
    for (let i = 0; i < RAMP.length - 1; i += 1) {
      const [a, b] = [RAMP[i], RAMP[i + 1]]
      const dLum = Math.abs(luminance(a) - luminance(b))
      const dSat = Math.abs(saturation(a) - saturation(b))
      expect(
        dLum > 0.03 || dSat > 0.25,
        `--mix-${i + 1} (${a}) and --mix-${i + 2} (${b}) are too close: Δluminance ${dLum.toFixed(
          3,
        )}, Δsaturation ${dSat.toFixed(2)}`,
      ).toBe(true)
    }
  })

  /* Darkest first, so the largest share is the heaviest arc. */
  test('the indigo steps run darkest to lightest', () => {
    const [a, b, c] = RAMP
    expect(luminance(a)).toBeLessThan(luminance(b))
    expect(luminance(b)).toBeLessThan(luminance(c))
  })

  test('all four are distinct, so a legend swatch identifies one arc', () => {
    expect(new Set(RAMP).size).toBe(RAMP.length)
  })

  /**
   * Indigo is the only family on this page with no job. Asserting the ramp
   * stays clear of the hues that already mean something is what stops a later
   * "nicer" colour from colliding with a state.
   */
  test('the ramp avoids every hue that already means something here', () => {
    const taken = { 'brand orange (action)': 16, 'emerald (live / super tile)': 160, 'gold (investment tile)': 44, 'sky (insurance tile)': 200, 'red (wrong direction)': 0 }
    for (const indigo of RAMP.slice(0, 3)) {
      for (const [what, h] of Object.entries(taken)) {
        const gap = Math.min(Math.abs(hue(indigo) - h), 360 - Math.abs(hue(indigo) - h))
        expect(gap, `${indigo} sits ${gap.toFixed(0)}° from ${what}`).toBeGreaterThan(30)
      }
    }
  })
})
