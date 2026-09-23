import { redirect } from 'next/navigation'
import { getCurrentStaff, getRegistration } from '@/lib/staff'
import { isAdmin } from '@/lib/admin'
import { getMfaState } from '@/lib/mfa'
import { PageGround } from '@/components/page-ground'
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
  if (!staff) {
    /* Signed in but not active staff — a person who has asked to join, or
       been declined, or a stranger — goes to the request page, which says
       which. Until 19 September they were sent to the login page, signed in,
       and shown the login form again: a loop with no exit. */
    const registration = await getRegistration()
    redirect(registration.signedIn ? '/request-access' : '/login')
  }

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
    /* No background colour on this container, deliberately: it would paint
       straight over PageGround below, and the artwork would be in the markup
       and invisible. The paint order, and the day it cost, are written up in
       the component. */
    <div className="flex min-h-dvh flex-col">
      <TopNav
        staffFirstName={staff.first_name}
        staffLastName={staff.last_name}
        staffEmail={staff.email}
        isAdmin={isAdmin(staff)}
        staffId={staff.id}
        avatarPath={staff.avatar_path}
      />

      {/* Why it is a fixed layer, why it multiplies, and why the container
          above must stay transparent: see the component. Extracted 24 Sep 2026
          so the public share layout could have the same ground without a third
          copy of it. */}
      <PageGround />

      <main className="grid flex-1 auto-rows-min grid-cols-4 gap-4 px-3 py-5 sm:grid-cols-8 sm:px-5 lg:grid-cols-12 lg:gap-6 lg:py-7">
        {children}
      </main>
    </div>
  )
}
