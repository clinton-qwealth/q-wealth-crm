import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, test } from 'vitest'
import { MAX_SLICES } from '@/lib/account-mix'
import { ASSET_CLASSES } from '@/lib/allocation'

/**
 * The investment ring's hover, which lives in `globals.css` rather than on the
 * component.
 *
 * ## Why it is there, and why that needs a test of its own
 *
 * Recharts keys its sector subtree on an animation id regenerated whenever the
 * Pie's props change by reference, and hands that id to React as a `key`. Any
 * prop that moves with the hover therefore remounts every arc, and a CSS
 * transition cannot run on a node that was only just inserted — it starts at
 * its final value. The hover was reported as instant twice for this reason,
 * the second time with a correct `transition-property` already in the built
 * stylesheet.
 *
 * So the arcs are rendered once and never again, and the effect is expressed
 * as three rules keyed on `data-active` on the frame against `data-index` on
 * each arc. `account-donut.test.tsx` proves the attributes appear and that the
 * arcs survive; nothing there can prove the rules exist, because jsdom loads
 * no stylesheet. Without this file the CSS could be deleted wholesale and the
 * suite would stay green.
 *
 * Reading the source rather than a computed style is the honest limit of what
 * can be checked here. It cannot tell you the hover LOOKS right; it can tell
 * you the rules are present, that they cover every arc the ring can draw, and
 * that the ring and the legend beside it move on one clock.
 */
const css = readFileSync(resolve(__dirname, '../app/globals.css'), 'utf8')

/**
 * One section of the stylesheet: from its first selector to the START of the
 * next section's.
 *
 * **The end bound is not decoration.** Each of the three slices below was
 * `css.slice(css.indexOf(start))` — a slice that ran to the END OF THE FILE —
 * so "the ring runs on a 300ms clock" was in fact asserting that no other
 * duration appears anywhere beneath it in `globals.css`. Three of these tests
 * failed on 25 September 2026 the moment an unrelated 220ms animation was
 * appended to the file, which is an assertion firing for something it was
 * never about. A section that stops where the next one starts says what it
 * meant to say, and leaves the rest of the file alone.
 *
 * It throws rather than returning an empty string: a slice that silently
 * comes back empty passes every `not.toMatch` in this file.
 */
const section = (start: string, end: string) => {
  const from = css.indexOf(start)
  const to = css.indexOf(end, from)
  if (from < 0 || to <= from) {
    throw new Error(`globals.css has no section from "${start}" to "${end}"`)
  }
  return css.slice(from, to)
}

/* The block appended for the ring, isolated so a stray `data-slot` elsewhere
   in the file cannot satisfy any of this. */
const block = section(
  "[data-slot='mix-chart'] [data-slot='segment']",
  "[data-slot='alloc-chart'] [data-slot='alloc-segment']",
)

