import { redirect } from 'next/navigation'
import { getCurrentStaff } from '@/lib/staff'
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

  return (
    <div className="flex min-h-dvh flex-col bg-white">
      <TopNav staffName={staff.full_name} />

      {/*
        A fixed, cover-positioned layer rather than `bg-fixed` on the container.
        `background-attachment: fixed` is unreliable on iOS Safari and interacts
        badly with the backdrop-filter on the navbar; a fixed element behind the
        content gives the same effect predictably.
      */}
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0 -z-10 bg-white bg-[url('/investing.png')] bg-cover bg-center bg-no-repeat"
      />

      <main className="grid flex-1 auto-rows-min grid-cols-4 gap-4 px-3 py-5 sm:grid-cols-8 sm:px-5 lg:grid-cols-12 lg:gap-6 lg:py-7">
        {children}
      </main>
    </div>
  )
}
