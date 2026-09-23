import { notFound } from 'next/navigation'
import { formatCalendarDate } from '@/lib/note-date'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { Card, PageHeading, SHEET_SURFACE } from '@/components/ui'

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
 */
export default async function ParkingReportPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const supabase = await createSupabaseServerClient({ writable: false })
  const { data, error } = await supabase.rpc('parking_report', { p_token: token })
  if (error) notFound()

  const rows = (data ?? []) as {
    person_name: string
    payment_date: string | null
    ticket: string
    amount_cents: number | null
  }[]
  const total = rows.reduce((sum, r) => sum + (r.amount_cents ?? 0), 0)

  return (
    <>
      <PageHeading
        eyebrow="Q Wealth"
        title="Parking expenses"
        description={`${rows.length} ${rows.length === 1 ? 'receipt' : 'receipts'}, texted in and recorded automatically.`}
      />

      {rows.length === 0 ? (
        <Card className="col-span-full lg:col-span-8">
          <p className="text-center text-sm font-medium text-neutral-700">Nothing here yet</p>
          <p className="mx-auto mt-1 max-w-xs text-center text-xs leading-relaxed text-neutral-500">
            Receipts appear as they are texted in. The link keeps working — come back later.
          </p>
        </Card>
      ) : (
        /* SHEET_SURFACE rather than SHEET: SHEET bakes in `overflow-hidden` to
           clip hairline rows to the rounded corner, and this table needs
           `overflow-x-auto` to scroll on a phone. Stacking the two would leave
           which one applies to whichever rule Tailwind emits last. SURFACE is
           the same surface without the clip, which is the case it exists for. */
        <div className={`${SHEET_SURFACE} col-span-full overflow-x-auto lg:col-span-8`}>
          <table className="w-full min-w-[34rem] border-collapse text-sm">
            <thead>
              <tr className="border-b border-neutral-200 text-left text-[11px] uppercase tracking-widest text-neutral-400">
                <th className="px-4 py-2.5 font-semibold">Person</th>
                <th className="px-4 py-2.5 font-semibold">Date</th>
                <th className="px-4 py-2.5 font-semibold">Ticket</th>
                <th className="px-4 py-2.5 text-right font-semibold">Amount</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100">
              {rows.map((r) => (
                <tr key={r.ticket}>
                  <td className="px-4 py-2.5 text-neutral-800">{r.person_name}</td>
                  {/* Split from the string, never through new Date(): a calendar
                      date read as a moment prints as the day before west of
                      Greenwich, and this page is read by whoever is paying. */}
                  <td className="px-4 py-2.5 tabular-nums text-neutral-600">
                    {r.payment_date ? formatCalendarDate(r.payment_date) : '—'}
                  </td>
                  <td className="px-4 py-2.5 font-mono text-xs text-neutral-500">{r.ticket}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-neutral-800">{money(r.amount_cents)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t border-neutral-200 font-medium">
                <td className="px-4 py-2.5 text-neutral-500" colSpan={3}>
                  Total
                </td>
                <td className="px-4 py-2.5 text-right tabular-nums text-neutral-900">{money(total)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      <p className="col-span-full text-xs leading-relaxed text-neutral-400 lg:col-span-8">
        This page is read-only and is shared by link. It shows nothing beyond what is above.
      </p>
    </>
  )
}

/** Cents to dollars, built from the integer. Separators written by hand so the
 *  figures do not change shape with the server's locale. */
function money(cents: number | null): string {
  if (cents === null) return '—'
  const negative = cents < 0
  const abs = Math.abs(cents)
  const dollars = String(Math.floor(abs / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  return `${negative ? '-$' : '$'}${dollars}.${String(abs % 100).padStart(2, '0')}`
}
