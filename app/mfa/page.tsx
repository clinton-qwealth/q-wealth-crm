import { redirect } from 'next/navigation'
import { getCurrentStaff } from '@/lib/staff'
import { getMfaState } from '@/lib/mfa'
import { safeNext } from '@/lib/safe-next'
import { AuthShell } from '@/components/auth-shell'
import { ChallengeForm } from './challenge-form'

export const metadata = { title: 'Verify your identity · Q Wealth CRM' }

export default async function MfaPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>
}) {
  const raw = (await searchParams).next
  const next = raw === undefined ? '/' : safeNext(raw)

  const staff = await getCurrentStaff()
  if (!staff) redirect('/login')

  const mfa = await getMfaState()
  // Nothing to step up to, or already stepped up.
  if (!mfa.stepUpRequired) redirect(next)

  return (
    <AuthShell
      title="Verify your identity"
      description="Enter the six-digit code from your authenticator."
      footer="Lost access to your authenticator? Contact your administrator — a factor cannot be removed without one."
    >
      <ChallengeForm next={next} />
    </AuthShell>
  )
}
