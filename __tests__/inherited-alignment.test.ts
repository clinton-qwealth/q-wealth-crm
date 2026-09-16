import { readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, test } from 'vitest'

/**
 * `text-align` is inherited, and this file is the defence against that.
 *
 * ## The bug, reported 16 September 2026
 *
 * Adding the FIRST record to a section opened a form whose every label and
 * heading was centred. Adding a second record, and every one after, opened the
 * same form left-aligned. Nothing in the modal differed between the two.
 *
 * The cause is two ordinary decisions meeting:
 *
 * 1. Each empty state is `flex flex-col items-center ... text-center`, so its
 *    two paragraphs sit centred under the dashed border. Reasonable on its own.
 * 2. Each add-modal renders `<>{trigger}<dialog>…</dialog></>` — the trigger
 *    and the dialog together — and is handed to the empty state as its
 *    `emptyAction`. Also reasonable on its own.
 *
 * Put together, the `<dialog>` is a DOM descendant of a `text-center` element.
 * **The top layer changes where a dialog PAINTS, not where it lives**, so it
 * inherits the centring like any other child. Once a record exists the empty
 * state is gone, the toolbar renders the same trigger under no such container,
 * and the form is left-aligned — which is why it looked like a first-time-only
 * anomaly rather than a stylesheet rule.
 *
 * ## Why it is tested here and not by rendering
 *
 * jsdom has no CSS engine. It will not apply `globals.css`, and it will not
 * compute an inherited `text-align` from an ancestor's class either, so a
 * render test cannot see this defect at all — which is precisely why it shipped.
 * The honest check is on the source, the same limit `mix-hover-css` and
 * `modal-centring` work within.
 *
 * Two independent guards, because they fail differently:
 *   - the stylesheet rule protects every dialog under ANY ancestor, including
 *     ones nobody has written yet;
 *   - the container rule stops the house empty state imposing alignment on
 *     content a caller handed it, dialog or otherwise.
 */

const componentsDir = resolve(__dirname, '../components')
const appDir = resolve(__dirname, '../app')

/** Every `.tsx` under `components/` and `app/`, at any depth. */
function tsxFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = resolve(dir, entry.name)
    if (entry.isDirectory()) return tsxFiles(full)
    return entry.name.endsWith('.tsx') ? [full] : []
  })
}

const files = [...tsxFiles(componentsDir), ...tsxFiles(appDir)]
const css = readFileSync(resolve(__dirname, '../app/globals.css'), 'utf8')

describe('a dialog does not inherit its trigger’s text alignment', () => {
  /* Both shared dialog classes, because a drawer is mounted the same way and
     would inherit the same centring from the same kind of ancestor. */
  test.each(['qw-modal', 'qw-drawer'])('dialog.%s declares its own text-align', (cls) => {
    const block = css.match(new RegExp(`dialog\\.${cls}\\s*\\{[^}]*\\}`))
    expect(block, `no dialog.${cls} rule in globals.css`).not.toBeNull()
    expect(block![0], `dialog.${cls} inherits text-align from wherever it is mounted`).toMatch(
      /text-align:\s*left/,
    )
  })
})

describe('the house empty state', () => {
  /**
   * Every dashed empty state, found by its border rather than by filename, so
   * a new one written by copying an old one is covered the day it is added.
   *
   * Matched on `<div`, not on any element: the rule is about a CONTAINER
   * imposing alignment on its children. A `<p>` that centres its own text has
   * no children to impose on and is left alone — the Kanban board's empty lane
   * is one, and it is correct as it stands.
   */
  const dashedContainers = files.flatMap((file) => {
    const source = readFileSync(file, 'utf8')
    return [...source.matchAll(/<div\s+className="([^"]*\bborder-dashed\b[^"]*)"/g)].map((m) => ({
      file: file.replace(`${resolve(__dirname, '..')}/`, ''),
      classes: m[1],
    }))
  })

  /* Without this the assertion below is vacuously true, which is the one way
     this file could quietly stop testing anything. Six at the time of writing:
     the two data sections, workflow notes, workflow cards, the task list, the
     unbuilt activity history and the groups index. */
  test('there are empty states to check, and the scan found them', () => {
    expect(dashedContainers.length).toBeGreaterThanOrEqual(6)
  })

  test('centres its own paragraphs, never everything a caller hands it', () => {
    for (const { file, classes } of dashedContainers) {
      expect(
        classes,
        `${file} sets text-center on a container, so a modal passed as emptyAction ` +
          `will open with every label centred`,
      ).not.toMatch(/\btext-center\b/)
    }
  })

  /**
   * The centring still has to happen, or the fix above is just a regression
   * with a test beside it. The paragraphs say `text-center` themselves now, so
   * the empty state looks exactly as it did before.
   *
   * Scoped to the house shape — `flex-col` AND `items-center` AND dashed —
   * because a dashed container is not always an empty state. The member panel's
   * notes placeholder is a dashed box holding one short line centred by
   * flexbox, with no wrapping text to align and nothing to assert about.
   */
  const houseEmptyStates = files.filter((file) =>
    /<div\s+className="[^"]*\bflex-col\b[^"]*\bitems-center\b[^"]*\bborder-dashed\b/.test(
      readFileSync(file, 'utf8'),
    ),
  )

  test('and the paragraphs inside it still centre themselves', () => {
    expect(houseEmptyStates.length).toBeGreaterThanOrEqual(6)
    for (const file of houseEmptyStates) {
      expect(
        readFileSync(file, 'utf8'),
        `${file.replace(`${resolve(__dirname, '..')}/`, '')} has a dashed empty state whose ` +
          `text no longer centres`,
      ).toMatch(/<p className="[^"]*\btext-center\b/)
    }
  })
})
