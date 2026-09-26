import { createSupabaseServerClient } from '@/lib/supabase/server'
import { PROVIDER_LOGO_BUCKET } from '@/lib/provider-logo'

/**
 * A provider's logo — the staff-avatar door, for the register's bucket, and
 * the same three rules because it is the same kind of door. IT GRANTS NOTHING
 * OF ITS OWN: the row is read through the caller's session, so `parties`' own
 * policy decides whether a path exists for them; the second factor is checked
 * here explicitly, because a route handler inherits no page's gate (rule 5);
 * and it REDIRECTS to a short-lived signed URL rather than streaming bytes,
 * with the browser cache set just inside the signature's life.
 */
const SIGNED_URL_TTL_SECONDS = 300
const BROWSER_CACHE_SECONDS = 240

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function GET(_request: Request, { params }: { params: Promise<{ partyId: string }> }) {
  const { partyId } = await params
  if (!UUID.test(partyId)) return notFound()

  const supabase = await createSupabaseServerClient()

  /* Gated on missing CLAIMS, never on `error` — see the avatar route. */
  const { data: verified } = await supabase.auth.getClaims()
  const claims = verified?.claims as { sub?: string; aal?: string } | undefined
  if (!claims?.sub) {
    return Response.json({ error: 'Not signed in.' }, { status: 403 })
  }
  if (claims.aal !== 'aal2') {
    return Response.json({ error: 'A verified second factor is required.' }, { status: 403 })
  }

  const { data: row } = await supabase
    .from('parties')
    .select('logo_path')
    .eq('id', partyId)
    .maybeSingle()

  // No row, or a row with no logo: the same answer, on purpose.
  if (!row?.logo_path) return notFound()

  const { data: signed, error: signError } = await supabase.storage
    .from(PROVIDER_LOGO_BUCKET)
    .createSignedUrl(row.logo_path, SIGNED_URL_TTL_SECONDS)

  if (signError || !signed?.signedUrl) {
    return Response.json({ error: 'That logo could not be opened.' }, { status: 502 })
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
  return Response.json({ error: 'No such logo.' }, { status: 404 })
}
