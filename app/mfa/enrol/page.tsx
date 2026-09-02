import { redirect } from 'next/navigation'
import { getCurrentStaff } from '@/lib/staff'
import { getMfaState } from '@/lib/mfa'
import { EnrolPanel } from '@/app/(shell)/profile/enrol-panel'

export const metadata = { title: 'Set up two-factor authentication · Q Wealth CRM' }

/**
 * Mandatory enrolment.
 *
 * Deliberately OUTSIDE the (shell) route group. The shell layout redirects
 * unenrolled staff here, so an enrolment screen inside the shell would redirect
 * to itself forever. Everything reached before the app proper — sign-in, step-up,
 * consent — lives outside for the same reason.
 *
 * Enforcement is app-side rather than in RLS. Requiring `aal2` in row-level
 * security would be stronger, but an OAuth-issued session carries `aal1` even
 * when the browser session that authorised it was `aal2` (measured 2 Sep 2026),
 * so the MCP connector would go dark. See the Web App page in Confluence.
 */
export default async function EnrolPage() {
  const staff = await getCurrentStaff()
  if (!staff) redirect('/login')

  const mfa = await getMfaState()
  // Already enrolled: either finish stepping up, or carry on into the app.
  if (mfa.enrolled) redirect(mfa.stepUpRequired ? '/mfa?next=%2F' : '/')

  return (
    <main className="flex min-h-full flex-1 items-center justify-center px-6 py-16">
      <div className="w-full max-w-md">
        <p className="text-xs font-medium uppercase tracking-widest text-neutral-400">
          Q Wealth CRM
        </p>
        <h1 className="mt-2 text-xl font-semibold tracking-tight">
          Set up two-factor authentication
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-neutral-600">
          This is required before you can use the CRM. A password alone is not enough to
          protect client data, and it is the only thing currently standing in front of your
          account.
        </p>
        <p className="mt-2 text-sm leading-relaxed text-neutral-600">
          You will need an authenticator app — 1Password, Authy, Google Authenticator or
          similar.
        </p>
        <div className="mt-6">
          <EnrolPanel enrolled={false} />
        </div>
      </div>
    </main>
  )
}
