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
/* Five since 18 September, when the indigo ramp gave way to a warm one chosen
   by Clinton. The investment ring draws with 1–4, the allocation with 1–4 by
   family, the value chart with 5 and 1. */
const RAMP = [1, 2, 3, 4, 5].map((n) => token(`mix-${n}`))

describe('the chart ramp', () => {
  /**
   * One hue, stepped. These arcs and bars are the same kind of thing in
   * different amounts, which is what a sequential ramp says; a categorical
   * palette would imply different kinds. The five given sit within a couple of
   * degrees of one another — measured, not asserted from the swatches.
   */
  test('all five are one warm hue', () => {
    const hues = RAMP.map(hue)
    for (const [i, h] of hues.entries()) {
      expect(h, `--mix-${i + 1} (${RAMP[i]}) should be the brand's orange-brown`).toBeGreaterThan(8)
      expect(h, `--mix-${i + 1} (${RAMP[i]}) should be the brand's orange-brown`).toBeLessThan(22)
    }
    expect(Math.max(...hues) - Math.min(...hues), 'the steps should agree on hue').toBeLessThan(4)
  })

  /**
   * The ramp starts at the brand colour EXACTLY. That is the decision of
   * 18 September in one line: the charts speak in the brand's own colour, and a
   * change to `--brand-500` that left `--mix-1` behind would split them.
   */
  test('and the first step is brand orange, to the hex', () => {
    expect(RAMP[0]).toBe(token('brand-500'))
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

  /**
   * Brightest first, darkest last — the reverse of the indigo ramp, and a
   * different rule for the same end. The largest share still takes the first
   * step; in a warm ramp the saturated orange is the visual weight and the
   * charcoal recedes, so first-is-heaviest holds by chroma where it used to
   * hold by darkness. The value chart depends on the ORDER too: it draws its
   * history in the last step and its latest day in the first, and those must
   * be the two ends.
   */
  test('the steps run brightest to darkest', () => {
    for (let i = 0; i < RAMP.length - 1; i += 1) {
      expect(luminance(RAMP[i]), `--mix-${i + 1} should be lighter than --mix-${i + 2}`).toBeGreaterThan(
        luminance(RAMP[i + 1]),
      )
    }
  })

  test('all five are distinct, so a legend swatch identifies one arc', () => {
    expect(new Set(RAMP).size).toBe(RAMP.length)
  })

  /**
   * The ramp shares its hue with brand orange BY DESIGN now, so the old
   * keep-away test is gone. What must still hold is that it stays clear of the
   * hues that carry a STATE — a chart step that drifted towards the live green
   * or the wrong-direction red would borrow a meaning. Amber is excluded from
   * this list on purpose: at 15° the ramp is 29° from it, and an orange that
   * was 30° from amber would not be the brand's orange.
   */
  test('the ramp stays clear of every hue that means a state', () => {
    const states = { 'emerald (live / super tile)': 160, 'sky (insurance tile)': 200, 'red (wrong direction)': 0 }
    for (const step of RAMP) {
      for (const [what, h] of Object.entries(states)) {
        const gap = Math.min(Math.abs(hue(step) - h), 360 - Math.abs(hue(step) - h))
        expect(gap, `${step} sits ${gap.toFixed(0)}° from ${what}`).toBeGreaterThan(12)
      }
    }
  })
})

/**
 * The same inks, now on a second ground — the allocation bars' track.
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

/* The value chart paints its below-zero day as a literal hex, read out of the
   component for the same reason the bars' steps are. */
const VALUE_BARS = readFileSync(resolve(process.cwd(), 'components/value-bars.tsx'), 'utf8')
const valueBarsHex = (name: string) => {
  const m = VALUE_BARS.match(new RegExp(`const ${name} = '(#[0-9a-fA-F]{6})'`))
  if (!m) throw new Error(`${name} is not a literal hex in value-bars.tsx`)
  return m[1].toLowerCase()
}
const VALUE_BELOW = valueBarsHex('BELOW')

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
   * The trap the obvious choice walks into, twice over. Under the indigo ramp
   * `--mix-4` WAS neutral-500, so the negative bar had to be neutral-600. Under
   * the warm ramp neutral-600 is the near-twin of the new `--mix-4` — 0.03 of
   * luminance apart and hardly more saturated — so it moved to neutral-500. A
   * negative `other` sits in the cash family, directly beneath a positive
   * `cash`; if the two greys ever converge the tone stops carrying the sign.
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


/**
 * The value chart's below-zero day, held to the same two rules as the bars'
 * negative: clear of the 3:1 floor on the white sheet, and told from every
 * step of the ramp — above all from `--mix-5`, which is the tone of the bars
 * either side of it.
 */
describe('the value chart, below zero', () => {
  test('the below-zero tone clears the floor on the sheet', () => {
    expect(contrast(VALUE_BELOW, GROUND), `the below-zero day (${VALUE_BELOW})`).toBeGreaterThan(3)
  })

  test('and is not one of the steps it sits between', () => {
    for (const [i, colour] of RAMP.entries()) {
      const dLum = Math.abs(luminance(VALUE_BELOW) - luminance(colour))
      const dSat = Math.abs(saturation(VALUE_BELOW) - saturation(colour))
      expect(
        colour !== VALUE_BELOW && (dLum > 0.03 || dSat > 0.25),
        `the below-zero day (${VALUE_BELOW}) is indistinguishable from --mix-${i + 1} (${colour})`,
      ).toBe(true)
    }
  })

  /* One neutral for "below zero" across the tab, so the reader learns it once. */
  test('and is the same grey the allocation bars use for a negative class', () => {
    expect(VALUE_BELOW).toBe(NEGATIVE)
  })
})
