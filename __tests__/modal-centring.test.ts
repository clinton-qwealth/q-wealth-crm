import { readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, test } from 'vitest'

/**
 * Every modal in the app centres itself, and this is the test that says so.
 *
 * ## The failure it guards, which is invisible in the component
 *
 * A browser's own stylesheet centres a modal `<dialog>` with `margin: auto`.
 * **Tailwind's preflight resets every element's margin to zero**, so that
 * centring is gone before any component is written — the dialog falls back to
 * its `inset-inline-start: 0` and opens hard against the left edge of the
 * window.
 *
 * Nothing in the component looks wrong when this happens. There is no missing
 * property to notice, because the property that mattered was in a stylesheet
 * that never mentions dialogs. It was found the only way it can be: somebody
 * opened the search modal and saw it against the left edge.
 *
 * So the rule is checked in the source, the same way the dead-link test checks
 * that every `href` resolves: a class scan, because a rendering test would have
 * to reproduce the browser's own stylesheet to see the difference, and jsdom
 * has no layout engine to measure it with anyway.
 */
const dir = resolve(__dirname, '../components')
const files = readdirSync(dir).filter((f) => f.endsWith('.tsx'))

/** Every `className="..."` string in the components that carries `qw-modal`. */
const modalClasses = files.flatMap((file) => {
  const source = readFileSync(resolve(dir, file), 'utf8')
  return [...source.matchAll(/className="([^"]*\bqw-modal\b[^"]*)"/g)].map((m) => ({
    file,
    classes: m[1],
  }))
})

describe('every modal dialog', () => {
  /* If this finds nothing the assertions below are all vacuously true, which is
     the one way this file could quietly stop testing anything. */
  test('there are modals to check, and the scan found them', () => {
    expect(modalClasses.length).toBeGreaterThanOrEqual(7)
    expect(new Set(modalClasses.map((m) => m.file)).size).toBeGreaterThanOrEqual(7)
  })

  test('centres itself, rather than relying on the browser default', () => {
    for (const { file, classes } of modalClasses) {
      expect(classes, `${file} opens against the left edge`).toContain('m-auto')
    }
  })

  /**
   * One declaration that is already the used width. `w-full` with a
   * `max-width` reins the element back in afterwards, which leaves a state —
   * the moment before the cap applies, and every context where it does not —
   * in which the dialog is full-bleed.
   */
  test('and states one width rather than a width and a cap', () => {
    for (const { file, classes } of modalClasses) {
      expect(classes, `${file} sizes itself in two steps`).toMatch(/\bw-\[min\(/)
      expect(classes, `${file} is full-bleed before its cap applies`).not.toContain('w-full')
    }
  })

  /* Each leaves room either side on a narrow window rather than running to the
     edges, so the backdrop is always visible as a frame. */
  test('and leaves the window a margin on a small screen', () => {
    for (const { file, classes } of modalClasses) {
      expect(classes, `${file} can reach the window's edges`).toContain('calc(100vw-2rem)')
    }
  })
})
