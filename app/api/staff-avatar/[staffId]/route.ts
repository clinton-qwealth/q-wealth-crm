import { createSupabaseServerClient } from '@/lib/supabase/server'
import { STAFF_AVATAR_BUCKET } from '@/lib/avatar'

/**
 * A staff member's photo.
 *
 * The post-media route, for a different bucket, and the same three rules hold
 * because they are the same kind of door. THIS ROUTE GRANTS NOTHING OF ITS
 * OWN: the row is read through the signed-in user's client, so `staff_users`'
 * policy — any active staff member — decides whether a path exists for this
 * caller, and the signed URL is minted with that same session. The second
 * factor is checked here explicitly, because a route handler does not inherit
 * the shell layout's MFA gate. And it REDIRECTS to a short-lived signed URL
 * rather than streaming bytes, with a browser cache set just inside the
 * signature's life; the `?v=` the client appends is the cache key and is
 * ignored here.
 */
const SIGNED_URL_TTL_SECONDS = 300
const BROWSER_CACHE_SECONDS = 240

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function GET(_request: Request, { params }: { params: Promise<{ staffId: string }> }) {
  const { staffId } = await params
  if (!UUID.test(staffId)) return notFound()

  const supabase = await createSupabaseServerClient()

  /* Gated on missing CLAIMS, never on `error`: with no session `getClaims()`
     returns no data and no error, so a gate on the error would wave every
     anonymous caller through. */
  const { data: verified } = await supabase.auth.getClaims()
  const claims = verified?.claims as { sub?: string; aal?: string } | undefined
  if (!claims?.sub) {
    return Response.json({ error: 'Not signed in.' }, { status: 403 })
  }
  if (claims.aal !== 'aal2') {
    return Response.json({ error: 'A verified second factor is required.' }, { status: 403 })
  }

  const { data: row } = await supabase
    .from('staff_users')
    .select('avatar_path')
    .eq('id', staffId)
    .maybeSingle()

  // No row, or a row with no photo: the same answer, on purpose.
  if (!row?.avatar_path) return notFound()

  const { data: signed, error: signError } = await supabase.storage
    .from(STAFF_AVATAR_BUCKET)
    .createSignedUrl(row.avatar_path, SIGNED_URL_TTL_SECONDS)

  if (signError || !signed?.signedUrl) {
    return Response.json({ error: 'That photo could not be opened.' }, { status: 502 })
  }

  return new Response(null, {
    status: 302,
    headers: {
      Location: signed.signedUrl,
      'Cache-Control': `private, max-age=${BROWSER_CACHE_SECONDS}`,
      Vary: 'Cookie',
    },
  })
}

function notFound() {
  return Response.json({ error: 'No such photo.' }, { status: 404 })
}
