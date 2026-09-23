import { BrandMark } from './brand-mark'

/**
 * The top bar for a visitor holding a share link and nothing else.
 *
 * The same 48px bar as the application's — same height, same border, same
 * translucent white and backdrop blur — so a shared report reads as part of the
 * product rather than as a different site. What it does NOT have is everything
 * that needs a session.
 *
 * ## Why this is not `TopNav` with the props left off
 *
 * It would render. Every one of `TopNav`'s staff props is optional and
 * `ProfileMenu` already falls back to a generic circle with no name. The
 * problem is what the visitor would then be looking at:
 *
 *   - `TopNavLinks` points at `/`, `/groups`, `/workflows` and `/reports`.
 *     All four are protected, so all four 307 to `/login`.
 *   - `SearchCommand` is a search box that cannot search.
 *   - The Help icon points at `/help`, also protected.
 *   - `ProfileMenu` offers an account menu to someone with no account.
 *
 * A bar of controls that all bounce to a sign-in screen is worse than no bar:
 * it invites four clicks that each fail, and it advertises the shape of an
 * application the reader has no business in. So the mark, and nothing else.
 *
 * ## The mark is not a link, deliberately
 *
 * `/` is a real route, so `__tests__/no-dead-links.test.ts` would accept
 * `href="/"` here — and a signed-out visitor clicking it would land on the
 * login form. `BrandMark` is inline SVG carrying `role="img"` and
 * `aria-label="Q Wealth"`, so it announces itself without a wrapping link and
 * nothing on this bar can disappoint.
 *
 * Server component. It has no state, no pathname to read and no boundary to
 * cross — the reason `TopNav` needs client children is the current-page fill,
 * and there are no destinations here to fill.
 */
export function PublicNav() {
  return (
    <header className="sticky top-0 z-40 border-b border-neutral-200 bg-white/95 backdrop-blur supports-[backdrop-filter]:bg-white/80">
      <div className="flex h-12 items-center gap-3 px-3 sm:gap-6 sm:px-5">
        <BrandMark className="h-7 w-7 shrink-0 text-neutral-900" />
      </div>
    </header>
  )
}
