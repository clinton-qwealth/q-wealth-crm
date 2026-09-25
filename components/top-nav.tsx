import Link from 'next/link'
import { AreaBadge } from './area-badge'
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
 * ## Centred in the GAP, not on the bar — settled 25 September 2026
 *
 * The nav sat against the mark until the Administration pages grew a menu of
 * their own at the top of the left column. Two runs of links starting at the
 * same left edge, one above the other, read as one crowded control; moving
 * the bar's run off that edge separates them by position rather than by
 * another border.
 *
 * TWO centrings were built, and the second won. First a
 * `minmax(0,1fr) auto minmax(0,1fr)` grid put the links on the bar's true
 * centre, where they hold still on every page — geometrically right and
 * optically wrong, Clinton's call on looking at it: the right flank is heavy
 * (a 256px search box plus two controls) and the left is one small mark, so
 * true centre left a hole on the left and a squeeze on the right. The links
 * now centre in the SPACE BETWEEN the mark and the search box — `flex-1
 * justify-center` on the middle — which sits them left of the bar's centre by
 * half the flanks' difference, evenly breathing on both sides. The known cost
 * is the one the grid avoided: the run shifts a little when the flanks change
 * width, most visibly when the Administration pill appears. Chosen with that
 * stated.
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
      <div className="flex h-12 items-center gap-3 px-3 sm:gap-6 sm:px-5">
        {/* Left flank: who we are, and — in the admin area — where you are. */}
        <div className="flex min-w-0 shrink-0 items-center gap-2.5">
          <Link
            href="/"
            className="flex shrink-0 items-center rounded outline-none focus-visible:ring-2 focus-visible:ring-brand/30"
            aria-label="Q Wealth CRM home"
          >
            <BrandMark className="h-7 w-7 text-neutral-900" />
          </Link>
          <AreaBadge />
        </div>

        {/* The slack lives HERE, and the nav floats on the middle of it —
            evenly spaced off the mark and off the search box. See the header
            note for why this beat the bar's true centre. */}
        <div className="flex min-w-0 flex-1 justify-center">
          <TopNavLinks />
        </div>

        {/* Right flank: search, then the two controls. */}
        <div className="flex shrink-0 items-center gap-3">
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
