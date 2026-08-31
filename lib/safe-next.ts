/**
 * Constrain a post-login redirect target to a path on this site.
 *
 * `next` arrives from the query string, so treating it as a URL would be an
 * open redirect: someone could send staff a legitimate-looking login link that
 * bounces them to another host once authenticated. Only a single-slash-rooted
 * path is allowed, which rejects protocol-relative "//host", absolute URLs, and
 * backslash tricks.
 */
export function safeNext(next: unknown): string {
  if (typeof next !== 'string') return '/'
  if (!/^\/(?!\/)[^\\]*$/.test(next)) return '/'
  return next
}
