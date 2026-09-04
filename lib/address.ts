/**
 * Australian address lookup via Google Places API (New).
 *
 * SERVER ONLY. The API key must never reach a browser: a key in client
 * JavaScript is public by definition, and Google's referrer restriction — the
 * usual mitigation — is spoofable, so a leaked key becomes somebody else's
 * billing. Everything here runs behind a route handler.
 *
 * Places API (New) rather than the legacy Places API, and not as a preference:
 * Google's legacy products are "not available in new Cloud projects". The
 * legacy endpoints are also feature-frozen with a 12-month turn-down notice
 * promised, so there is nothing to weigh up.
 *
 * WHAT THIS DISCLOSES, stated plainly because it is a privacy decision and not
 * a technical one: every lookup sends part of a client's home address to
 * Google, who log it. Calling from the server means Google sees this
 * application's address rather than the adviser's, but the address fragment
 * still leaves the firm. That is a cross-border disclosure of personal
 * information under APP 8, for which Q Wealth remains accountable. If that ever
 * becomes unacceptable, the replacement is G-NAF — the official Australian
 * address file, open data — loaded into Supabase, which removes the third party
 * entirely. See the Confluence page.
 */
const PLACES_HOST = 'https://places.googleapis.com/v1'

function apiKey() {
  // Deliberately NOT via lib/env's `required`: a missing key must degrade to
  // manual address entry rather than throwing and taking the panel down with
  // it. Address autocomplete is a convenience; typing an address is not.
  return process.env.GOOGLE_PLACES_API_KEY ?? ''
}

export function addressLookupConfigured() {
  return apiKey().length > 0
}


/**
 * The four ways first-time setup goes wrong, told apart.
 *
 * Every one of these arrives as a bare 403 or 429, and "lookup unavailable"
 * would send someone hunting through the UI for a problem that is entirely in
 * the Cloud console. The distinctions matter most on the day the key is added
 * and never again, which is exactly when nobody remembers them.
 */
function lookupFailureMessage(http: number, status?: string): string {
  if (http === 403 || status === 'PERMISSION_DENIED') {
    return (
      'Google refused the address lookup. Check three things in the Cloud console: ' +
      'that Places API (New) is enabled, that the key is restricted to that API ' +
      'and not the legacy Places API, and that the key has no HTTP-referrer ' +
      'restriction — this call comes from a server and sends no referrer.'
    )
  }
  if (http === 429 || status === 'RESOURCE_EXHAUSTED') {
    return 'The address lookup quota has been reached. Type the address instead.'
  }
  if (http === 400 || status === 'INVALID_ARGUMENT') {
    return 'Google could not read that search. Type the address instead.'
  }
  return 'Address lookup is unavailable. Type the address instead.'
}

export type AddressSuggestion = {
  place_id: string
  /** What the adviser reads in the list, e.g. "12 Bay Street, Mosman NSW". */
  label: string
}

/** The five fields the CRM actually stores, in the shape contact_points wants. */
export type ResolvedAddress = {
  line1: string
  line2: string
  suburb: string
  state: string
  postcode: string
}

type Fail = { error: string }

/**
 * Suggestions for a partial address.
 *
 * `sessionToken` groups the keystrokes of one editing session — and the Place
 * Details call that follows — into a single billable session. Passing a fresh
 * token per keystroke would be charged per request instead.
 */
