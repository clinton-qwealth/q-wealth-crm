import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, test } from 'vitest'

/**
 * The live indicator — the small green light beside a signed-in person's name.
 *
 * ## Why a class scan
 *
 * jsdom has no layout engine and does not run animations, so a render test here
 * would measure nothing. The same reasoning as `modal-centring.test.ts`: a rule
 * that lives in a stylesheet is asserted in the stylesheet.
 *
 * ## What is actually worth pinning
 *
 * **The pulse must not cost layout.** It is drawn by a `::after` that scales to
 * 2.6×. If that ring were in flow it would push the name it sits beside every
 * time it breathed — on every row of the list at once. `position: absolute`
 * inside a `position: relative` dot is what keeps it free, and nothing else in
 * the file says so.
 *
 * **The motion is optional; the information is not.** Under
 * `prefers-reduced-motion` the animation stops and the dot stays. Hiding the
 * indicator instead would take the fact away from the person who asked for less
 * movement, which is not what the preference means.
 */
const css = readFileSync(resolve(__dirname, '..', 'app/globals.css'), 'utf8')

/** The `.qw-live` rule bodies, so a match cannot come from a neighbouring rule. */
const ruleFor = (selector: string) => {
  const at = css.indexOf(`${selector} {`)
  expect(at, `${selector} is defined`).toBeGreaterThan(-1)
  return css.slice(at, css.indexOf('}', at))
}

describe('the live indicator', () => {
  test('is a fixed-size round dot, so it can sit in a truncating name column', () => {
    const dot = ruleFor('.qw-live')
    expect(dot).toMatch(/width:\s*0\.5rem/)
    expect(dot).toMatch(/height:\s*0\.5rem/)
    expect(dot).toMatch(/border-radius:\s*9999px/)
  })

  test('the pulse is absolutely positioned inside a relative dot, so it costs no layout', () => {
    expect(ruleFor('.qw-live')).toMatch(/position:\s*relative/)
    const ring = ruleFor('.qw-live::after')
    expect(ring).toMatch(/position:\s*absolute/)
    expect(ring).toMatch(/animation:\s*qw-live-pulse/)
  })

  /* It grows and fades out, then waits. A ring that is always mid-flight reads
     as a spinner — something loading — rather than as a steady state. */
  test('the ring fades to nothing and rests before the next pulse', () => {
    /* Bounded at the reduced-motion block that follows it, not left running to
       the end of the file — see the note on `at` below. */
    const from = css.indexOf('@keyframes qw-live-pulse')
    const frames = css.slice(from, css.indexOf('@media (prefers-reduced-motion: reduce)', from))
    /* Anchored on the semicolon: a bare `opacity: 0` pattern also matches
       `opacity: 0.4`, which is a ring that never disappears — the exact fault
       this asserts against. A mutation proved it. */
    expect(frames).toMatch(/70%,\s*100%\s*\{[^}]*opacity:\s*0\s*;/)
    expect(frames).toMatch(/transform:\s*scale\(2\.6\)/)
  })

  test('reduced motion stops the pulse and keeps the light', () => {
    /* The reduced-motion block that holds THIS rule, found by working back
       from the rule itself — not `lastIndexOf`, which meant "the last one in
       the file" and silently became someone else's block the day another
       animation was appended below. The slice then came back empty and the
       test failed claiming the animation was not turned off, which was both
       true of the wrong block and useless.

       The second `.qw-live::after` is the one inside the media query; the
       first is the rule that starts the pulse, above the keyframes. */
    const ringWhenReduced = css.indexOf('.qw-live::after', css.indexOf('@keyframes qw-live-pulse'))
    const at = css.lastIndexOf('@media (prefers-reduced-motion: reduce)', ringWhenReduced)
    expect(at, 'the rule sits inside a reduced-motion block').toBeGreaterThan(-1)
    const block = css.slice(at, css.indexOf('\n}', ringWhenReduced))
    expect(block, 'the animation is turned off').toMatch(/animation:\s*none/)
    expect(block, 'the dot itself is not hidden — that would remove the fact').not.toMatch(
      /\.qw-live\s*\{[^}]*display:\s*none/,
    )
  })
})
