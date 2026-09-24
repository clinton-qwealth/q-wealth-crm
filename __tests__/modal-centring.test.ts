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

/**
 * EVERY `<dialog>` IN THE COMPONENTS, not every dialog that already opted in.
 *
 * This scanned for `className="...qw-modal..."` until 24 September 2026, which
 * made it blind to the only mistake it exists to catch. Three dialogs — the
 * template builder's Add a task, Administration's New workflow template, and
 * Use a workflow template — were written without `qw-modal` at all, so the scan
 * never saw them, every assertion below passed, and all three opened hard
 * against the top-left corner in production until somebody looked at one.
 *
 * A guard whose selector is the thing being forgotten cannot catch the
 * forgetting. So the scan now starts from the element and works out, and a
 * dialog carrying neither class is itself a failure.
 */
/** Source with comments removed, so a `<dialog>` written in prose is not scanned. */
function code(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
}

/**
 * The attributes of each real `<dialog>` opening tag.
 *
 * Walked brace-aware rather than matched with `[^>]*`, which was the first
 * attempt and found NOTHING: every one of these tags contains
 * `onClick={(e) => ...}`, and the `>` of the arrow ends that character class
 * immediately. A scan that silently matches nothing is the same failure this
 * file is about, one level up — so the count assertion below is what catches it.
 */
function dialogTags(source: string): string[] {
  const src = code(source)
  const tags: string[] = []
  let i = 0
  for (;;) {
    i = src.indexOf('<dialog', i)
    if (i === -1) break
    i += '<dialog'.length
    const next = src[i]
    /* `<dialog>` with no attributes is not one of ours. */
    if (next === undefined || !/\s/.test(next)) continue
    let depth = 0
    let j = i
    for (; j < src.length; j += 1) {
      const c = src[j]
      if (c === '{') depth += 1
      else if (c === '}') depth -= 1
      else if (c === '>' && depth === 0) break
    }
    tags.push(src.slice(i, j))
    i = j
  }
  return tags
}

const dialogs = files.flatMap((file) =>
  dialogTags(readFileSync(resolve(dir, file), 'utf8')).map((attrs) => {
    /* Handles both `className="…"` and `className={\`…\`}` — the drawer builds
       its class from a template literal, and the first version of this regex
       captured an empty string for it and reported it as unclassified. */
    const cls = /className=\{?\s*["`]([^"`]*)/.exec(attrs)
    return { file, attrs, classes: cls ? cls[1] : '', hasClassName: /className=/.test(attrs) }
  }),
)

/** A centred modal. Drawers slide in from the edge and are a different thing. */
const modalClasses = dialogs.filter((d) => /\bqw-modal\b/.test(d.classes))

describe('every modal dialog', () => {
  /* If this finds nothing the assertions below are all vacuously true, which is
     the one way this file could quietly stop testing anything. */
  test('there are modals to check, and the scan found them', () => {
    expect(modalClasses.length).toBeGreaterThanOrEqual(7)
    expect(new Set(modalClasses.map((m) => m.file)).size).toBeGreaterThanOrEqual(7)
  })

  /**
   * THE ASSERTION THE OLD SCAN COULD NOT MAKE.
   *
   * Every `<dialog>` is one of two things: a centred modal (`qw-modal`) or a
   * slide-in panel (`qw-drawer`). A dialog wearing neither has no transition, no
   * backdrop and — because Tailwind's preflight zeroes its margin — no centring
   * either. Naming both means a new kind of panel has to be a deliberate
   * decision here rather than an omission over there.
   *
   * Mutation, and it was run: drop `qw-modal` from template-editor.tsx and this
   * fails naming that file.
   */
  test('is a modal or a drawer, and says which', () => {
    for (const { file, classes, hasClassName } of dialogs) {
      expect(hasClassName, `${file} has a <dialog> with no className at all`).toBe(true)
      const kind = /\bqw-modal\b/.test(classes) || /\bqw-drawer\b/.test(classes)
      expect(kind, `${file} has a <dialog> that is neither qw-modal nor qw-drawer`).toBe(true)
    }
  })

  /* A dialog that opens is a dialog somebody must be able to name. */
  test('and carries an accessible name', () => {
    for (const { file, attrs } of dialogs) {
      expect(
        /aria-labelledby=|aria-label=/.test(attrs),
        `${file} opens a dialog with no accessible name`,
      ).toBe(true)
    }
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