describe('the ring’s hover rules', () => {
  test('the arcs are set up to transition both the fade and the pop', () => {
    const base = block.slice(0, block.indexOf('}'))
    expect(base).toContain('transform-box: view-box')
    expect(base).toContain('transform-origin: 50% 50%')
    // Exhaustive property list: a pop left out of it would snap while the
    // fade eased.
    expect(base).toMatch(/transition:[^;]*fill-opacity/)
    expect(base).toMatch(/transition:[^;]*transform\s+\d+ms/)
  })

  test('pointing anywhere recedes the ring', () => {
    expect(block).toMatch(
      /\[data-slot='mix-chart'\]\[data-active\] \[data-slot='segment'\] \{\s*fill-opacity: 0\.6;/,
    )
  })

  /**
   * **The pop is the subject.** Dimming alone inverted the feedback — the eye
   * tracks change, so the arcs that faded read as the selection and the one
   * under the pointer read as inert. Reported as "it feels like i am selecting
   * them".
   */
  test('and the arc under the pointer comes back and grows', () => {
    const pop = block.slice(block.indexOf("[data-active='0']"))
    const decls = pop.slice(pop.indexOf('{'), pop.indexOf('}'))
    expect(decls).toContain('fill-opacity: 1')
    expect(decls).toContain('transform: scale(1.05)')
  })

  /**
   * One rule per arc, and the ring can draw `MAX_SLICES` of them. Derived from
   * the constant rather than written as 4, so adding a fifth slice fails here
   * instead of shipping an arc that cannot be popped.
   */
  test('every arc the ring can draw has a rule, and none beyond that', () => {
    const pairs = [...block.matchAll(/\[data-active='(\d+)'\] \[data-slot='segment'\]\[data-index='(\d+)'\]/g)]
    expect(pairs).toHaveLength(MAX_SLICES)
    // Paired with ITSELF, index for index: a transposed pair would pop the
    // wrong arc and still count correctly.
    expect(pairs.map((m) => m[1])).toEqual([...Array(MAX_SLICES).keys()].map(String))
    expect(pairs.map((m) => m[2])).toEqual(pairs.map((m) => m[1]))
  })

  /* Pointing at either the ring or the legend moves both, so a mismatch in
     tempo would be visible on every hover. The legend row's `duration-300` is
     asserted in `account-donut.test.tsx`. */
  test('the ring runs on the same 300ms clock as the legend row beside it', () => {
    const durations = [...block.matchAll(/(\d+)ms/g)].map((m) => m[1])
    expect(durations.length).toBeGreaterThan(0)
    expect(new Set(durations)).toEqual(new Set(['300']))
  })

  /* The state still changes for a reader who asked for no motion; it just does
     not glide. */
  test('and stands still for a reader who asked for no motion', () => {
    const reduced = block.slice(block.indexOf('@media (prefers-reduced-motion: reduce)'))
    expect(reduced).toContain("[data-slot='mix-chart'] [data-slot='segment']")
    expect(reduced).toContain('transition: none')
  })
})


/**
 * The allocation ring's rules — the same effect, keyed by CLASS. The ring
 * draws only positive classes and the bars beneath draw all of them, so index
 * would not line up; the class key does. One rule per class in the closed
 * list, derived from that list so a ninth class fails here rather than
 * shipping an arc that cannot be popped.
 */
describe('the allocation ring’s hover rules', () => {
  const alloc = section(
    "[data-slot='alloc-chart'] [data-slot='alloc-segment']",
    "[data-slot='value-chart'] .recharts-bar-rectangle path",
  )

  test('exist, after the investment ring’s, on the same clock', () => {
    expect(alloc.length).toBeGreaterThan(0)
    expect(alloc).toMatch(/\[data-slot='alloc-chart'\]\[data-active\] \[data-slot='alloc-segment'\] \{\s*fill-opacity: 0\.6;/)
    const durations = [...alloc.matchAll(/(\d+)ms/g)].map((m) => m[1])
    expect(new Set(durations)).toEqual(new Set(['300']))
  })

  test('cover every asset class, paired with itself, and none beyond', () => {
    const pairs = [...alloc.matchAll(/\[data-active='([a-z_]+)'\] \[data-slot='alloc-segment'\]\[data-class='([a-z_]+)'\]/g)]
    expect(pairs.map((m) => m[1]).sort()).toEqual([...ASSET_CLASSES].sort())
    expect(pairs.map((m) => m[2])).toEqual(pairs.map((m) => m[1]))
  })

  test('and stand still for a reader who asked for no motion', () => {
    expect(alloc).toMatch(/prefers-reduced-motion: reduce\)[\s\S]*\[data-slot='alloc-chart'\] \[data-slot='alloc-segment'\] \{\s*transition: none;/)
  })

  /* The investment ring's census must not have been widened by the new rules:
     they use a different segment slot precisely so the two counts stay apart. */
  test('and do not leak into the investment ring’s census', () => {
    const mixBlock = css.slice(css.indexOf("[data-slot='mix-chart'] [data-slot='segment']"))
    const pairs = [...mixBlock.matchAll(/\[data-active='(\d+)'\] \[data-slot='segment'\]\[data-index='(\d+)'\]/g)]
    expect(pairs).toHaveLength(MAX_SLICES)
  })
})

/**
 * The value chart's hover rules — keyed on Recharts' own `recharts-active-bar`
 * rather than a frame attribute, because with `activeBar` set the library
 * marks the hovered bar itself. `value-bars.test.tsx` proves the class
 * appears; only this can prove the rules exist.
 */
describe('the value chart’s hover rules', () => {
  const bars = section("[data-slot='value-chart'] .recharts-bar-rectangle path", '.qw-field')

  test('exist: the rest recede and the active bar comes forward', () => {
    expect(bars.length).toBeGreaterThan(0)
    expect(bars).toMatch(
      /\[data-slot='value-chart'\]:has\(\.recharts-active-bar\) \.recharts-bar-rectangle path \{\s*fill-opacity: 0\.55;/,
    )
    expect(bars).toMatch(/\[data-slot='value-chart'\] \.recharts-active-bar path \{\s*fill-opacity: 1;/)
  })

  test('on the rings’ clock', () => {
    const durations = [...bars.matchAll(/(\d+)ms/g)].map((m) => m[1])
    expect(durations.length).toBeGreaterThan(0)
    expect(new Set(durations)).toEqual(new Set(['300']))
  })

  test('and stand still for a reader who asked for no motion', () => {
    expect(bars).toMatch(
      /prefers-reduced-motion: reduce\)[\s\S]*\[data-slot='value-chart'\] \.recharts-bar-rectangle path \{\s*transition: none;/,
    )
  })
})
