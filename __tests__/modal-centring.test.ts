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

  /**
   * **Horizontally**, and that is the whole rule — a modal may sit wherever it
   * likes vertically, but nothing should ever open against the left edge.
   *
   * Written as "auto on both sides" rather than as the literal class `m-auto`,
   * which is what it said first. The search modal then moved to sit high on the
   * page and took `mx-auto mb-auto mt-[10vh]` — correctly centred, and the test
   * failed anyway, because it was checking a spelling rather than the property.
   */
  test('centres itself across the window, rather than relying on the browser', () => {
    for (const { file, classes } of modalClasses) {
      const centred = /\bm-auto\b/.test(classes) || /\bmx-auto\b/.test(classes)
      expect(centred, `${file} opens against the left edge`).toBe(true)
    }
  })

  /**
   * A modal that pins its top has given up `m-auto`, and preflight's zero is
   * what the other margins fall back to — so the bottom has to be named or the
   * dialog stretches to the foot of the window instead of taking the height of
   * what is in it.
   */
  test('and a modal that pins its top names its bottom too', () => {
    for (const { file, classes } of modalClasses) {
      if (!/\bmt-\[/.test(classes)) continue
      expect(classes, `${file} pins its top and will stretch downward`).toMatch(/\bmb-auto\b/)
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
