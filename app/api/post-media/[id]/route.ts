import { createSupabaseServerClient } from '@/lib/supabase/server'
import { POST_MEDIA_BUCKET } from '@/lib/workflow-board'

/**
 * The bytes a post carries.
 *
 * A post's document names an upload by ID ONLY — never by address — so this is
 * where an id becomes a picture. The row is looked up through the SIGNED-IN
 * USER'S client, so `workflow_post_media`'s own RLS, and through it the
 * workflow's, decides whether these bytes exist for this person. THIS ROUTE
 * GRANTS NOTHING OF ITS OWN, and must not: the service-role key is never used
 * anywhere in this app, and a route that signed URLs on its own authority
 * would be exactly the bypass that key represents.
 *
 * A ROUTE HANDLER IS A NEW FRONT DOOR, and the lesson from 3 September is that
 * a new door does not inherit the locks — the proxy says of itself that it is
 * not the authorisation boundary, and the shell layout's MFA gate covers PAGES,
 * not this. So the second factor is checked here explicitly. A stolen password
 * on its own must not read a screenshot of a client's holdings. The staff
 * question needs no separate check and gets one anyway by construction:
 * `staff_can_access_group()` returns false when the caller is not active staff,
 * so a signed-in non-staff account simply finds no row.
 *
 * WHY A REDIRECT rather than streaming the bytes: a redirect to a signed URL
 * lets Storage serve them from its own edge, so a feed with a dozen screenshots
 * does not pull a dozen file bodies through a serverless function. And why not
 * sign the URLs when the page renders: that would be one Storage round trip per
 * image on every feed load, and it would bake expiring URLs into HTML that then
 * fails in a panel left open — which is precisely how a task panel is used.
 */

/* Long enough that a slow connection finishes the download, short enough that a
   URL copied out of the network tab is useless by the time it is pasted. The
   browser cache is deliberately set just inside it, so a re-render within the
   window reuses the redirect instead of re-signing, and nothing is ever cached
   past the life of the signature it points at. */
const SIGNED_URL_TTL_SECONDS = 300
const BROWSER_CACHE_SECONDS = 240

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  // Not a 400: a malformed id and an id belonging to someone else's client
  // should be indistinguishable from outside.
  if (!UUID.test(id)) return notFound()

  const supabase = await createSupabaseServerClient()

  /* getClaims(), not getUser(): this project signs with ES256 and publishes a
     JWKS, so the signature is verified locally with WebCrypto against a cached
     key — no round trip on a warm function — and `aal` arrives with it, which
     makes the second-factor check free. */
  const { data: verified, error: claimsError } = await supabase.auth.getClaims()
  const claims = verified?.claims as { sub?: string; aal?: string } | undefined
  if (claimsError || !claims?.sub) {
    return Response.json({ error: 'Not signed in.' }, { status: 403 })
  }
  /* `aal === 'aal2'`, not "step-up not required": the latter reads false for
     somebody with no factor at all, who is single-factor and should be refused.
     The same question public.has_mfa() asks in the database. */
  if (claims.aal !== 'aal2') {
    return Response.json({ error: 'A verified second factor is required.' }, { status: 403 })
  }

  const { data: media } = await supabase
    .from('workflow_post_media')
    .select('kind, mime_type, original_name, storage_path, redacted_at')
    .eq('id', id)
    .maybeSingle()

  // No row means it does not exist, or it does and this person may not see it.
  // The same answer for both, on purpose.
  if (!media) return notFound()

  /* 410, not 404. The post still names this upload and the feed still draws a
     line where the picture was — "removed by <name>" — so the difference
     between "never existed" and "deliberately taken away" is already visible to
     anyone who can read the post. Saying so here costs nothing and makes a
     confusing image failure legible in the network tab. */
  if (media.redacted_at) {
    return Response.json({ error: 'That file was removed.' }, { status: 410 })
  }

  const { data: signed, error: signError } = await supabase.storage
    .from(POST_MEDIA_BUCKET)
    .createSignedUrl(
      media.storage_path,
      SIGNED_URL_TTL_SECONDS,
      // An image is drawn in the page; anything else is a file someone wants,
      // and it should arrive under the name they uploaded rather than a uuid.
      media.kind === 'image' ? undefined : { download: media.original_name },
    )

  if (signError || !signed?.signedUrl) {
    return Response.json({ error: 'That file could not be opened.' }, { status: 502 })
  }

  return new Response(null, {
    status: 302,
    headers: {
      Location: signed.signedUrl,
      // `private`: this is one person's view of one client's file, and no
      // shared cache anywhere should hold it.
      'Cache-Control': `private, max-age=${BROWSER_CACHE_SECONDS}`,
      // The URL varies by caller, so a cache keyed on the path alone would be
      // wrong even with `private` set.
      Vary: 'Cookie',
    },
  })
}

function notFound() {
  return Response.json({ error: 'No such file.' }, { status: 404 })
}
