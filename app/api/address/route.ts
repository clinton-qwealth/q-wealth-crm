import { createSupabaseServerClient } from '@/lib/supabase/server'
import {
  addressLookupConfigured,
  resolveAddress,
  suggestAddresses,
} from '@/lib/address'

/**
 * Address lookup for the member panel.
 *
 * A ROUTE HANDLER rather than a Server Action, deliberately. Next dispatches
 * Server Actions one at a time per client, so per-keystroke lookups would queue
 * behind each other — suggestions falling further behind the cursor as the
 * adviser types, and a Save queuing behind whatever lookups were still in
 * flight. A route handler is an ordinary fetch: concurrent, and abortable when
 * the next keystroke supersedes it.
 *
 * BUT A ROUTE HANDLER IS A NEW FRONT DOOR, and the lesson from 3 September is
 * that a new door does not inherit the locks. The proxy redirects sessionless
 * visitors, but it says of itself that it is not the authorisation boundary; and
 * the shell layout's MFA gate covers PAGES, not this. So both checks are made
 * here explicitly:
 *
 *   * active staff — being signed in is not the same as being staff
 *   * a verified second factor — because this endpoint spends money on every
 *     call, which is exactly what a stolen password should not be able to do
 *
 * Neither breaks anything: the only caller is the member panel, reached through
 * the shell, which has already forced step-up.
 *
 * NOT RATE LIMITED HERE, and the reason is a trade rather than an oversight.
 * The database-enforced limit built for identity verification costs a round
 * trip, which on a per-keystroke path would roughly double the latency of the
 * thing being optimised. The spend guard for this belongs at Google: set a
 * daily quota cap on the key in the Cloud console. Client-side debouncing and a
 * minimum query length reduce the volume; only the quota cap bounds it.
 */
/*
 * Per-instance memo of "is this subject active staff".
 *
 * Measured on the first deploy: auth 11ms, staff 360ms, google 527ms. A
 * one-row indexed lookup on a four-row table in the same region is not 360ms
 * of query — it is the DNS and TLS handshake for the first HTTPS call to
 * Supabase in a fresh function instance, paid inside the measurement.
 *
 * Autocomplete arrives as a burst of keystrokes hitting the same warm
 * instance, so memoising the answer means the burst pays that once instead of
 * once per character.
 *
 * WHAT THIS TRADES: a staff member deactivated mid-burst keeps address lookup
 * for up to a minute. That is an acceptable staleness for this endpoint and
 * would NOT be for anything touching client data — this check exists to stop a
 * non-staff account spending money on lookups, and a minute of that is bounded
 * by the Google quota cap anyway. It is a memo, not a change to where the
 * boundary sits: the check still runs, just not more than once a minute per
 * person per instance.
 *
 * Module scope deliberately: it must outlive the request to be worth anything.
 */
const STAFF_TTL_MS = 60_000
const staffSeen = new Map<string, number>()
/** First invocation on this instance? Cold-start cost lands here, not in the code. */
let warmedUp = false

export async function GET(request: Request) {
  const t0 = performance.now()
  const wasCold = !warmedUp
  warmedUp = true
  const supabase = await createSupabaseServerClient({ writable: false })

  /*
   * getClaims(), NOT getCurrentStaff().
   *
   * This runs on every keystroke, so the difference matters. getCurrentStaff()
   * costs two network round trips — auth.getUser() against GoTrue, then a
   * staff_users select — and its React cache() wrapper is per-request, so it
   * memoises nothing across separate fetches.
   *
   * This project signs tokens with ES256 and publishes a JWKS, so getClaims()
   * verifies the signature LOCALLY with WebCrypto against a cached key: no
   * round trip on a warm function, and the `aal` claim comes back with it, so
   * the second-factor check is free too. (It falls back to getUser() only for
   * symmetric keys, which is not this project.)
   *
   * The staff lookup below is still a real round trip, and stays sequential
   * rather than racing the Google call: this endpoint spends money, so it
   * refuses first and asks second.
   */
  const { data: verified, error: claimsError } = await supabase.auth.getClaims()
  const claims = verified?.claims as { sub?: string; aal?: string } | undefined
  if (claimsError || !claims?.sub) {
    return Response.json({ error: 'Not signed in.' }, { status: 403 })
  }

  /*
   * `aal === 'aal2'`, not "step-up not required". The latter reads false for
   * somebody with no factor at all — who is single-factor and should be
   * refused. This is the same question public.has_mfa() asks in the database.
   */
  if (claims.aal !== 'aal2') {
    return Response.json(
      { error: 'A verified second factor is required.' },
      { status: 403 },
    )
  }
  const tAuth = performance.now()

  // Being signed in is not the same as being staff, and this endpoint costs
  // money on every call. Asked at most once a minute per person per instance —
  // see the note above the memo.
  const seenAt = staffSeen.get(claims.sub)
  const memoised = seenAt !== undefined && Date.now() - seenAt < STAFF_TTL_MS
  if (!memoised) {
    const { data: staff } = await supabase
      .from('staff_users')
      .select('id')
      .eq('auth_user_id', claims.sub)
      .eq('status', 'active')
      .maybeSingle()
    if (!staff) {
      // Not remembered, so a deactivated account is refused from the next
      // request rather than being cached as a failure.
      staffSeen.delete(claims.sub)
      return Response.json({ error: 'Not an active Q Wealth staff member' }, { status: 403 })
    }
    staffSeen.set(claims.sub, Date.now())
  }
  const tStaff = performance.now()

  if (!addressLookupConfigured()) {
    // 501 rather than 500: nothing is broken, the feature simply is not set up,
    // and the panel uses this to hide the search box and let the adviser type.
    return Response.json({ error: 'Address lookup is not configured.' }, { status: 501 })
  }

  const url = new URL(request.url)
  const token = url.searchParams.get('token') ?? ''
  if (!token) {
    return Response.json({ error: 'A session token is required.' }, { status: 400 })
  }

  // One handler, two operations, so the checks above are written once.
  /*
   * Server-Timing, so "it feels laggy" can be answered with numbers from the
   * browser that feels it rather than from a guess. Open the network tab, pick
   * the request, and the Timing panel breaks it into auth / staff / google.
   */
  const timing = (google: number) =>
    [
      `auth;dur=${(tAuth - t0).toFixed(1)}`,
      // `desc` says whether the staff lookup actually ran. A memoised request
      // reads ~0, which is how to tell a cold instance from a slow query.
      `staff;dur=${(tStaff - tAuth).toFixed(1)};desc="${memoised ? 'memoised' : 'looked up'}"`,
      `google;dur=${google.toFixed(1)}`,
      `instance;dur=0;desc="${wasCold ? 'cold' : 'warm'}"`,
    ].join(', ')

  const placeId = url.searchParams.get('place_id')
  if (placeId) {
    const before = performance.now()
    const resolved = await resolveAddress(placeId, token)
    const headers = { 'Server-Timing': timing(performance.now() - before) }
    if ('error' in resolved) return Response.json(resolved, { status: 502, headers })
    return Response.json(resolved, { headers })
  }

  const q = (url.searchParams.get('q') ?? '').trim()
  // Below four characters the suggestions are noise, and every call is billed.
  // The client enforces this too; this is the copy that matters.
  if (q.length < 4) return Response.json({ suggestions: [] })

  const before = performance.now()
  const suggestions = await suggestAddresses(q, token, request.signal)
  const headers = { 'Server-Timing': timing(performance.now() - before) }
  if ('error' in suggestions) return Response.json(suggestions, { status: 502, headers })
  return Response.json({ suggestions }, { headers })
}
