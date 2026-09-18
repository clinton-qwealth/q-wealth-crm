import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, test } from 'vitest'

/**
 * The allocation ring in the account drawer is the investment ring on the
 * group page, drawn again: asked for on 18 September as "follow the same chart
 * styling as what we put on the group page". Same band, same gap, same cap
 * roundness, same draw-in, same box.
 *
 * ## Why a source scan
 *
 * The two components hold their geometry as module-private constants, on
 * purpose — nothing else needs them, and exporting a number so a test can read
 * it is how a private detail becomes a public one. And jsdom has no layout
 * engine, so nothing can measure a rendered arc against another. What CAN be
 * checked is that the two files say the same numbers, which is what "the same
 * styling" means at the level of source. This is the house idiom for a shape
 * that lives in two files (`field-box`, `qw-drawer`): a census, so a nudge to
 * one that misses the other fails here instead of shipping two rings that are
 * nearly alike.
 *
 * If the two are ever MEANT to differ, this test is where that decision gets
 * written down.
 */
const read = (f: string) => readFileSync(resolve(process.cwd(), f), 'utf8')
const investment = read('components/account-donut.tsx')
const allocation = read('components/allocation-donut.tsx')

const constant = (src: string, name: string) => {
  const m = src.match(new RegExp(`const ${name} = ([^\n]+)`))
  if (!m) throw new Error(`${name} is not a top-level const in this file`)
  return m[1].trim()
}

describe('the allocation ring, against the investment ring', () => {
  test.each(['SIZE', 'INNER_RADIUS', 'OUTER_RADIUS', 'GAP_DEGREES', 'CAP_ROUNDNESS', 'RING_BOX', 'FLUID'])(
    '%s is the same number',
    (name) => {
      expect(constant(allocation, name)).toBe(constant(investment, name))
    },
  )

  /* The band is DERIVED from the radii in both, not written as 40.8 in either. */
  test('the band is derived, not copied', () => {
    for (const src of [investment, allocation]) {
      expect(constant(src, 'BAND')).toBe('((OUTER_RADIUS - INNER_RADIUS) * SIZE) / 2')
    }
  })

  test('both draw in over the same time, from twelve, honouring reduced motion', () => {
    for (const src of [investment, allocation]) {
      expect(src).toContain('isAnimationActive="auto"')
      expect(src).toContain('animationDuration={650}')
      expect(src).toContain('animationBegin={0}')
      expect(src).toContain('startAngle={90}')
      expect(src).toContain('endAngle={-270}')
    }
  })

  /* And both are memoised rings: the hover must not remount the arcs. */
  test('both keep their arcs across a hover', () => {
    for (const src of [investment, allocation]) {
      expect(src).toMatch(/const Ring = memo\(function Ring\(/)
    }
  })
})
