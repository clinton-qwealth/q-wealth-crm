import { createSupabaseServerClient } from '@/lib/supabase/server'
import { EMPTY_RESULTS, MIN_QUERY, searchEverything } from '@/lib/search'

/**
 * The search modal's results.
 *
 * A ROUTE HANDLER rather than a Server Action, for the reason the address
 * lookup documents at length: Next dispatches Server Actions one at a time per
 * client, so per-keystroke calls would queue behind each other and the results
 * would fall further behind the cursor the faster somebody types. A route
 * handler is an ordinary fetch — concurrent, and abortable when the next
 * keystroke supersedes it.
 *
 * **A ROUTE HANDLER IS A NEW FRONT DOOR, and a new door does not inherit the
 * locks.** The proxy says of itself that it is not the authorisation boundary,
 * and the shell layout's two-factor gate covers PAGES, not this. So the two
 * checks that matter are made here.
 *
 * ## What guards the data, and what does not
 *
 * **Row-level security is the boundary**, not this handler. Every table and
 * view `searchEverything` touches runs as the caller and rests on
 * `current_staff_id()`, so a signed-in account that is not active staff matches
 * nothing at all — there is no set of results it could return to the wrong
 * person. That is why this does NOT call `getCurrentStaff()`: it would add a
 * real round trip to every keystroke and refuse nothing that the database is
 * not already refusing.
 *
 * The address lookup does make that call, and the difference is worth keeping
 * straight: that endpoint spends money on a third-party API, so it has to
 * refuse a non-staff caller BEFORE the spend. This one reads client data and
 * spends nothing, so the database's own answer is both sufficient and
 * authoritative.
 *
 * **Nor does it memoise anything.** The address route keeps a one-minute
 * per-instance memo of "is this subject active staff", and its own comment says
 * that staleness would not be acceptable for anything touching client data.
 * This touches client data.
 */
export async function GET(request: Request) {
  const supabase = await createSupabaseServerClient({ writable: false })

  /*
   * getClaims(), not getUser(): this project signs with ES256 and publishes a
   * JWKS, so the signature is verified locally against a cached key — no round
   * trip on a warm instance, and the `aal` claim arrives with it, which makes
   * the second-factor check free.
   *
   * Gated on missing CLAIMS, never on `error`. With no session at all
   * `getClaims()` returns `{ data: null, error: null }` — no error — so a gate
   * written on the error would wave every anonymous caller straight through.
   */
  const { data: verified } = await supabase.auth.getClaims()
  const claims = verified?.claims as { sub?: string; aal?: string } | undefined
  if (!claims?.sub) {
    return Response.json({ error: 'Not signed in.' }, { status: 403 })
  }

  /* `aal === 'aal2'`, not "step-up not required": the latter reads false for
     somebody with no factor at all, who is single-factor and should be
     refused. The same question `public.has_mfa()` asks in the database. */
  if (claims.aal !== 'aal2') {
    return Response.json({ error: 'A verified second factor is required.' }, { status: 403 })
  }

  const query = new URL(request.url).searchParams.get('q') ?? ''
  if (query.trim().length < MIN_QUERY) {
    return Response.json({ results: EMPTY_RESULTS })
  }

  const results = await searchEverything(supabase, query)
  return Response.json({ results })
}
