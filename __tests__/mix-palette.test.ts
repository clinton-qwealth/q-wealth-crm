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

/**
 * A categorical palette since the afternoon of 18 September — four hues and a
 * darker return to the first — so most of what a RAMP is judged on no longer
 * applies, and the tests below judge it as a set of kinds instead. Two of its
 * steps fall under the accessibility floor this file was written to hold, and
 * three sit on hues that mean a state elsewhere. Both were chosen knowingly;
 * the tests that used to refuse them now NAME them, so that the exceptions
 * stay exactly the ones that were chosen and a third does not join them
 * unnoticed.
 */
const FLOOR = 3

/* The two steps chosen under the floor, by name. Remove a token from this list
   the day it is darkened past 3:1, and the test below will insist you do. */
const UNDER_THE_FLOOR = new Set(['mix-3', 'mix-4'])

/* The three steps that share a hue with a state colour, by name and by state. */
const SHARES_A_STATE_HUE: Record<string, string> = {
  'mix-2': 'red (wrong direction)',
  'mix-3': 'sky (insurance tile)',
  'mix-4': 'emerald (live / super tile)',
}

describe('the chart palette', () => {
  /**
   * The palette starts at the brand colour EXACTLY. That is the decision of
   * 18 September in one line: the charts speak in the brand's own colour, and a
   * change to `--brand-500` that left `--mix-1` behind would split them.
   */
  test('the first step is brand orange, to the hex', () => {
    expect(RAMP[0]).toBe(token('brand-500'))
  })

  /**
   * Categorical: each colour must be tellable from its neighbours, and with
   * different hues in play that is hue OR lightness OR chroma. The last step is
   * the first hue again, darker — told apart by lightness, as a ramp step
   * would be.
   */
  test('consecutive steps are told apart, by hue or by lightness or by chroma', () => {
    for (let i = 0; i < RAMP.length - 1; i += 1) {
      const [a, b] = [RAMP[i], RAMP[i + 1]]
      const dHue = Math.min(Math.abs(hue(a) - hue(b)), 360 - Math.abs(hue(a) - hue(b)))
      const dLum = Math.abs(luminance(a) - luminance(b))
      const dSat = Math.abs(saturation(a) - saturation(b))
      expect(
        dHue > 20 || dLum > 0.03 || dSat > 0.25,
        `--mix-${i + 1} (${a}) and --mix-${i + 2} (${b}) are too close: Δhue ${dHue.toFixed(0)}°, Δluminance ${dLum.toFixed(3)}, Δsaturation ${dSat.toFixed(2)}`,
      ).toBe(true)
    }
  })

  test('all five are distinct, so a legend swatch identifies one arc', () => {
    expect(new Set(RAMP).size).toBe(RAMP.length)
  })

  /**
   * 3:1 is WCAG's floor for non-text graphics, which is what an arc is — the
   * legend carries the text. Two steps were chosen under it, and this asserts
   * that it is exactly those two: every other step clears the floor, and every
   * step named as an exception really is under it (so a fix removes it from
   * the list rather than leaving a stale exception standing).
   */
  test('every step not named as an exception clears the 3:1 floor on the white sheet, and the exceptions are exactly the ones chosen', () => {
    for (const [i, colour] of RAMP.entries()) {
      const name = `mix-${i + 1}`
      const ratio = contrast(colour, GROUND)
      if (UNDER_THE_FLOOR.has(name)) {
        expect(ratio, `${name} (${colour}) is listed as under the floor but measures ${ratio.toFixed(2)}:1 — take it off the list`).toBeLessThan(FLOOR)
      } else {
        expect(ratio, `${name} (${colour}) measures ${ratio.toFixed(2)}:1`).toBeGreaterThan(FLOOR)
      }
    }
  })

  /**
   * Three steps sit on hues that already mean something on these pages. Chosen
   * knowingly; every arc and bar is named, so colour never carries meaning
   * alone. This asserts the collisions are exactly the three that were chosen
   * — a fourth would be an accident, and a fix should remove its entry.
   */
  test('the steps that share a hue with a state colour are exactly the ones chosen', () => {
    const states = { 'emerald (live / super tile)': 160, 'sky (insurance tile)': 200, 'red (wrong direction)': 0 }
    for (const [i, step] of RAMP.entries()) {
      const name = `mix-${i + 1}`
      const collisions = Object.entries(states)
        .filter(([, h]) => Math.min(Math.abs(hue(step) - h), 360 - Math.abs(hue(step) - h)) <= 12)
        .map(([what]) => what)
      const expected = SHARES_A_STATE_HUE[name]
      if (expected) expect(collisions, `${name} (${step})`).toEqual([expected])
      else expect(collisions, `${name} (${step}) has drifted onto a state hue`).toEqual([])
    }
  })

  /**
   * The value chart draws its history in the LAST step and its latest day in
   * the FIRST, so those two must be far apart and the last must be the quieter
   * of the two — a history louder than its endpoint inverts the emphasis.
   */
  test('the last step is quieter than the first, for the value chart’s history', () => {
    const [first, last] = [RAMP[0], RAMP[RAMP.length - 1]]
    expect(saturation(last)).toBeLessThan(saturation(first))
    expect(luminance(last)).toBeLessThan(luminance(first))
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
  /* The same two exceptions, on the lighter ground — where they measure lower
     still. Named, not waived. */
  test('every family ink not named as an exception clears the 3:1 floor against the track', () => {
    for (const [i, colour] of RAMP.slice(0, 4).entries()) {
      const name = `mix-${i + 1}`
      const ratio = contrast(colour, TRACK)
      if (UNDER_THE_FLOOR.has(name)) expect(ratio, `${name} on the track`).toBeLessThan(FLOOR)
      else expect(ratio, `${name} (${colour}) on the bar track (${TRACK}) measures ${ratio.toFixed(2)}:1`).toBeGreaterThan(FLOOR)
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
