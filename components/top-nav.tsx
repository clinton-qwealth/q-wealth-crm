import Link from 'next/link'
import { BrandMark } from './brand-mark'
import { HelpIcon } from './icons'
import { ProfileMenu } from './profile-menu'
import { SearchCommand } from './search-command'

const NAV_ITEMS = [
  { href: '/', label: 'Home' },
  { href: '/reports', label: 'Reports' },
]

/**
 * Thin top bar: mark and navigation on the left, search then help then the
 * account menu on the right. Deliberately 48px tall — this is a working tool,
 * and vertical space belongs to client data rather than to chrome.
 */
export function TopNav({ staffName, staffEmail }: { staffName?: string; staffEmail?: string }) {
  return (
    <header className="sticky top-0 z-40 border-b border-neutral-200 bg-white/95 backdrop-blur supports-[backdrop-filter]:bg-white/80">
      <div className="flex h-12 items-center gap-3 px-3 sm:gap-6 sm:px-5">
        <Link
          href="/"
          className="flex shrink-0 items-center rounded outline-none focus-visible:ring-2 focus-visible:ring-brand/30"
          aria-label="Q Wealth CRM home"
        >
          <BrandMark className="h-7 w-7 text-neutral-900" />
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

          <ProfileMenu name={staffName} email={staffEmail} />
        </div>
      </div>
    </header>
  )
}
