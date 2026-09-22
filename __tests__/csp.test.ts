import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import { contentSecurityPolicy } from '@/lib/csp'

/**
 * The policy string. The browser-level proof that it admits what Next.js needs
 * is `e2e/security-headers.spec.ts`; these pin the individual decisions, each
 * with the edit it exists to catch.
 */
const policy = (production = true) =>
  contentSecurityPolicy({ nonce: 'NONCE', supabaseUrl: 'https://abc.supabase.co/', production })

const directive = (name: string, production = true) =>
  policy(production)
    .split('; ')
    .find((d) => d.startsWith(`${name} `)) ?? ''

describe('scripts', () => {
  /**
   * `'strict-dynamic'` is what makes this policy worth having: without it,
   * `'self'` admits ANY same-origin script tag an injection can write.
   * Mutation: drop it → an injected `<script src="/_next/…">` is allowed.
   */
  test('only the nonced bootstrap, and what it loads', () => {
    expect(directive('script-src')).toContain("'nonce-NONCE'")
    expect(directive('script-src')).toContain("'strict-dynamic'")
  })

  /**
   * Next's dev server compiles with eval and cannot run without it; a deployed
   * build must never carry it. Mutation: make it unconditional → fails.
   */
  test('eval is a development-only allowance', () => {
    expect(directive('script-src', false)).toContain("'unsafe-eval'")
    expect(directive('script-src', true)).not.toContain("'unsafe-eval'")
  })

  test('no inline script, ever', () => {
    expect(directive('script-src')).not.toContain("'unsafe-inline'")
  })
})

describe('the concessions, held to exactly what needs them', () => {
  /**
   * Inline STYLE is allowed because eight components size things with
   * `style={{…}}` and Recharts and TipTap write their own. Inline SCRIPT is
   * not. Mutation: widen this to script-src → the previous test fails.
   */
  test('inline style is allowed and inline script is not', () => {
    expect(directive('style-src')).toContain("'unsafe-inline'")
  })
})

describe('where the browser may talk', () => {
  test('Supabase by origin, with any path dropped', () => {
    expect(directive('connect-src')).toBe("connect-src 'self' https://abc.supabase.co")
  })

  /**
   * Google Places is reached through /api/address on this server, so the
   * browser never contacts it. Mutation: add it "to be safe" → fails, because
   * a source nobody needs is a source an exfiltration can use.
   */
  test('nothing else, and specifically not Google', () => {
    expect(policy()).not.toContain('googleapis')
  })

  /** data: is the MFA enrolment QR; the Supabase origin is a signed Storage
   *  redirect for an avatar or an attachment. */
  test('images: self, data, blob and Supabase', () => {
    expect(directive('img-src')).toBe("img-src 'self' data: blob: https://abc.supabase.co")
  })
})

describe('the directives that are not about XSS', () => {
  /**
   * The clickjacking control, and the reason CSP closes a CSRF gap that Server
   * Actions' origin check does not: a framed CRM is acted on by a real user's
   * real click. Mutation: drop it → fails.
   */
  test('this site may not be framed, and frames nothing', () => {
    expect(directive('frame-ancestors')).toBe("frame-ancestors 'none'")
    expect(directive('frame-src')).toBe("frame-src 'none'")
  })

  /** Both are script-free exfiltration routes. */
  test('forms post here and <base> cannot be repointed', () => {
    expect(directive('form-action')).toBe("form-action 'self'")
    expect(directive('base-uri')).toBe("base-uri 'self'")
    expect(directive('object-src')).toBe("object-src 'none'")
  })

  /** On http://localhost it would upgrade the dev server's own requests to a
   *  port nothing is listening on. */
  test('insecure requests are upgraded only in production', () => {
    expect(policy(true)).toContain('upgrade-insecure-requests')
    expect(policy(false)).not.toContain('upgrade-insecure-requests')
  })
})

describe('the proxy is the only place this can be set', () => {
  /**
   * Next reads the nonce off the RESPONSE header and stamps it onto its script
   * tags — measured on 16.3.4, see the note in proxy.ts. Every response the
   * proxy can return therefore has to carry it; a path that returns one
   * without it serves scripts the browser will refuse. Mutation: drop either
   * → fails here, and the browser test catches it for real.
   */
  test('every response the proxy returns carries the policy', () => {
    const src = readFileSync(join(process.cwd(), 'proxy.ts'), 'utf8')
    expect(src).toMatch(/response\.headers\.set\('Content-Security-Policy', csp\)/)
    expect(src).toMatch(/redirect\.headers\.set\('Content-Security-Policy', csp\)/)
  })

  test('the nonce is from the platform CSPRNG, not Math.random', () => {
    const src = readFileSync(join(process.cwd(), 'proxy.ts'), 'utf8')
    expect(src).toMatch(/crypto\.getRandomValues/)
    expect(src).not.toMatch(/Math\.random/)
  })
})

describe('the constant headers', () => {
  const config = readFileSync(join(process.cwd(), 'next.config.ts'), 'utf8')
  test.each([
    ['X-Frame-Options', 'DENY'],
    ['X-Content-Type-Options', 'nosniff'],
    ['Referrer-Policy', 'strict-origin-when-cross-origin'],
  ])('%s is %s', (key, value) => {
    expect(config).toContain(`key: '${key}', value: '${value}'`)
  })

  test('the permissions that are denied outright', () => {
    for (const feature of ['camera', 'microphone', 'geolocation', 'payment']) {
      expect(config).toContain(`${feature}=()`)
    }
  })
})
