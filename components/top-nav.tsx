import Link from 'next/link'
import { BrandMark } from './brand-mark'
import { HelpIcon, UserIcon } from './icons'
import { SearchCommand } from './search-command'

const NAV_ITEMS = [
  { href: '/', label: 'Home' },
  { href: '/reports', label: 'Reports' },
]

function initialsOf(name: string | undefined) {
  if (!name) return null
  const parts = name.trim().split(/\s+/).slice(0, 2)
  return parts.map((p) => p[0]?.toUpperCase()).join('') || null
}

/**
 * Thin top bar: mark and navigation on the left, search then help then profile
 * on the right. Deliberately 48px tall — this is a working tool, and vertical
 * space belongs to client data rather than to chrome.
 */
export function TopNav({ staffName }: { staffName?: string }) {
  const initials = initialsOf(staffName)

  return (
    <header className="sticky top-0 z-40 border-b border-neutral-200 bg-white/95 backdrop-blur supports-[backdrop-filter]:bg-white/80">
      <div className="flex h-12 items-center gap-3 px-3 sm:gap-6 sm:px-5">
        <Link
          href="/"
          className="flex shrink-0 items-center gap-2 rounded outline-none focus-visible:ring-2 focus-visible:ring-brand/30"
          aria-label="Q Wealth CRM home"
        >
          <BrandMark className="h-6 w-6 text-neutral-900" />
          <span className="hidden text-sm font-semibold tracking-tight text-neutral-900 lg:inline">
            Q Wealth
          </span>
        </Link>

        <nav aria-label="Main" className="hidden items-center gap-1 sm:flex">
          {NAV_ITEMS.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="rounded-md px-2.5 py-1.5 text-sm text-neutral-600 outline-none transition-colors hover:bg-neutral-100 hover:text-neutral-900 focus-visible:ring-2 focus-visible:ring-brand/30"
            >
              {item.label}
            </Link>
          ))}
        </nav>

        {/* Search takes the slack, so it grows with the window rather than
            leaving a gap between the nav and the right-hand controls. */}
        <div className="ml-auto flex min-w-0 flex-1 justify-end">
          <SearchCommand />
        </div>

        <div className="flex shrink-0 items-center gap-1">
          <Link
            href="/help"
            aria-label="Help"
            title="Help"
            className="flex h-8 w-8 items-center justify-center rounded-md text-neutral-500 outline-none transition-colors hover:bg-neutral-100 hover:text-neutral-900 focus-visible:ring-2 focus-visible:ring-brand/30"
          >
            <HelpIcon className="h-[18px] w-[18px]" />
          </Link>

          <Link
            href="/security"
            aria-label={staffName ? `Account: ${staffName}` : 'Account'}
            title={staffName ?? 'Account'}
            className="flex h-8 w-8 items-center justify-center rounded-full outline-none transition-colors focus-visible:ring-2 focus-visible:ring-brand/30"
          >
            {initials ? (
              <span className="flex h-7 w-7 items-center justify-center rounded-full bg-brand-100 text-[11px] font-semibold text-brand-700 ring-1 ring-brand-200 transition-colors hover:bg-brand-200">
                {initials}
              </span>
            ) : (
              <span className="flex h-7 w-7 items-center justify-center rounded-full bg-neutral-100 text-neutral-500 ring-1 ring-neutral-200 hover:bg-neutral-200">
                <UserIcon className="h-[18px] w-[18px]" />
              </span>
            )}
          </Link>
        </div>
      </div>
    </header>
  )
}
