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
const GROUND = '#ffffff'
const RAMP = [1, 2, 3, 4, 5, 6].map((n) => token(`mix-${n}`))

/** Hue in degrees, 0 = red. */
const hue = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
  const [max, min] = [Math.max(r, g, b), Math.min(r, g, b)]
  if (max === min) return 0
  const d = max - min
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4
  return (((h * 60) % 360) + 360) % 360
}

describe('the investment-mix palette', () => {
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

  /**
   * And with margin, rather than sitting on the line.
   *
   * 3.5:1 rather than the 6:1 this asserted while the ground was dark. On white
   * a vivid mid-tone caps out around 7:1 before it stops being the purple or
   * pink it is meant to be, so demanding 6 would force the palette darker than
   * what was asked for. Measured range: 4.10-6.29:1, the weakest being the sky
   * at position six, which only draws for a group holding six or more valued
   * accounts.
   */
  test('and clears it with margin, all six above 3.5:1', () => {
    for (const [i, colour] of RAMP.entries()) {
      expect(contrast(colour, GROUND), `--mix-${i + 1} (${colour})`).toBeGreaterThan(3.5)
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
    /* Every i to i+1 AND the last back to the first: the ring closes, so the
       sixth segment touches the first one. That join was untested while the
       palette was a single-hue ramp, where it could not matter. */
    for (let i = 0; i < RAMP.length; i += 1) {
      const [a, b] = [RAMP[i], RAMP[(i + 1) % RAMP.length]]
      const dHue = Math.min(Math.abs(hue(a) - hue(b)), 360 - Math.abs(hue(a) - hue(b)))
      const dLum = Math.abs(luminance(a) - luminance(b))
      expect(
        dHue > 25 || dLum > 0.12,
        `--mix-${i + 1} (${a}) and --mix-${((i + 1) % RAMP.length) + 1} (${b}) are too close: ${dHue.toFixed(0)}° apart, Δluminance ${dLum.toFixed(3)}`,
      ).toBe(true)
    }
  })

  /**
   * Purples, pinks and blues — and nothing warm, whatever a reference image
   * has in it. Orange is this app's action colour and red means the wrong
   * direction, so a warm slice beside a *Suspended* pill would read as a
   * warning.
   *
   * Expressed as a **hue band**, 195-340°, which is what those three families
   * occupy. The first version of this test compared RGB channels
   * (`b > r * 0.6 || g > r * 0.9`) and was simply wrong: a deep pink is
   * red-dominant in RGB, so `pink-600` — squarely in the requested set —
   * failed it. Tailwind's reds, oranges, ambers, yellows and greens all sit
   * outside this band.
   */
  test('every colour is a purple, a pink or a blue, and none is warm', () => {
    for (const [i, colour] of RAMP.entries()) {
      const h = hue(colour)
      expect(
        h > 195 && h < 340,
        `--mix-${i + 1} (${colour}) sits at ${h.toFixed(0)}°, outside the purple-pink-blue band`,
      ).toBe(true)
    }
  })

  /**
   * Every value is a real Tailwind step. They are copied rather than
   * referenced because Tailwind v4 only emits a theme variable some generated
   * utility asks for, so `var(--color-violet-600)` would resolve to nothing —
   * checked in the built CSS. The scale name is recorded beside each value in
   * `globals.css`; this asserts the comment is actually there, because a value
   * with no provenance is the thing that drifts.
   */
  test('each value records which Tailwind step it came from', () => {
    const block = CSS.slice(CSS.indexOf('--mix-1:'), CSS.indexOf('--mix-6:') + 60)
    for (const family of ['indigo-600', 'pink-600', 'blue-600', 'fuchsia-600', 'violet-600', 'sky-600']) {
      expect(block, `the comment naming ${family}`).toContain(family)
    }
  })
})
