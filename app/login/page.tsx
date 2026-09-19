import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getCurrentStaff, getRegistration } from '@/lib/staff'
import { safeNext } from '@/lib/safe-next'
import { AuthShell } from '@/components/auth-shell'
import { LoginForm } from './login-form'

export const metadata = { title: 'Sign in · Q Wealth CRM' }

/**
 * Sentences this page will say about how somebody arrived, keyed by a code the
 * app itself puts in the URL.
 *
 * **A lookup, never an echo.** `error` is a query parameter on a page an
 * anonymous visitor can reach, so it is attacker-controlled; rendering it would
 * put chosen text on our own sign-in screen above a password box, which is a
 * phishing primitive rather than a cosmetic bug. An unknown value says nothing
 * at all.
 */
const ARRIVAL_NOTICES: Record<string, string> = {
  confirm:
    'That confirmation link has expired or has already been used. Sign in below — if you have confirmed your email address, your request to join is already with the administrators.',
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string }>
}) {
  const params = await searchParams
  const raw = params.next
  // Sanitise here too, so a hostile value never even reaches the form.
  const next = raw === undefined ? undefined : safeNext(raw)
  const notice = params.error ? ARRIVAL_NOTICES[params.error] : undefined

  // Already signed in and already staff? Nothing to do here. Signed in but
  // not staff? The request page says where they stand.
  const staff = await getCurrentStaff()
  if (staff) redirect(next ?? '/')
  const registration = await getRegistration()
  if (registration.signedIn) redirect(next ? `/request-access?next=${encodeURIComponent(next)}` : '/request-access')

  return (
    <AuthShell
      title="Staff sign in"
      description="Q Wealth CRM is available to Q Wealth staff only."
      footer="Two-factor authentication is required. You will be asked to set it up if you have not already."
    >
      {/* Below the two redirects above, so somebody who is already signed in is
          still sent onward rather than being shown this. */}
      {notice ? (
        <p
          role="alert"
          data-slot="arrival-notice"
          className="mb-4 rounded-md bg-amber-50 px-3 py-2 text-left text-xs leading-relaxed text-amber-900 ring-1 ring-amber-200"
        >
          {notice}
        </p>
      ) : null}
      <LoginForm next={next} />
      <p className="mt-5 text-center text-xs text-neutral-500">
        New to Q Wealth?{' '}
        <Link
          href="/request-access"
          className="font-medium text-brand underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/30"
        >
          Request access
        </Link>
      </p>
    </AuthShell>
  )
}