export async function suggestAddresses(
  input: string,
  sessionToken: string,
  signal?: AbortSignal,
): Promise<AddressSuggestion[] | Fail> {
  const key = apiKey()
  if (!key) return { error: 'Address lookup is not configured.' }

  const res = await fetch(`${PLACES_HOST}/places:autocomplete`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': key,
      // Only the two things the list needs. A field mask is optional on
      // autocomplete but asking for less is both faster and cheaper.
      'X-Goog-FieldMask':
        'suggestions.placePrediction.placeId,suggestions.placePrediction.text',
    },
    body: JSON.stringify({
      input,
      // Australian addresses only — every residential address in this CRM is
      // domestic, and narrowing the search makes the suggestions better as well
      // as cheaper. An overseas address is typed by hand.
      includedRegionCodes: ['au'],
      sessionToken,
    }),
    signal,
    cache: 'no-store',
  })

  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as {
      error?: { message?: string; status?: string }
    }
    // Google's own message can name the project or echo the key, so it is
    // logged rather than shown. What the adviser sees has to be actionable
    // without being a configuration disclosure.
    console.error(
      JSON.stringify({
        event: 'address_lookup_failed',
        http: res.status,
        status: body.error?.status ?? null,
        // Safe to log: Google's text names the API and the reason, never the
        // key itself. This is the line worth reading on the first deploy.
        detail: body.error?.message ?? null,
      }),
    )
    return { error: lookupFailureMessage(res.status, body.error?.status) }
  }

  const body = (await res.json()) as {
    suggestions?: { placePrediction?: { placeId?: string; text?: { text?: string } } }[]
  }
  return (body.suggestions ?? [])
    .map((s) => s.placePrediction)
    .filter((p): p is { placeId: string; text: { text: string } } =>
      Boolean(p?.placeId && p?.text?.text),
    )
    .map((p) => ({ place_id: p.placeId, label: p.text.text }))
}

/**
 * The chosen suggestion, resolved to the five stored fields.
 *
 * The field mask is REQUIRED here — omitting it is an error — and it decides
 * which SKU Google bills. `addressComponents` alone sits in the cheapest tier
 * (Place Details Essentials). ADDING ANYTHING ELSE MOVES THE TIER: asking for
 * `displayName` would bill as Pro, and `*` as Enterprise. Do not "just add a
 * field" here without checking what it costs.
 */
export async function resolveAddress(
  placeId: string,
  sessionToken: string,
): Promise<ResolvedAddress | Fail> {
  const key = apiKey()
  if (!key) return { error: 'Address lookup is not configured.' }

  /*
   * sessionToken is a QUERY PARAMETER here, not a header.
   *
   * This was written as an `X-Goog-Session-Token` header first, which Google
   * ignores silently: the lookup still works, but the autocomplete keystrokes
   * no longer group with this call into one billable session, so each is
   * charged separately. A billing bug with no visible symptom — worth the
   * comment so it does not come back.
   */
  const url = new URL(`${PLACES_HOST}/places/${encodeURIComponent(placeId)}`)
  url.searchParams.set('sessionToken', sessionToken)

  const res = await fetch(url, {
    headers: {
      'X-Goog-Api-Key': key,
      'X-Goog-FieldMask': 'addressComponents',
    },
    cache: 'no-store',
  })

  if (!res.ok) {
    console.error(
      JSON.stringify({ event: 'address_resolve_failed', http: res.status }),
    )
    return { error: 'That address could not be read. Type it instead.' }
  }

  const body = (await res.json()) as {
    addressComponents?: { types?: string[]; longText?: string; shortText?: string }[]
  }
  return mapComponents(body.addressComponents ?? [])
}

/**
 * Google's component list to the CRM's five fields.
 *
 * Exported for testing: the mapping is the part most likely to be quietly wrong
 * — a unit that lands in the street line, or a state stored as
 * "New South Wales" where every other record holds "NSW".
 */
export function mapComponents(
  components: { types?: string[]; longText?: string; shortText?: string }[],
): ResolvedAddress {
  const find = (type: string, short = false) => {
    const c = components.find((x) => (x.types ?? []).includes(type))
    if (!c) return ''
    return (short ? c.shortText : c.longText) ?? ''
  }

  const streetNumber = find('street_number')
  const route = find('route')

  return {
    // "12 Bay Street" — number and street joined, because that is one line on
    // an envelope and one column in contact_points.
    line1: [streetNumber, route].filter(Boolean).join(' '),
    // A unit, apartment or flat number. Google returns it separately, and it
    // belongs on its own line rather than jammed into the street line.
    line2: find('subpremise') ? `Unit ${find('subpremise')}` : '',
    suburb: find('locality'),
    // SHORT text: "NSW", not "New South Wales". Every existing record and the
    // rest of the UI use the abbreviation, and a mix of both would be worse
    // than either.
    state: find('administrative_area_level_1', true),
    postcode: find('postal_code'),
  }
}
