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
    const frames = css.slice(css.indexOf('@keyframes qw-live-pulse'))
    /* Anchored on the semicolon: a bare `opacity: 0` pattern also matches
       `opacity: 0.4`, which is a ring that never disappears — the exact fault
       this asserts against. A mutation proved it. */
    expect(frames).toMatch(/70%,\s*100%\s*\{[^}]*opacity:\s*0\s*;/)
    expect(frames).toMatch(/transform:\s*scale\(2\.6\)/)
  })

  test('reduced motion stops the pulse and keeps the light', () => {
    const at = css.lastIndexOf('@media (prefers-reduced-motion: reduce)')
    const block = css.slice(at, css.indexOf('\n}', css.indexOf('.qw-live::after', at)))
    expect(block, 'the animation is turned off').toMatch(/animation:\s*none/)
    expect(block, 'the dot itself is not hidden — that would remove the fact').not.toMatch(
      /\.qw-live\s*\{[^}]*display:\s*none/,
    )
  })
})
