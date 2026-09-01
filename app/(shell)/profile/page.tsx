import { redirect } from 'next/navigation'
import { getCurrentStaff } from '@/lib/staff'
import { getMfaState } from '@/lib/mfa'
import { signOut } from '@/app/actions'
import { Card, PageHeading, Pill } from '@/components/ui'
import { EnrolPanel } from './enrol-panel'

export const metadata = { title: 'Profile · Q Wealth CRM' }

export default async function ProfilePage() {
  const staff = await getCurrentStaff()
  if (!staff) redirect('/login')

  const mfa = await getMfaState()
  const p = staff.access_profiles

  const permissions: [string, boolean][] = [
    ['See all client groups', p.view_all_groups],
    ['Reveal sensitive fields', p.view_sensitive],
    ['Manage groups', p.manage_groups],
    ['Manage staff', p.manage_staff],
    ['File unmatched notes', p.file_unmatched_notes],
  ]

  return (
    <>
      <PageHeading
        eyebrow="Account"
        title="Profile"
        description="Your details, what your access profile permits, and how you sign in."
      />

      <Card className="col-span-full lg:col-span-6" title="Your details">
        <dl className="divide-y divide-neutral-100">
          <div className="flex items-center justify-between gap-4 py-2">
            <dt className="text-sm text-neutral-500">Name</dt>
            <dd className="text-sm font-medium text-neutral-900">{staff.full_name}</dd>
          </div>
          <div className="flex items-center justify-between gap-4 py-2">
            <dt className="text-sm text-neutral-500">Email</dt>
            <dd className="truncate text-sm text-neutral-900">{staff.email}</dd>
          </div>
          <div className="flex items-center justify-between gap-4 py-2">
            <dt className="text-sm text-neutral-500">Access profile</dt>
            <dd>
              <Pill on>{p.name}</Pill>
            </dd>
          </div>
        </dl>
        <p className="mt-3 text-xs leading-relaxed text-neutral-400">
          Name, email and profile are set by an administrator. Editing them here is not
          built yet.
        </p>
      </Card>

      <Card className="col-span-full lg:col-span-6" title="Your access">
        <ul className="divide-y divide-neutral-100">
          {permissions.map(([label, allowed]) => (
            <li key={label} className="flex items-center justify-between gap-4 py-2">
              <span className="text-sm text-neutral-700">{label}</span>
              <Pill on={allowed}>{allowed ? 'Yes' : 'No'}</Pill>
            </li>
          ))}
        </ul>
        <p className="mt-3 text-xs leading-relaxed text-neutral-400">
          Set by your access profile and enforced in the database, not in this page.
        </p>
      </Card>

      <Card className="col-span-full lg:col-span-6" title="Two-factor authentication">
        <div className="flex items-start justify-between gap-4">
          <p className="text-sm leading-relaxed text-neutral-600">
            {mfa.enrolled
              ? 'Your account is protected by an authenticator app. You will be asked for a code when you sign in.'
              : 'Your password is currently the only thing protecting client data on this account.'}
          </p>
          <Pill on={mfa.enrolled}>{mfa.enrolled ? 'On' : 'Off'}</Pill>
        </div>

        {p.view_sensitive ? (
          <p className="mt-3 rounded-md bg-brand-50 px-3 py-2.5 text-xs leading-relaxed text-brand-700 ring-1 ring-brand-100">
            Your profile permits revealing tax file numbers and other sensitive
            identifiers. Those reveals require two-factor authentication and will be
            refused without it — the rule is enforced in the database, not just here.
          </p>
        ) : null}

        <EnrolPanel enrolled={mfa.enrolled} />
      </Card>

      <Card className="col-span-full lg:col-span-6" title="Session">
        <p className="text-sm leading-relaxed text-neutral-600">
          Signing out ends this session everywhere it is used, including any connected
          Claude session, immediately.
        </p>
        <form action={signOut} className="mt-4">
          <button
            type="submit"
            className="inline-flex items-center rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-sm font-medium text-neutral-800 outline-none transition-colors hover:bg-neutral-50 focus-visible:ring-2 focus-visible:ring-brand/30"
          >
            Sign out
          </button>
        </form>
      </Card>
    </>
  )
}
