import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Pin the workspace root. There is an unrelated package-lock.json in the home
  // directory, and Turbopack would otherwise infer that as the root and resolve
  // modules from the wrong place.
  turbopack: {
    root: __dirname,
  },

  /**
   * HTTP Strict Transport Security.
   *
   * The companion to the `Secure` attribute now set on the auth cookie in
   * `lib/supabase/cookies.ts`. `Secure` stops the browser SENDING the session
   * over plain HTTP; HSTS stops it MAKING a plain HTTP request in the first
   * place, which closes the one window `Secure` leaves open — the very first
   * navigation, before any redirect to HTTPS has been followed.
   *
   * Deliberately WITHOUT `includeSubDomains` and `preload`. Both are close to
   * irreversible: `includeSubDomains` commits every sibling host under this
   * domain to HTTPS for the life of the max-age, and `preload` hard-codes the
   * domain into browsers' shipped lists, where removal takes months. Neither
   * should be turned on from a config file without first confirming that every
   * subdomain — mail, marketing, anything old — is served over HTTPS today.
   * Adding them later is one line; regretting them is not.
   */
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'Strict-Transport-Security', value: 'max-age=63072000' },

          /* Content-Security-Policy is NOT here. Its script source is a
             per-request nonce, and this file is evaluated once at build; it is
             set in proxy.ts. These four are constant, so they belong here,
             where they also cover the few responses the proxy's matcher
             skips. */

          // Belt to frame-ancestors' braces, for anything that predates CSP2.
          { key: 'X-Frame-Options', value: 'DENY' },
          /* Stops a browser second-guessing a Content-Type — the mechanism by
             which an uploaded file served as text/plain gets executed as
             something else. */
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          /* A CRM URL names the record being viewed. Same-origin navigation
             keeps the full path; anything leaving this site sends the origin
             alone, and an HTTPS→HTTP downgrade sends nothing. */
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          /* Nothing here asks for a camera, a microphone, a location or a
             payment handler — verified, not assumed — so nothing embedded or
             injected gets to ask on the app's behalf. */
          {
            key: 'Permissions-Policy',
            value: 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()',
          },
        ],
      },
    ]
  },
};

export default nextConfig;
