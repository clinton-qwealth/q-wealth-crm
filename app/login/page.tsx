import { redirect } from 'next/navigation'
import { getCurrentStaff } from '@/lib/staff'
import { safeNext } from '@/lib/safe-next'
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
    <main className="flex min-h-full flex-1 items-center justify-center px-6 py-16">
      <div className="w-full max-w-sm">
        <div className="mb-8">
          <h1 className="text-xl font-semibold tracking-tight">Q Wealth CRM</h1>
          <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
            Staff sign in
          </p>
        </div>
        <LoginForm next={next} />
      </div>
    </main>
  )
}
