import { describe, expect, test } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import React from 'react'
import type { ParkingRow } from '@/lib/parking-report'

const { ParkingReport } = await import('@/components/parking-report-view')

const row = (over: Partial<ParkingRow>): ParkingRow => ({
  person_name: 'Clinton Hatcher',
  payment_date: '2026-09-14',
  submitted_on: '2026-09-15',
  ticket: '81000210953',
  amount_cents: 2508,
  ...over,
})

const set: ParkingRow[] = [
  row({ ticket: 'a', payment_date: '2026-09-14', submitted_on: '2026-10-02', person_name: 'Clinton Hatcher', amount_cents: 2508 }),
  row({ ticket: 'b', payment_date: '2026-09-02', submitted_on: '2026-09-02', person_name: 'Sarah Chen', amount_cents: 1000 }),
  row({ ticket: 'c', payment_date: '2026-08-30', submitted_on: '2026-10-02', person_name: 'Clinton Hatcher', amount_cents: 500 }),
]

const optionsOf = (name: string) =>
  [...(screen.getByRole('combobox', { name }) as HTMLSelectElement).querySelectorAll('option')].map(
    (o) => o.textContent,
  )

const total = () => within(screen.getByRole('table')).getAllByRole('row').at(-1)!.textContent

describe('the parking report', () => {
  test('unfiltered, it shows every receipt and no count', () => {
    render(<ParkingReport rows={set} />)
    expect(screen.getAllByRole('row')).toHaveLength(5) // head + 3 + foot
    expect(screen.queryByText(/Showing/)).toBeNull()
    expect(screen.queryByRole('button', { name: 'Clear' })).toBeNull()
  })

  /**
   * The filters sit on the heading's OWN ROW, right-aligned — asked for
   * 24 Sep 2026, and the reason this component owns the heading at all.
   *
   * Asserted structurally rather than by class name: the selects must be
   * inside the container that holds the <h1>, which is what `PageHeading`'s
   * `actions` slot gives and what a bar rendered as PageHeading's sibling
   * would not.
   *
   * Mutation, and it was run: render the bar as a sibling after
   * <PageHeading /> instead of passing it as `actions` — the selects leave the
   * heading's container and this fails.
   */
  test('the filters share the heading’s row rather than taking one of their own', () => {
    render(<ParkingReport rows={set} />)
    const headingRow = screen.getByRole('heading', { level: 1 }).closest('.col-span-full')
    expect(headingRow).not.toBeNull()
    /* Plain DOM `contains`, not jest-dom's toContainElement — this project
       registers no jest-dom matchers, which is why nothing here says
       toBeInTheDocument either. */
    expect(headingRow!.contains(screen.getByRole('combobox', { name: 'Filter by month' }))).toBe(true)
    expect(headingRow!.contains(screen.getByRole('combobox', { name: 'Filter by person' }))).toBe(true)
  })

  /**
   * Three columns, 3 / 6 / 3 — the layout `/admin` uses, asked for 24 Sep 2026.
   *
   * The whole report goes in the middle one, heading included. `/admin` puts
   * its heading full width above the three; this does not, because the filters
   * sit in the heading's row and a full-width heading would leave them at the
   * far right of the window with their table six columns away.
   *
   * Pinned by class because the span IS the requirement here — there is no
   * behaviour to observe instead.
   */
  test('the report sits in the middle of three columns, flanked by two reserved ones', () => {
    const { container } = render(<ParkingReport rows={set} />)
    const columns = [...container.children] as HTMLElement[]
    expect(columns).toHaveLength(3)

    const [left, centre, right] = columns
    /* 3 / 6 / 3 from `xl` up. Between `lg` and `xl` the middle one widens to
       2 / 8 / 2, because five columns do not fit 6/12 at 1024px and the Amount
       was being clipped. Still three columns, still two reserved. */
    expect(left.className).toContain('xl:col-span-3')
    expect(centre.className).toContain('xl:col-span-6')
    expect(right.className).toContain('xl:col-span-3')
    expect(left.className).toContain('lg:col-span-2')
    expect(centre.className).toContain('lg:col-span-8')
    expect(right.className).toContain('lg:col-span-2')

    /* The outer two are reserved, and empty is what reserved means. */
    expect(left.childElementCount).toBe(0)
    expect(right.childElementCount).toBe(0)

    /* Everything is in the middle: title, filters, table and the footnote. */
    expect(centre.contains(screen.getByRole('heading', { level: 1 }))).toBe(true)
    expect(centre.contains(screen.getByRole('combobox', { name: 'Filter by month' }))).toBe(true)
    expect(centre.contains(screen.getByRole('table'))).toBe(true)
    expect(centre.textContent).toContain('read-only and is shared by link')
  })

  test('the heading counts the whole report, not what the filter leaves', async () => {
    const user = userEvent.setup()
    render(<ParkingReport rows={set} />)
    expect(screen.getByText('3 receipts, texted in and recorded automatically.')).toBeTruthy()

    await user.selectOptions(screen.getByRole('combobox', { name: 'Filter by month' }), '2026-08')
    /* The description says what the LINK contains and must not move; the bar's
       own "Showing 1 of 3" is what tracks the filter. */
    expect(screen.getByText('3 receipts, texted in and recorded automatically.')).toBeTruthy()
    expect(screen.getByText('Showing 1 of 3')).toBeTruthy()
  })

  /**
   * THE SUBMISSION DATE, added 24 Sep 2026.
   *
   * Receipt `a` was paid on 14 September and texted in on 2 October -- the
   * common case, because people forward a month's parking in one go. The two
   * dates must appear in their own columns and in that order, because a reader
   * reimbursing these needs to tell a fresh receipt from a late one.
   *
   * Asserted by reading the row's cells in order rather than by searching for
   * the text, so a version that rendered the submission date into the PAID
   * column -- or swapped the two -- fails rather than passing on a substring.
   *
   * Mutation, and it was run: render {r.payment_date} in the submitted cell,
   * and this fails on "14 Sep 2026" appearing where "2 Oct 2026" belongs.
   */
  test('a receipt shows when it was paid and, separately, when it was sent in', () => {
    render(<ParkingReport rows={[set[0]]} />)

    const headers = within(screen.getByRole('table'))
      .getAllByRole('columnheader')
      .map((h) => h.textContent)
    expect(headers).toEqual(['Person', 'Paid', 'Submitted', 'Ticket', 'Amount'])

    const cells = within(screen.getByRole('table')).getAllByRole('cell').map((c) => c.textContent)
    expect(cells).toEqual(['Clinton Hatcher', '14 Sep 2026', '2 Oct 2026', 'a', '$25.08', 'Total', '$25.08'])
  })

  /**
   * `submitted_on` arrives as a `YYYY-MM-DD` calendar date because the RPC
   * already converted created_at in Australia/Sydney. It must be rendered by
   * splitting that string, never by constructing a Date -- which is both the
   * rule lib/note-date.ts exists for AND, since this table is a client
   * component, what would make the server and the browser disagree.
   *
   * The 1st of a month is the case that exposes it: as an instant at UTC
   * midnight it is the previous month anywhere west of Greenwich.
   */
  test('the first of a month is that month, whatever the runtime thinks', () => {
    render(<ParkingReport rows={[row({ ticket: 'x', payment_date: '2026-10-01', submitted_on: '2026-10-01' })]} />)
    const cells = within(screen.getByRole('table')).getAllByRole('cell').map((c) => c.textContent)
    expect(cells.slice(0, 3)).toEqual(['Clinton Hatcher', '1 Oct 2026', '1 Oct 2026'])
  })

  test('the months offered are the months that have receipts, newest first', () => {
    render(<ParkingReport rows={set} />)
    expect(optionsOf('Filter by month')).toEqual(['All months', 'Sep 2026', 'Aug 2026'])
  })

  /**
   * THE ONE THAT MATTERS. A filtered table with an unfiltered total is a wrong
   * number on a page somebody is paying from, and it is the mistake the
   * obvious implementation makes — the total is computed once, above the
   * filter, and never moves.
   *
   * Mutation, and it was run: compute the total from `rows` instead of
   * `shown` in parking-report-table.tsx — the table narrows to $5.00 of
   * receipts and the footer keeps claiming $40.08. This fails.
   */
  test('the total follows the filter', async () => {
    const user = userEvent.setup()
    render(<ParkingReport rows={set} />)
    expect(total()).toContain('$40.08')

    await user.selectOptions(screen.getByRole('combobox', { name: 'Filter by month' }), '2026-08')
    expect(screen.getByText('Showing 1 of 3')).toBeTruthy()
    expect(total()).toContain('$5.00')
    /* And it says so, rather than presenting a part as the whole. */
    expect(total()).toContain('Total shown')
  })

  test('choosing a month narrows the people on offer', async () => {
    const user = userEvent.setup()
    render(<ParkingReport rows={set} />)
    expect(optionsOf('Filter by person')).toEqual(['Anyone', 'Clinton Hatcher', 'Sarah Chen'])

    await user.selectOptions(screen.getByRole('combobox', { name: 'Filter by month' }), '2026-08')
    expect(optionsOf('Filter by person')).toEqual(['Anyone', 'Clinton Hatcher'])
  })

  test('a person the new month does not contain is cleared, not left stranded', async () => {
    const user = userEvent.setup()
    render(<ParkingReport rows={set} />)
    await user.selectOptions(screen.getByRole('combobox', { name: 'Filter by person' }), 'Sarah Chen')
    expect(screen.getByText('Showing 1 of 3')).toBeTruthy()

    await user.selectOptions(screen.getByRole('combobox', { name: 'Filter by month' }), '2026-08')
    /* Sarah has no August receipt. The table must not be empty while the
       select still reads "Sarah Chen". */
    expect((screen.getByRole('combobox', { name: 'Filter by person' }) as HTMLSelectElement).value).toBe('')
    expect(screen.getByText('Showing 1 of 3')).toBeTruthy()
    /* Scoped to the table: "Clinton Hatcher" is also an <option>. */
    expect(within(screen.getByRole('table')).getByText('Clinton Hatcher')).toBeTruthy()
  })

  test('Clear puts every receipt back', async () => {
    const user = userEvent.setup()
    render(<ParkingReport rows={set} />)
    await user.selectOptions(screen.getByRole('combobox', { name: 'Filter by month' }), '2026-08')
    await user.click(screen.getByRole('button', { name: 'Clear' }))
    expect(screen.queryByText(/Showing/)).toBeNull()
    expect(total()).toContain('$40.08')
  })

  /**
   * THE PROPERTY THAT REMOVES AN EMPTY STATE.
   *
   * The component has one empty state — "Nothing here yet" — and no "nothing
   * matches these filters", because no combination these controls offer can
   * be empty: months come from months that have receipts, people come from
   * people with a receipt in the chosen month, and a stranded person is
   * reconciled away. That is a claim about behaviour, so it is checked rather
   * than asserted in a comment: every offered month is selected in turn, and
   * with each, every person it then offers.
   *
   * If this ever fails, the fix is to put the second empty state back — not to
   * delete the test.
   */
  test('no combination the controls offer produces an empty table', async () => {
    const user = userEvent.setup()
    const withUndated = [...set, row({ ticket: 'd', payment_date: null, submitted_on: '2026-10-02', amount_cents: null })]
    render(<ParkingReport rows={withUndated} />)

    const months = [...(screen.getByRole('combobox', { name: 'Filter by month' }) as HTMLSelectElement).options].map(
      (o) => o.value,
    )
    expect(months.length).toBeGreaterThan(2) // guard: this loop must have work to do

    for (const month of months) {
      await user.selectOptions(screen.getByRole('combobox', { name: 'Filter by month' }), month)
      const people = [
        ...(screen.getByRole('combobox', { name: 'Filter by person' }) as HTMLSelectElement).options,
      ].map((o) => o.value)

      for (const person of people) {
        await user.selectOptions(screen.getByRole('combobox', { name: 'Filter by person' }), person)
        expect(
          screen.queryByRole('table'),
          `month "${month}" with person "${person}" showed no table`,
        ).not.toBeNull()
        expect(screen.queryByText('Nothing here yet')).toBeNull()
      }
    }
  })

  test('a report with no receipts at all says come back later', () => {
    render(<ParkingReport rows={[]} />)
    expect(screen.getByText('Nothing here yet')).toBeTruthy()
    expect(screen.queryByText('Nothing matches')).toBeNull()
    expect(screen.queryByRole('table')).toBeNull()
  })

  test('a receipt with no date is reachable under its own heading', async () => {
    const user = userEvent.setup()
    render(<ParkingReport rows={[...set, row({ ticket: 'd', payment_date: null, submitted_on: '2026-10-02', amount_cents: null })]} />)
    expect(optionsOf('Filter by month')).toEqual(['All months', 'Sep 2026', 'Aug 2026', 'No date'])

    await user.selectOptions(screen.getByRole('combobox', { name: 'Filter by month' }), '__no_date__')
    expect(screen.getByText('Showing 1 of 4')).toBeTruthy()

    /* Its date and its amount are both unreadable, so both cells say so rather
       than printing a wrong value. The row is still counted — one of four —
       and the total treats the missing figure as nothing. */
    const cells = within(screen.getByRole('table')).getAllByRole('cell').map((c) => c.textContent)
    expect(cells).toEqual(['Clinton Hatcher', '—', '2 Oct 2026', 'd', '—', 'Total shown', '$0.00'])
  })
})
