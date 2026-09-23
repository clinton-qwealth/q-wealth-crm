'use client'

import { useState } from 'react'
import { formatCalendarDate, monthLabel } from '@/lib/note-date'
import {
  applyFilters,
  filterOptions,
  money,
  reconcileFilters,
  totalCents,
  NO_DATE,
  NO_FILTERS,
  type ParkingFilters,
  type ParkingRow,
} from '@/lib/parking-report'
import { SHEET_SURFACE } from '@/components/ui'

/**
 * The shared parking report's table, with its two filters.
 *
 * A client component because the filtering is: the rows arrive once from the
 * server and are narrowed here. `lib/parking-report.ts` explains why they are
 * not narrowed in the database — calling the RPC again would count another
 * view of the share link.
 *
 * Plain `<select>`s, following `components/kanban-board.tsx`: every filter in
 * this application is a native select, and a filter is a control rather than a
 * feature — the figures are the thing to look at.
 */
export function ParkingReportTable({ rows }: { rows: ParkingRow[] }) {
  const [filters, setFiltersRaw] = useState<ParkingFilters>(NO_FILTERS)

  /* Reconciled on every change, so the person select is never left naming
     somebody the chosen month does not contain. */
  const setFilters = (patch: Partial<ParkingFilters>) =>
    setFiltersRaw((f) => reconcileFilters(rows, { ...f, ...patch }))

  const options = filterOptions(rows, filters)
  const shown = applyFilters(rows, filters)
  const filtering = filters.month !== null || filters.person !== null

  /* The total follows the table. A total that still reads the whole report
     while one month is displayed is a wrong number on a page somebody is
     paying from — so it is computed from `shown`, never from `rows`. */
  const total = totalCents(shown)

  return (
    <>
      <div className="col-span-full flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-neutral-500 lg:col-span-8">
        <label className="flex items-center gap-1.5">
          Month
          <select
            aria-label="Filter by month"
            value={filters.month ?? ''}
            onChange={(e) => setFilters({ month: e.target.value || null })}
            className={SELECT}
          >
            <option value="">All months</option>
            {options.months.map((m) => (
              <option key={m} value={m}>
                {m === NO_DATE ? 'No date' : monthLabel(m)}
              </option>
            ))}
          </select>
        </label>

        <label className="flex items-center gap-1.5">
          Person
          <select
            aria-label="Filter by person"
            value={filters.person ?? ''}
            onChange={(e) => setFilters({ person: e.target.value || null })}
            className={SELECT}
          >
            {/* "Anyone", the audit trail's wording for a person filter — "All
                people" reads as a category rather than as no choice made. */}
            <option value="">Anyone</option>
            {options.people.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </label>

        {filtering ? (
          <span className="flex items-center gap-2">
            <span className="tabular-nums">
              Showing {shown.length} of {rows.length}
            </span>
            <button
              type="button"
              onClick={() => setFiltersRaw(NO_FILTERS)}
              className="rounded-md px-1.5 py-0.5 font-medium text-brand outline-none hover:bg-brand-50 focus-visible:ring-2 focus-visible:ring-brand/30"
            >
              Clear
            </button>
          </span>
        ) : null}
      </div>

      {shown.length === 0 ? (
        /*
         * ONE empty state, not two, and that is a consequence of the design
         * rather than a shortcut.
         *
         * The usual pairing is "nothing here yet" against "nothing matches
         * these filters" — `components/kanban-board.tsx` has exactly that. It
         * is not needed here: the months offered are months that have
         * receipts, the people offered are people with a receipt in the chosen
         * month, and `reconcileFilters` drops a person the new month strands.
         * So no combination these two controls can reach is empty, and a
         * "nothing matches" branch would be unreachable text asserting a state
         * the component cannot be in.
         *
         * `__tests__/parking-report-table.test.tsx` walks every offered
         * combination and proves it, so if a later change breaks the property
         * the answer is to add the second empty state back — not to delete the
         * test.
         *
         * `text-center` sits on the paragraphs and never on the container —
         * `__tests__/inherited-alignment.test.ts` holds that line.
         */
        <div className="col-span-full flex flex-col items-center justify-center rounded-lg border border-dashed border-neutral-200 bg-neutral-50/60 px-6 py-10 lg:col-span-8">
          <p className="text-center text-sm font-medium text-neutral-700">Nothing here yet</p>
          <p className="mt-1 max-w-xs text-center text-xs leading-relaxed text-neutral-500">
            Receipts appear as they are texted in. The link keeps working — come back later.
          </p>
        </div>
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
              {shown.map((r) => (
                <tr key={r.ticket}>
                  <td className="px-4 py-2.5 text-neutral-800">{r.person_name}</td>
                  {/* Split from the string, never through new Date(): a calendar
                      date read as a moment prints as the day before west of
                      Greenwich, and this page is read by whoever is paying. */}
                  <td className="px-4 py-2.5 tabular-nums text-neutral-600">
                    {r.payment_date ? formatCalendarDate(r.payment_date) : '—'}
                  </td>
                  <td className="px-4 py-2.5 font-mono text-xs text-neutral-500">{r.ticket}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-neutral-800">
                    {money(r.amount_cents)}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t border-neutral-200 font-medium">
                <td className="px-4 py-2.5 text-neutral-500" colSpan={3}>
                  {filtering ? 'Total shown' : 'Total'}
                </td>
                <td className="px-4 py-2.5 text-right tabular-nums text-neutral-900">
                  {money(total)}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </>
  )
}

const SELECT =
  'rounded-md border border-neutral-200 bg-white px-2 py-1 text-xs text-neutral-700 outline-none focus-visible:ring-2 focus-visible:ring-brand/30'
