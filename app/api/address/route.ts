import { getCurrentStaff } from '@/lib/staff'
import { getMfaState } from '@/lib/mfa'
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
export async function GET(request: Request) {
  const staff = await getCurrentStaff()
  if (!staff) {
    return Response.json({ error: 'Not an active Q Wealth staff member' }, { status: 403 })
  }

  /*
   * `currentLevel === 'aal2'` and NOT `!stepUpRequired`. The latter is
   * `enrolled && currentLevel === 'aal1'`, so it reads false for somebody with
   * no factor at all — who is single-factor and should be refused. Asking
   * whether the session actually reached aal2 is the same question
   * public.has_mfa() asks in the database, which is the answer worth matching.
   */
  const mfa = await getMfaState()
  if (mfa.currentLevel !== 'aal2') {
    return Response.json(
      { error: 'A verified second factor is required.' },
      { status: 403 },
    )
  }

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
  const placeId = url.searchParams.get('place_id')
  if (placeId) {
    const resolved = await resolveAddress(placeId, token)
    if ('error' in resolved) return Response.json(resolved, { status: 502 })
    return Response.json(resolved)
  }

  const q = (url.searchParams.get('q') ?? '').trim()
  // Below four characters the suggestions are noise, and every call is billed.
  // The client enforces this too; this is the copy that matters.
  if (q.length < 4) return Response.json({ suggestions: [] })

  const suggestions = await suggestAddresses(q, token, request.signal)
  if ('error' in suggestions) return Response.json(suggestions, { status: 502 })
  return Response.json({ suggestions })
}
