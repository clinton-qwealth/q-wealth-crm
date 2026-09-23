import { describe, expect, test } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import React from 'react'
import type { ParkingRow } from '@/lib/parking-report'

const { ParkingReportTable } = await import('@/components/parking-report-table')

const row = (over: Partial<ParkingRow>): ParkingRow => ({
  person_name: 'Clinton Hatcher',
  payment_date: '2026-09-14',
  ticket: '81000210953',
  amount_cents: 2508,
  ...over,
})

const set: ParkingRow[] = [
  row({ ticket: 'a', payment_date: '2026-09-14', person_name: 'Clinton Hatcher', amount_cents: 2508 }),
  row({ ticket: 'b', payment_date: '2026-09-02', person_name: 'Sarah Chen', amount_cents: 1000 }),
  row({ ticket: 'c', payment_date: '2026-08-30', person_name: 'Clinton Hatcher', amount_cents: 500 }),
]

const optionsOf = (name: string) =>
  [...(screen.getByRole('combobox', { name }) as HTMLSelectElement).querySelectorAll('option')].map(
    (o) => o.textContent,
  )

const total = () => within(screen.getByRole('table')).getAllByRole('row').at(-1)!.textContent

describe('the parking report table', () => {
  test('unfiltered, it shows every receipt and no count', () => {
    render(<ParkingReportTable rows={set} />)
    expect(screen.getAllByRole('row')).toHaveLength(5) // head + 3 + foot
    expect(screen.queryByText(/Showing/)).toBeNull()
    expect(screen.queryByRole('button', { name: 'Clear' })).toBeNull()
  })

  test('the months offered are the months that have receipts, newest first', () => {
    render(<ParkingReportTable rows={set} />)
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
    render(<ParkingReportTable rows={set} />)
    expect(total()).toContain('$40.08')

    await user.selectOptions(screen.getByRole('combobox', { name: 'Filter by month' }), '2026-08')
    expect(screen.getByText('Showing 1 of 3')).toBeTruthy()
    expect(total()).toContain('$5.00')
    /* And it says so, rather than presenting a part as the whole. */
    expect(total()).toContain('Total shown')
  })

  test('choosing a month narrows the people on offer', async () => {
    const user = userEvent.setup()
    render(<ParkingReportTable rows={set} />)
    expect(optionsOf('Filter by person')).toEqual(['Anyone', 'Clinton Hatcher', 'Sarah Chen'])

    await user.selectOptions(screen.getByRole('combobox', { name: 'Filter by month' }), '2026-08')
    expect(optionsOf('Filter by person')).toEqual(['Anyone', 'Clinton Hatcher'])
  })

  test('a person the new month does not contain is cleared, not left stranded', async () => {
    const user = userEvent.setup()
    render(<ParkingReportTable rows={set} />)
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
    render(<ParkingReportTable rows={set} />)
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
    const withUndated = [...set, row({ ticket: 'd', payment_date: null, amount_cents: null })]
    render(<ParkingReportTable rows={withUndated} />)

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
    render(<ParkingReportTable rows={[]} />)
    expect(screen.getByText('Nothing here yet')).toBeTruthy()
    expect(screen.queryByText('Nothing matches')).toBeNull()
    expect(screen.queryByRole('table')).toBeNull()
  })

  test('a receipt with no date is reachable under its own heading', async () => {
    const user = userEvent.setup()
    render(<ParkingReportTable rows={[...set, row({ ticket: 'd', payment_date: null, amount_cents: null })]} />)
    expect(optionsOf('Filter by month')).toEqual(['All months', 'Sep 2026', 'Aug 2026', 'No date'])

    await user.selectOptions(screen.getByRole('combobox', { name: 'Filter by month' }), '__no_date__')
    expect(screen.getByText('Showing 1 of 4')).toBeTruthy()

    /* Its date and its amount are both unreadable, so both cells say so rather
       than printing a wrong value. The row is still counted — one of four —
       and the total treats the missing figure as nothing. */
    const cells = within(screen.getByRole('table')).getAllByRole('cell').map((c) => c.textContent)
    expect(cells).toEqual(['Clinton Hatcher', '—', 'd', '—', 'Total shown', '$0.00'])
  })
})
