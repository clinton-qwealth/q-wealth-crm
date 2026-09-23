import { notFound } from 'next/navigation'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { ParkingReport } from '@/components/parking-report-view'
import type { ParkingRow } from '@/lib/parking-report'

export const metadata = {
  /* "Q Wealth", not "Q Wealth CRM" — the reader of this page is not in the CRM
     and should not be told there is one. */
  title: 'Parking expenses · Q Wealth',
  /* Not indexed, and asked not to be followed either. The link is the only
     credential; a search engine that finds it in a crawled mailbox or a pasted
     document should not put it in an index. */
  robots: { index: false, follow: false },
}

/**
 * A read-only report, open to anyone holding the link.
 *
 * ## The only page here that runs without a session
 *
 * It sits under `/shared`, which `proxy.ts` lists in PUBLIC_PATHS. Everything
 * else in this application is unreachable without signing in, and that is
 * deliberate, so this directory is the one place to look when asking "what can
 * the public see".
 *
 * `/shared` is its own namespace on purpose. PUBLIC_PATHS is matched by PREFIX,
 * and the first version of this page lived at `/reports/parking/<token>`, which
 * meant listing `/reports` — an existing CRM page — and taking the proxy off
 * its door. A public route belongs on a prefix nothing else wants.
 *
 * ## It reads through ONE function and holds no privilege
 *
 * The client here is the ordinary one: the publishable key, and no session
 * unless the reader happens to be signed in. `anon` has no grant on any table —
 * that was true before this page existed and is still true — so the only thing
 * this page can do is call `parking_report(token)`, which refuses without a
 * live token and returns four columns.
 *
 * That means the privacy decision is NOT made here. This page cannot show a
 * mobile number or a location by mistake, because it is never given one. Adding
 * a column to the report is a migration, which is where a decision of that kind
 * should have to be made.
 *
 * ## A bad token is a 404, not an error
 *
 * Unknown, revoked, expired and "for another report" all look the same from
 * outside. Telling the holder of a wrong link which kind of wrong it is turns
 * the page into an oracle for guessing.
 *
 * ## The chrome is the layout's
 *
 * `app/shared/layout.tsx` supplies the bar, the ground and the grid, so this
 * file returns grid items and nothing else — the same shape as any page under
 * `(shell)`. It sets no width and no background of its own.
 *
 * ## The report body is a client component, and the reason is in the RPC
 *
 * `parking_report` increments `report_shares.view_count` on every call, so
 * re-running it for each filter change would record one visit as three.
 * `components/parking-report-view.tsx` takes these rows and narrows them in
 * the browser; `lib/parking-report.ts` carries the whole of that reasoning.
 * The heading travels with it, because the filters sit in the heading's own
 * row and so must be built where the filter state is.
 */
export default async function ParkingReportPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const supabase = await createSupabaseServerClient({ writable: false })
  const { data, error } = await supabase.rpc('parking_report', { p_token: token })
  if (error) notFound()

  /* The shape `parking_report` returns — four columns, and the function is
     where that list is decided. See the note above. */
  const rows = (data ?? []) as ParkingRow[]

  return (
    <>
      <ParkingReport rows={rows} />
    </>
  )
}
