import Image from 'next/image'
import type { ReactNode } from 'react'

/**
 * The frame shared by every screen reached before the app proper: sign in, the
 * MFA challenge, and mandatory enrolment.
 *
 * One component rather than three copies, because these screens are seen in
 * sequence — signing in, then being asked for a code — and any drift between
 * them reads as a broken redirect rather than a design choice.
 *
 * The artwork is a fixed, cover-positioned layer behind the card rather than a
 * `bg-fixed` utility on the container: `background-attachment: fixed` is
 * unreliable on iOS Safari. Same approach as the authenticated shell.
 */
export function AuthShell({
  title,
  description,
  children,
  footer,
  width = 'sm',
}: {
  title: string
  description?: ReactNode
  children: ReactNode
  /** Small print below the card — outside it, so the card stays the form. */
  footer?: ReactNode
  /** Enrolment needs more room for a QR code than a six-digit field does. */
  width?: 'sm' | 'md'
}) {
  return (
    <div className="relative flex min-h-dvh flex-1 flex-col items-center justify-center px-4 py-10 sm:px-6">
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0 -z-10 bg-neutral-100 bg-[url('/investing.png')] bg-cover bg-center bg-no-repeat"
      />

      <div className={width === 'md' ? 'w-full max-w-md' : 'w-full max-w-sm'}>
        <div className="rounded-2xl border border-neutral-200/80 bg-white p-7 shadow-xl shadow-neutral-900/[0.07] sm:p-8">
          <Image
            src="/qwealth-logo.svg"
            alt="Q Wealth"
            width={86}
            height={83}
            priority
            className="h-16 w-auto"
          />

          <h1 className="mt-7 text-lg font-semibold tracking-tight text-neutral-900">{title}</h1>
          {description ? (
            <p className="mt-1.5 text-sm leading-relaxed text-neutral-600">{description}</p>
          ) : null}

          <div className="mt-6">{children}</div>
        </div>

        {footer ? (
          <p className="mt-5 px-1 text-center text-xs leading-relaxed text-neutral-500">
            {footer}
          </p>
        ) : null}
      </div>
    </div>
  )
}
