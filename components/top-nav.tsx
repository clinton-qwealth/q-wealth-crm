import Link from 'next/link'
import { AdminBadge } from './admin-badge'
import { BrandMark } from './brand-mark'
import { HelpIcon } from './icons'
import { ProfileMenu } from './profile-menu'
import { SearchCommand } from './search-command'
import { TopNavLinks } from './top-nav-links'

/**
 * Thin top bar: the mark (and, in the admin area, its pill) on the left, the
 * navigation in the CENTRE, search then help then the account menu on the
 * right. Deliberately 48px tall — this is a working tool, and vertical space
 * belongs to client data rather than to chrome.
 *
 * ## Centred since 25 September 2026
 *
 * The nav sat against the mark until the Administration pages grew a menu of
 * their own at the top of the left column. Two runs of links starting at the
 * same left edge, one above the other, read as one crowded control; centring
 * the bar's run separates them by position rather than by another border.
 *
 * The grid is `minmax(0,1fr) auto minmax(0,1fr)` — equal flanks, so the nav
 * sits on the bar's TRUE centre and does not drift when the pill appears on
 * the left or the search grows on the right. A flex row with the nav between
 * two spacers centres it relative to its neighbours instead, which moves the
 * links between pages; the whole point of centring is that they hold still.
 * `minmax(0, …)` rather than bare `1fr`, because a bare `1fr` track's minimum
 * is its content and the search box would push the nav off-centre exactly
 * when space got tight.
 *
 * **Still a server component.** The destinations moved to TopNavLinks on
 * 10 September, because marking the current one needs the pathname and the
 * pathname needs a client boundary. Only that list crossed it — and the
 * Administration pill, which needs the same fact for the same reason. The
 * mark, the Help icon and the bar itself did not.
 */
export function TopNav({
  staffFirstName,
  staffLastName,
  staffEmail,
  isAdmin = false,
  staffId,
  avatarPath = null,
}: {
  staffFirstName?: string
  staffLastName?: string
  staffEmail?: string
  isAdmin?: boolean
  staffId?: string
  avatarPath?: string | null
}) {
  return (
    <header className="sticky top-0 z-40 border-b border-neutral-200 bg-white/95 backdrop-blur supports-[backdrop-filter]:bg-white/80">
      <div className="grid h-12 grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-3 px-3 sm:gap-6 sm:px-5">
        {/* Left flank: who we are, and — in the admin area — where you are. */}
        <div className="flex min-w-0 items-center gap-2.5">
          <Link
            href="/"
            className="flex shrink-0 items-center rounded outline-none focus-visible:ring-2 focus-visible:ring-brand/30"
            aria-label="Q Wealth CRM home"
          >
            <BrandMark className="h-7 w-7 text-neutral-900" />
          </Link>
          <AdminBadge />
        </div>

        {/* The centre track. `auto`, so the nav sets its own width and the
            flanks split what is left equally — which is what centres it. */}
        <TopNavLinks />

        {/* Right flank, right-aligned: search, then the two controls. */}
        <div className="flex min-w-0 items-center justify-end gap-3">
          <SearchCommand />

          <div className="flex shrink-0 items-center gap-1">
            <Link
              href="/help"
              aria-label="Help"
              title="Help"
              className="flex h-8 w-8 items-center justify-center rounded-md text-neutral-500 outline-none transition-colors hover:bg-neutral-100 hover:text-neutral-900 focus-visible:ring-2 focus-visible:ring-brand/30"
            >
              <HelpIcon className="h-[18px] w-[18px]" />
            </Link>

            <ProfileMenu firstName={staffFirstName} lastName={staffLastName} email={staffEmail} isAdmin={isAdmin} staffId={staffId} avatarPath={avatarPath} />
          </div>
        </div>
      </div>
    </header>
  )
}
