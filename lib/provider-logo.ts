/**
 * A provider's logo: where it lives, what it may be, how it is named.
 *
 * `lib/avatar.ts` for the provider register — same constants discipline, same
 * reasons: pure, so the browser (which uploads) and the server (which signs)
 * read one set of rules, and the bucket enforces them again whatever this file
 * says. No SVG on purpose: an SVG can carry script, and a logo does not need
 * to.
 */
export const PROVIDER_LOGO_BUCKET = 'provider-logos'
export const PROVIDER_LOGO_SIZE_LIMIT = 2 * 1024 * 1024
export const PROVIDER_LOGO_MIME_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const

export type ProviderLogoMime = (typeof PROVIDER_LOGO_MIME_TYPES)[number]

export function isProviderLogoType(mime: string): mime is ProviderLogoMime {
  return (PROVIDER_LOGO_MIME_TYPES as readonly string[]).includes(mime)
}

export function logoExtension(mime: ProviderLogoMime): 'png' | 'jpg' | 'webp' {
  return mime === 'image/png' ? 'png' : mime === 'image/jpeg' ? 'jpg' : 'webp'
}

/** `<party id>/<uuid>.<ext>` — the shape the column's check constraint pins. */
export function providerLogoPath(partyId: string, mime: ProviderLogoMime): string {
  return `${partyId}/${crypto.randomUUID()}.${logoExtension(mime)}`
}

/** Where the browser fetches it. `?v=` is the CACHE KEY — the route ignores
 *  it, but without it a replaced logo shows stale for the cache window. */
export function providerLogoUrl(partyId: string, logoPath: string): string {
  const basename = logoPath.slice(logoPath.lastIndexOf('/') + 1)
  return `/api/provider-logo/${partyId}?v=${encodeURIComponent(basename)}`
}
