import { redirect } from 'next/navigation'
import { getCurrentStaff } from '@/lib/staff'
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

  // Already signed in and already staff? Nothing to do here.
  const staff = await getCurrentStaff()
  if (staff) redirect(next ?? '/')

  return (
    <AuthShell
      title="Staff sign in"
      description="Q Wealth CRM is available to Q Wealth staff only."
      footer="Two-factor authentication is required. You will be asked to set it up if you have not already."
    >
      <LoginForm next={next} />
    </AuthShell>
  )
}
