import { redirect } from 'next/navigation'
import { getCurrentStaff } from '@/lib/staff'
import { getMfaState } from '@/lib/mfa'
import { safeNext } from '@/lib/safe-next'
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
    <main className="flex min-h-full flex-1 items-center justify-center px-6 py-16">
      <div className="w-full max-w-sm">
        <p className="text-xs font-medium uppercase tracking-widest text-neutral-400">
          Q Wealth CRM
        </p>
        <h1 className="mt-2 text-xl font-semibold tracking-tight">Verify your identity</h1>
        <p className="mt-2 text-sm leading-relaxed text-neutral-600 dark:text-neutral-300">
          Enter the six-digit code from your authenticator app.
        </p>
        <ChallengeForm next={next} />
      </div>
    </main>
  )
}
