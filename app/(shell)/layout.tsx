import { redirect } from 'next/navigation'
import { getCurrentStaff } from '@/lib/staff'
import { getMfaState } from '@/lib/mfa'
import { TopNav } from '@/components/top-nav'

/**
 * The authenticated application shell: thin top bar, fixed background artwork,
 * and a full-width grid for content.
 *
 * Sign-in, MFA step-up and the OAuth consent screen deliberately sit outside
 * this group — they are reached before or instead of the app, and should not
 * present navigation the visitor cannot use.
 */
export default async function ShellLayout({ children }: { children: React.ReactNode }) {
  const staff = await getCurrentStaff()
  if (!staff) redirect('/login')

  /*
   * Two-factor authentication is mandatory, enforced here rather than on each
   * page so a new route cannot be added without it.
   *
   * Both redirect targets sit outside this route group, which is what keeps the
   * unenrolled case from looping through the layout that sent it.
   *
   * This is app-side enforcement, and deliberately so: requiring `aal2` in RLS
   * would be stronger, but an OAuth-issued session carries `aal1` even when the
   * browser session that authorised it was `aal2`, so it would take the MCP
   * connector down. The consent screen carries the same gate instead, which
   * means every token ever issued was authorised by someone holding a second
   * factor — enforcement at issuance rather than on each use.
   */
  const mfa = await getMfaState()
  if (!mfa.enrolled) redirect('/mfa/enrol')
  if (mfa.stepUpRequired) redirect('/mfa?next=%2F')

  return (
    /* No background colour on this container, deliberately. A negative
       z-index child paints after the STACKING CONTEXT ROOT's background but
       before its parent's, and this div creates no stacking context — so a
       bg-white here painted straight over the artwork below. The image had been
       in the markup and invisible; the login and MFA screens showed it only
       because their container has no background of its own. The layer below
       carries its own fallback colour, so nothing is lost. */
    <div className="flex min-h-dvh flex-col">
      <TopNav staffName={staff.full_name} staffEmail={staff.email} />

      {/*
        A fixed, cover-positioned layer rather than `bg-fixed` on the container.
        `background-attachment: fixed` is unreliable on iOS Safari and interacts
        badly with the backdrop-filter on the navbar; a fixed element behind the
        content gives the same effect predictably.
      */}
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0 -z-10 bg-neutral-100 bg-[url('/investing.png')] bg-cover bg-center bg-no-repeat"
      />

      <main className="grid flex-1 auto-rows-min grid-cols-4 gap-4 px-3 py-5 sm:grid-cols-8 sm:px-5 lg:grid-cols-12 lg:gap-6 lg:py-7">
        {children}
      </main>
    </div>
  )
}
