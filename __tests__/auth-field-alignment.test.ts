import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, test } from 'vitest'

/**
 * Every field in the sign-in flows reads LEFT, and this is the test that says so.
 *
 * ## The rule
 *
 * Given on 20 September 2026: **inputs and their labels are always left-aligned;
 * everything else in a sign-in flow is typically centred.** The card those forms
 * sit in centres itself for its logo, heading and description, which is right —
 * but a field inherits that, and a label centred over its own input reads as a
 * caption rather than as the name of the box beneath it.
 *
 * ## Why a class scan, and not a rendering test
 *
 * The alignment comes from an ANCESTOR. jsdom has no layout engine and does not
 * resolve inherited CSS, so a render test here would measure nothing — the same
 * reason `modal-centring.test.ts` scans classes instead of rendering. The
 * browser suite measures the real computed value, but only on the two screens an
 * anonymous visitor can reach: `/mfa` and `/mfa/enrol` both require a session it
 * has no fixture for. **This file is what covers those**, and what catches a
 * field added to any of these forms later without the class.
 *
 * ## The history
 *
 * Fixed the wrong way first. The request-access labels were found centred and
 * the whole card's children were left-aligned to correct it — which dragged the
 * enrolment instructions and QR block left with them. The rule is per field, not
 * per screen.
 */
const FORMS = [
  'app/login/login-form.tsx',
  'app/mfa/challenge-form.tsx',
  'components/request-access-form.tsx',
]

const source = (f: string) => readFileSync(resolve(__dirname, '..', f), 'utf8')

/** Every `<label className="...">` in a file, with its class string. */
const labelsIn = (f: string) => [...source(f).matchAll(/<label className="([^"]*)"/g)].map((m) => m[1]!)

describe('fields in the sign-in flows', () => {
  /* If this found nothing, every assertion below would be vacuously true — the
     one way this file could quietly stop testing anything. */
  test('the scan finds the labels it is meant to be checking', () => {
    const counts = FORMS.map((f) => labelsIn(f).length)
    expect(counts, 'a form with no labels means the regex stopped matching').not.toContain(0)
    expect(counts.reduce((a, b) => a + b, 0)).toBeGreaterThanOrEqual(7)
  })

  test('every label carries qw-field, so it reads left wherever the card centres', () => {
    for (const file of FORMS) {
      for (const classes of labelsIn(file)) {
        expect(classes.split(/\s+/), `${file}: a label without qw-field will centre`).toContain('qw-field')
      }
    }
  })

  /* A message about a field belongs above that field's left edge, not floating
     in the middle of the card. A message about how somebody ARRIVED is not a
     field error and stays centred — see the login page's arrival notice. */
  test('a field error reads left too', () => {
    for (const file of FORMS) {
      for (const [, classes] of source(file).matchAll(/<p role="alert" className="([^"]*)"/g)) {
        expect(classes!.split(/\s+/), `${file}: a field error should align with its fields`).toContain('qw-field')
      }
    }
  })

  test('the class is defined once, in the stylesheet, rather than per form', () => {
    const css = source('app/globals.css')
    expect(css).toMatch(/\.qw-field\s*\{[^}]*text-align:\s*left/)
  })

  /**
   * The card must NOT left-align its whole contents. That was the first attempt
   * and it is what this file exists to stop coming back: it takes the enrolment
   * panel's prose and QR block with it.
   */
  test('the shell still centres everything that is not a field', () => {
    const shell = source('components/auth-shell.tsx')
    expect(shell, 'the card itself centres').toContain('text-center')
    expect(shell.match(/<div className="mt-6[^"]*">\{children\}<\/div>/)?.[0]).toBe(
      '<div className="mt-6">{children}</div>',
    )
  })

  /**
   * Two deliberate exceptions, pinned so that removing one is a decision rather
   * than a side effect: a six-digit code is centred in its own box. It is one
   * control, not the rule.
   */
  test('the six-digit code boxes still centre their digits', () => {
    expect(source('app/mfa/challenge-form.tsx')).toMatch(/autoComplete="one-time-code"[\s\S]{0,400}?text-center/)
  })
})
