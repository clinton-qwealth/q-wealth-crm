import { redirect } from 'next/navigation'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getCurrentStaff, getRegistration } from '@/lib/staff'
import { RequestAccessForm } from '@/components/request-access-form'
import { getMfaState } from '@/lib/mfa'
import { ConsentForm } from './consent-form'
import { ConsentShell } from './consent-shell'
import { fullName } from '@/lib/staff-name'

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
    /*
     * Three kinds of not-staff, since 19 September. No row at all is a person
     * who signed up and has not yet asked: this is where "register via the
     * MCP" lands, so the request form is offered here, before the MFA check —
     * enrolment comes after approval. A pending row is a person waiting. An
     * inactive row is refused as before. None of them reaches ConsentForm:
     * a token is issued only past `getCurrentStaff()`.
     */
    const registration = await getRegistration()
    const row = registration.signedIn ? registration.row : null
    if (!row) {
      return (
        <ConsentShell title="Request access to Q Wealth CRM">
          <p>
            You are signed in as <span className="font-medium">{user.email}</span>, but that
            account is not yet a Q Wealth staff member. Ask to join, and an administrator will
            approve you with an access profile.
          </p>
          <RequestAccessForm
            suggested={registration.signedIn ? registration.suggested : null}
            next={returnTo}
          />
        </ConsentShell>
      )
    }
    if (row.status === 'pending') {
      return (
        <ConsentShell title="Awaiting approval">
          <p>
            Your request to join Q Wealth CRM as{' '}
            <span className="font-medium">{fullName(row)}</span> is with the administrators.
            Once approved, sign in to the CRM, set up two-factor authentication, then start this
            connection again.
          </p>
        </ConsentShell>
      )
    }
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

  /*
   * The second factor is required HERE, and this is the load-bearing check.
   *
   * An OAuth-issued session carries `aal1` even when the browser session that
   * authorised it was `aal2` — measured 2 Sep 2026, with the token minted 29
   * seconds after a factor was verified. So the assurance level cannot be
   * required on each MCP request; it has to be required at the one moment a
   * token can come into existence, which is this screen.
   *
   * The effect: every connector token that exists was authorised by someone who
   * proved a second factor at the moment of issuance. A stolen password alone
   * reaches neither the app nor a token.
   */
  const mfa = await getMfaState()
  if (!mfa.enrolled) {
    return (
      <ConsentShell title="Two-factor authentication required">
        <p>
          Connecting Claude to client data requires two-factor authentication on your Q
          Wealth account, and this account does not have it set up yet.
        </p>
        <p>
          Sign in to the CRM and complete the two-factor setup, then start this connection
          again.
        </p>
      </ConsentShell>
    )
  }
  if (mfa.stepUpRequired) {
    redirect(`/mfa?next=${encodeURIComponent(returnTo)}`)
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
      staffName={fullName(staff)}
      staffEmail={staff.email}
      profileName={staff.access_profiles.name}
    />
  )
}
