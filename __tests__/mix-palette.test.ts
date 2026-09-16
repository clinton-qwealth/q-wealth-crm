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

/**
 * The same four inks, now on a second ground — the allocation bars' track.
 *
 * The ramp was measured against the white sheet because that is what a donut
 * arc sits on. An allocation bar sits on a filled track instead, which is a
 * LIGHTER ground than white is dark, so every ratio here is smaller than the
 * one above it. That is the whole reason this block exists: a palette can clear
 * its floor in one place and fail it a component later, and nothing else in the
 * suite would notice — `allocation-bars` paints `var(--mix-1)` and jsdom has no
 * idea what that resolves to.
 *
 * The greys are read OUT OF THE COMPONENT rather than written down here, so
 * changing a class re-points the measurement instead of quietly leaving it
 * measuring a colour the page no longer uses.
 */
const BARS = readFileSync(resolve(process.cwd(), 'components/allocation-bars.tsx'), 'utf8')

/** Tailwind v4's neutral scale, the steps this component draws with. */
const NEUTRAL: Record<string, string> = {
  '100': '#f5f5f5',
  '200': '#e5e5e5',
  '400': '#a3a3a3',
  '500': '#737373',
  '600': '#525252',
  '700': '#404040',
}

const stepFrom = (pattern: RegExp, what: string) => {
  const m = BARS.match(pattern)
  if (!m) throw new Error(`${what} is not where mix-palette expects it in allocation-bars.tsx`)
  const hex = NEUTRAL[m[1]]
  if (!hex) throw new Error(`neutral-${m[1]} (${what}) is not in this file's scale`)
  return hex
}

const TRACK = stepFrom(/h-2\.5 rounded bg-neutral-(\d+)/, 'the bar track')
const NEGATIVE = stepFrom(/r\.negative \? 'bg-neutral-(\d+)'/, 'the negative bar')
const ZERO_RULE = stepFrom(/w-px bg-neutral-(\d+)/, 'the zero rule')

describe('the allocation bars, on their own track', () => {
  test('every family ink clears the 3:1 non-text floor against the track', () => {
    for (const [i, colour] of RAMP.entries()) {
      expect(
        contrast(colour, TRACK),
        `--mix-${i + 1} (${colour}) on the bar track (${TRACK})`,
      ).toBeGreaterThan(3)
    }
  })

  /**
   * The negative bar is not decoration — it is the one mark saying a holding is
   * short. It was neutral-400 when this block was written, measuring 2.29:1,
   * and the bar was there to be squinted at rather than seen.
   */
  test('and so does the negative bar', () => {
    expect(contrast(NEGATIVE, TRACK), `the negative bar (${NEGATIVE})`).toBeGreaterThan(3)
  })

  /**
   * The zero rule is what tells a reader WHICH SIDE a bar is on, so it is
   * load-bearing in exactly the same way.
   */
  test('and the zero rule, on the track and on the sheet it overhangs', () => {
    expect(contrast(ZERO_RULE, TRACK), `the zero rule (${ZERO_RULE}) on the track`).toBeGreaterThan(3)
    expect(contrast(ZERO_RULE, GROUND), `the zero rule (${ZERO_RULE}) on the sheet`).toBeGreaterThan(3)
  })

  /**
   * The trap the obvious fix walks into. `--mix-4` IS neutral-500, and `other`
   * is in the cash family — so deepening the negative bar one step would have
   * made a negative `other` bar the same grey as the positive `cash` bar
   * directly above it, at which point the tone stops carrying the sign at all.
   */
  test('the negative grey is not one of the family inks', () => {
    for (const [i, colour] of RAMP.entries()) {
      /* The ramp's own criterion, reused rather than re-argued: lightness
         separates two colours of the same hue, chroma separates a grey from a
         saturated one. neutral-600 and indigo-700 sit 0.002 apart in luminance
         and are still nothing alike, which the first version of this assertion
         got wrong. */
      const dLum = Math.abs(luminance(NEGATIVE) - luminance(colour))
      const dSat = Math.abs(saturation(NEGATIVE) - saturation(colour))
      expect(
        colour !== NEGATIVE && (dLum > 0.03 || dSat > 0.25),
        `the negative bar (${NEGATIVE}) is indistinguishable from --mix-${i + 1} (${colour}): ` +
          `\u0394luminance ${dLum.toFixed(3)}, \u0394saturation ${dSat.toFixed(2)}`,
      ).toBe(true)
    }
  })
})
