import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getCurrentStaff, getRegistration } from '@/lib/staff'
import { safeNext } from '@/lib/safe-next'
import { AuthShell } from '@/components/auth-shell'
import { LoginForm } from './login-form'

export const metadata = { title: 'Sign in · Q Wealth CRM' }

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>
}) {
  const raw = (await searchParams).next
  // Sanitise here too, so a hostile value never even reaches the form.
  const next = raw === undefined ? undefined : safeNext(raw)

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
