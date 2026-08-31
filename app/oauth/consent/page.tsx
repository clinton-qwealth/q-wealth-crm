import { redirect } from 'next/navigation'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getCurrentStaff } from '@/lib/staff'
import { ConsentForm } from './consent-form'
import { ConsentShell } from './consent-shell'

export const metadata = { title: 'Authorise access · Q Wealth CRM' }

/**
 * OAuth 2.1 consent screen.
 *
 * Supabase Auth validates the client, redirect URI and PKCE parameters, then
 * sends the user here with an authorization_id. This page is the only thing
 * standing between an OAuth client and a token that acts as this staff member,
 * so it does three checks before offering an Approve button: a session exists,
 * that session belongs to active staff, and the authorization request is still
 * valid.
 *
 * The URL is Site URL + Authorization Path, both set in the Supabase dashboard.
 */
export default async function ConsentPage({
  searchParams,
}: {
  searchParams: Promise<{ authorization_id?: string }>
}) {
  const { authorization_id: authorizationId } = await searchParams

  if (!authorizationId) {
    return (
      <ConsentShell title="Nothing to authorise">
        <p>
          This page was opened without an authorisation request. Start again from the
          application you were trying to connect.
        </p>
      </ConsentShell>
    )
  }

  // Not signed in: send them to login and come straight back here afterwards,
  // authorization_id intact. proxy.ts leaves this path public precisely so this
  // redirect is ours to make.
  const returnTo = `/oauth/consent?authorization_id=${encodeURIComponent(authorizationId)}`

  const supabase = await createSupabaseServerClient({ writable: false })
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect(`/login?next=${encodeURIComponent(returnTo)}`)

  // Signed in is not the same as being staff. A non-staff account would receive
  // a token that every RLS policy refuses anyway, so refuse it here rather than
  // hand out something useless and confusing.
  const staff = await getCurrentStaff()
  if (!staff) {
    return (
      <ConsentShell title="Not a Q Wealth staff account">
        <p>
          You are signed in as <span className="font-medium">{user.email}</span>, but that
          account is not an active Q Wealth staff member, so it cannot authorise access to
          client data.
        </p>
        <p>If you believe this is wrong, contact your administrator.</p>
      </ConsentShell>
    )
  }

  const { data, error } = await supabase.auth.oauth.getAuthorizationDetails(authorizationId)

  if (error || !data) {
    return (
      <ConsentShell title="This request is no longer valid">
        <p>
          The authorisation request has expired or has already been used. Authorisation
          requests are short-lived and single-use.
        </p>
        <p>Start again from the application you were connecting.</p>
      </ConsentShell>
    )
  }

  // Already granted: Supabase returns the callback URL directly, with no consent
  // needed. Nothing to ask the user, so pass them straight through.
  if ('redirect_url' in data) redirect(data.redirect_url)

  return (
    <ConsentForm
      authorizationId={authorizationId}
      clientName={data.client?.name ?? 'An application'}
      clientUri={data.client?.uri ?? null}
      redirectUri={data.redirect_uri}
      scope={data.scope ?? ''}
      staffName={staff.full_name}
      staffEmail={staff.email}
      profileName={staff.access_profiles.name}
    />
  )
}
