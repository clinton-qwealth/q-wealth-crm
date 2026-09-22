/**
 * The Content Security Policy, as one pure function.
 *
 * Here rather than in `next.config.ts` because the script source is a
 * per-request nonce, and a config file is evaluated once at build. The proxy
 * generates the nonce, puts this string on the REQUEST headers so Next.js can
 * read it back and stamp the same nonce onto its own script tags, and on the
 * response so the browser enforces it.
 *
 * ## Why every directive is the way it is
 *
 * **`script-src` carries `'strict-dynamic'`**, which makes CSP3 browsers ignore
 * `'self'` and trust only what the nonced script itself loads. That is exactly
 * how Next serves a page: one bootstrap script, which pulls every chunk. The
 * effect is that an injected `<script src="/_next/…">` — same origin, so `'self'`
 * would have allowed it — is refused, because it did not come from the
 * bootstrap. `'self'` stays in the list for browsers too old to know
 * `'strict-dynamic'`, where it is the fallback rather than the rule.
 *
 * **`style-src` allows `'unsafe-inline'`, and that is a real concession.** Eight
 * components size bars and donuts with `style={{ width }}`, Recharts writes
 * inline style on the SVG it draws, TipTap styles the editor as you type, and
 * `next/font` injects a `<style>` block. CSP treats an inline style ATTRIBUTE as
 * inline style, so the alternative is not "a bit of work" but rewriting every
 * computed dimension as a class. `'unsafe-hashes'` would cover the attributes
 * and is not reliably implemented. What this gives up is narrow — style
 * injection can reposition or hide things, it cannot execute — and it buys the
 * script protections above, which are the ones that matter.
 *
 * **`connect-src` names Supabase because the browser talks to it directly**:
 * PostgREST, GoTrue, and `kb-search` on the functions subpath, all on the one
 * origin. Google Places is absent on purpose — the address lookup goes through
 * `/api/address` on this server, so the browser never reaches Google.
 *
 * **`img-src` needs `data:` for the MFA QR code** (Supabase Auth returns the
 * enrolment barcode as a data URI) and the Supabase origin because an avatar or
 * a post attachment is a redirect to a signed Storage URL on that host.
 *
 * **`upgrade-insecure-requests` only in production.** On `http://localhost` it
 * would upgrade the dev server's own requests to HTTPS, which nothing is
 * listening for.
 *
 * `frame-ancestors 'none'` is the one that matters beyond XSS: it is what stops
 * this CRM being framed by another page, which is how a CSRF that Server
 * Actions' origin check would otherwise catch gets performed by a real user's
 * own click.
 */
export function contentSecurityPolicy(options: {
  nonce: string
  /** The Supabase origin the browser calls directly. */
  supabaseUrl: string
  production: boolean
}): string {
  const { nonce, supabaseUrl, production } = options
  // The origin only. A CSP source with a path would still match the whole
  // origin for connect-src, so carrying one is noise that reads like a limit.
  const supabase = originOf(supabaseUrl)

  const directives: [string, string[]][] = [
    ['default-src', ["'self'"]],
    [
      'script-src',
      [
        "'self'",
        `'nonce-${nonce}'`,
        "'strict-dynamic'",
        // Next's dev server compiles with eval. Never in a deployed build.
        ...(production ? [] : ["'unsafe-eval'"]),
      ],
    ],
    ['style-src', ["'self'", "'unsafe-inline'"]],
    ['img-src', ["'self'", 'data:', 'blob:', supabase]],
    ['font-src', ["'self'"]],
    ['connect-src', ["'self'", supabase]],
    ['worker-src', ["'self'", 'blob:']],
    ['manifest-src', ["'self'"]],
    // Nothing here embeds anything, and nothing may embed this.
    ['frame-src', ["'none'"]],
    ['frame-ancestors', ["'none'"]],
    ['object-src', ["'none'"]],
    // A form that posts elsewhere, or a <base> that re-points every relative
    // URL, are both ways to exfiltrate without running a script.
    ['form-action', ["'self'"]],
    ['base-uri', ["'self'"]],
  ]

  const rendered = directives.map(([name, sources]) => `${name} ${sources.join(' ')}`)
  if (production) rendered.push('upgrade-insecure-requests')
  return rendered.join('; ')
}

/** The scheme and host of a URL, or the input unchanged if it will not parse. */
function originOf(url: string): string {
  try {
    return new URL(url).origin
  } catch {
    return url
  }
}
