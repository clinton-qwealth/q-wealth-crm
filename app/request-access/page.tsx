import { redirect } from 'next/navigation'
import { AuthShell } from '@/components/auth-shell'
import { RequestAccessForm, SignUpForm } from '@/components/request-access-form'
import { signOut } from '@/app/actions'
import { safeNext } from '@/lib/safe-next'
import { getRegistration } from '@/lib/staff'

export const metadata = { title: 'Request access · Q Wealth CRM' }

/**
 * The way in for someone who is not yet staff. Outside the shell like `/mfa`,
 * and public in the proxy, because its first state is reached before any
 * session exists.
 *
 * Four states, read from `getRegistration()`: signed out → create an account;
 * signed in with no staff row → ask to join; pending → waiting; inactive → not
 * active. An active staff member has no business here and goes home.
 */
export default async function RequestAccessPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>
}) {
  const raw = (await searchParams).next
  const next = raw === undefined ? undefined : safeNext(raw)
  const registration = await getRegistration()

  if (!registration.signedIn) {
    return (
      <AuthShell
        title="Request access"
        description="Create an account with your Q Wealth email address. You will confirm it, then ask an administrator to let you in."
        footer="Already have an account? Sign in, and you will be brought back here."
      >
        <SignUpForm />
      </AuthShell>
    )
  }

  const { row } = registration
  if (row?.status === 'active') redirect(next ?? '/')

  if (!row) {
    return (
      <AuthShell
        title="Ask to join"
        description={`You are signed in as ${registration.email ?? 'a new account'}. Tell us your name and an administrator will approve your access.`}
        footer="Access requests are limited to Q Wealth staff email addresses."
      >
        <RequestAccessForm suggestedName={registration.suggestedName} next={next} />
      </AuthShell>
    )
  }

  const waiting = row.status === 'pending'
  return (
    <AuthShell
      title={waiting ? 'Awaiting approval' : 'This account is not active'}
      description={
        waiting
          ? `Your request to join as ${row.full_name} is with the administrators. You will be able to sign in once it is approved.`
          : 'This account is not an active Q Wealth staff account. Contact your administrator.'
      }
    >
      <form action={signOut}>
        <button
          type="submit"
          className="w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm font-medium text-neutral-800 outline-none transition-colors hover:bg-neutral-50 focus-visible:ring-2 focus-visible:ring-brand/30"
        >
          Sign out
        </button>
      </form>
    </AuthShell>
  )
}
