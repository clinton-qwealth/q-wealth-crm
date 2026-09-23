import { PageGround } from '@/components/page-ground'
import { PublicNav } from '@/components/public-nav'

/**
 * The frame for pages reached by share link, with no session at all.
 *
 * It is `app/(shell)/layout.tsx` with the three gates removed, and that is the
 * entire difference — same bar height, same artwork ground, same twelve-column
 * grid — so a shared report reads as a page of the product rather than as a
 * separate site. The shell fetches the staff record, checks MFA and redirects;
 * this fetches nothing and redirects nowhere, which is why it is a second
 * layout rather than a shared one with a flag. A layout that sometimes enforces
 * a boundary is a layout somebody will eventually reach the wrong branch of.
 *
 * **Everything under `/shared` is public.** `proxy.ts` lists `/shared` in
 * PUBLIC_PATHS and matches by prefix, so adding a page to this directory
 * publishes it. The token check lives in the database — `anon` holds no grant
 * on any table, so a page here can only call a function that refuses without a
 * live token. This layout adds no privilege and reads nothing; it is chrome.
 */
export default function SharedLayout({ children }: { children: React.ReactNode }) {
  return (
    /* NO BACKGROUND COLOUR ON THIS CONTAINER. PageGround is a `-z-10` child and
       this div creates no stacking context, so a background here would paint
       over the artwork and the page would be silently white. The component's
       own header explains the paint order. */
    <div className="flex min-h-dvh flex-col">
      <PublicNav />
      <PageGround />

      {/* The authenticated shell's grid, verbatim, so a page written for one
          renders identically in the other and `col-span-*` means the same
          thing in both. */}
      <main className="grid flex-1 auto-rows-min grid-cols-4 gap-4 px-3 py-5 sm:grid-cols-8 sm:px-5 lg:grid-cols-12 lg:gap-6 lg:py-7">
        {children}
      </main>
    </div>
  )
}
