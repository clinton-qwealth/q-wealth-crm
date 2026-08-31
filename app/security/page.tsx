import { redirect } from 'next/navigation'
import { getCurrentStaff } from '@/lib/staff'
import { getMfaState } from '@/lib/mfa'
import { EnrolPanel } from './enrol-panel'

export const metadata = { title: 'Security · Q Wealth CRM' }

export default async function SecurityPage() {
  const staff = await getCurrentStaff()
  if (!staff) redirect('/login')

  const mfa = await getMfaState()

  return (
    <main className="mx-auto flex w-full max-w-lg flex-1 flex-col justify-center px-6 py-16">
      <p className="text-xs font-medium uppercase tracking-widest text-neutral-400">
        Q Wealth CRM
      </p>
      <h1 className="mt-2 text-xl font-semibold tracking-tight">Security</h1>
      <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
        {staff.full_name} · {staff.access_profiles.name}
      </p>

      <div className="mt-6 rounded-md border border-neutral-200 p-4 dark:border-neutral-800">
        <div className="flex items-baseline justify-between gap-4">
          <h2 className="text-sm font-medium">Two-factor authentication</h2>
          <span
            className={
              mfa.enrolled
                ? 'text-xs font-medium text-emerald-700 dark:text-emerald-400'
                : 'text-xs font-medium text-amber-700 dark:text-amber-400'
            }
          >
            {mfa.enrolled ? 'On' : 'Not set up'}
          </span>
        </div>

        <p className="mt-2 text-sm leading-relaxed text-neutral-600 dark:text-neutral-300">
          {mfa.enrolled
            ? 'Your account is protected by an authenticator app. You will be asked for a code when you sign in.'
            : 'Your password is currently the only thing protecting client data on this account.'}
        </p>

        {staff.access_profiles.view_sensitive ? (
          <p className="mt-3 rounded-md bg-amber-50 px-3 py-2.5 text-xs leading-relaxed text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
            Your profile permits revealing tax file numbers and other sensitive
            identifiers. Those reveals require two-factor authentication and will be
            refused without it — the rule is enforced in the database, not just here.
          </p>
        ) : null}

        <EnrolPanel enrolled={mfa.enrolled} />
      </div>
    </main>
  )
}
