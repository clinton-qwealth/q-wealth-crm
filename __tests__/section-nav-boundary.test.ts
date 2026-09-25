import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'

/**
 * Every module that hands `SectionNav` its items must be a client module.
 *
 * `SectionNav` is `'use client'` and its items carry `icon: ComponentType` —
 * a FUNCTION. A server component rendering `<SectionNav items={…}>` has to
 * serialise those props across the boundary, functions do not serialise, and
 * Next refuses the whole page at request time: "Functions cannot be passed
 * directly to Client Components."
 *
 * Nothing else catches this. jsdom renders with no boundary, so every unit
 * test passes; the pages involved sit behind auth and are never prerendered,
 * so the build passes; and the 10 signed-in e2e tests skip without
 * credentials. It shipped exactly this way on 25 September 2026 — the menus
 * were client components until the SectionNav extraction moved the markup out
 * and the directive silently stopped covering the icon maps left behind.
 * /groups and /admin both threw within minutes.
 *
 * A source scan is the honest tool left: if a file renders SectionNav, its
 * first directive must be 'use client', which keeps the function props on the
 * client side of the boundary where they never need serialising.
 */
describe('SectionNav’s callers', () => {
  const dir = 'components'
  const callers = readdirSync(dir)
    .filter((f) => f.endsWith('.tsx') && f !== 'section-nav.tsx')
    .filter((f) => readFileSync(join(dir, f), 'utf8').includes('<SectionNav'))

  test('exist, so the scan below is checking something', () => {
    expect(callers.length).toBeGreaterThanOrEqual(2)
  })

  test('every one is a client module, so its icon functions never cross a boundary', () => {
    const serverSide = callers.filter(
      (f) => !readFileSync(join(dir, f), 'utf8').trimStart().startsWith("'use client'"),
    )
    expect(serverSide, 'these pass component functions across an RSC boundary').toEqual([])
  })
})
