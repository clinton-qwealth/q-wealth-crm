import { redirect } from 'next/navigation'
import { getCurrentStaff } from '@/lib/staff'
import { signOut } from './actions'

/**
 * Placeholder home. proxy.ts guarantees a session before we get here, but being
 * signed in is not the same as being staff, so this repeats the authoritative
 * check rather than trusting the redirect.
 */
export default async function Home() {
  const staff = await getCurrentStaff()
  if (!staff) redirect('/login')

  const p = staff.access_profiles
  const permissions: [string, boolean][] = [
    ['See all client groups', p.view_all_groups],
    ['Reveal sensitive fields', p.view_sensitive],
    ['Manage groups', p.manage_groups],
    ['Manage staff', p.manage_staff],
    ['File unmatched notes', p.file_unmatched_notes],
  ]

  return (
    <main className="mx-auto flex w-full max-w-lg flex-1 flex-col justify-center px-6 py-16">
      <p className="text-xs font-medium uppercase tracking-widest text-neutral-400">
        Q Wealth CRM
      </p>
      <h1 className="mt-2 text-xl font-semibold tracking-tight">
        Signed in as {staff.full_name}
      </h1>
      <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
        {staff.email} · {p.name}
      </p>

      <ul className="mt-6 divide-y divide-neutral-200 border-y border-neutral-200 text-sm dark:divide-neutral-800 dark:border-neutral-800">
        {permissions.map(([label, allowed]) => (
          <li key={label} className="flex items-center justify-between gap-4 py-2.5">
            <span className="text-neutral-600 dark:text-neutral-300">{label}</span>
            <span
              className={
                allowed
                  ? 'text-xs font-medium text-emerald-700 dark:text-emerald-400'
                  : 'text-xs text-neutral-400'
              }
            >
              {allowed ? 'Yes' : 'No'}
            </span>
          </li>
        ))}
      </ul>

      <p className="mt-6 text-xs leading-relaxed text-neutral-500 dark:text-neutral-400">
        These permissions come from your access profile and are enforced in the database,
        not here. This screen is a placeholder while the CRM is built.
      </p>

      <form action={signOut} className="mt-6">
        <button
          type="submit"
          className="rounded-md border border-neutral-300 px-3 py-2 text-sm font-medium transition-colors hover:bg-neutral-50 dark:border-neutral-700 dark:hover:bg-neutral-900"
        >
          Sign out
        </button>
      </form>
    </main>
  )
}
