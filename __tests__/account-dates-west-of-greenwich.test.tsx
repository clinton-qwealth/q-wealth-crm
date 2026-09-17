/**
 * The account drawer's dates, read from a timezone BEHIND UTC.
 *
 * ## Why this is its own file
 *
 * Because the timezone has to be set before anything constructs a Date, and
 * Vitest gives each file its own environment. Everything here would pass in
 * Sydney whatever the component did, which is exactly the problem: the office
 * is UTC+10, so the bug this guards is invisible to every person who would
 * notice it.
 *
 * ## The bug it guards
 *
 * `financial_accounts.snapshot_as_at` is a `date` — the provider's business
 * day — while `allocation_as_at` beside it is a `timestamptz`. The drawer put
 * BOTH through `formatNoteDate`, which builds a Date and reads its local
 * calendar parts. `new Date('2026-09-16')` is UTC midnight, so west of
 * Greenwich that renders as the 15th: the cash would be dated a day early for
 * a colleague reading from London or New York, and correctly in the office.
 *
 * `lib/note-date.ts` documents this trap and exists as a pair to avoid it.
 * The defect was found on the verification branch, which reports each column's
 * type, and the fixture that should have caught it could not: it carried a
 * full instant with a +10:00 offset, a shape a `date` column never returns.
 */
process.env.TZ = 'America/New_York'

import { act, fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, test, vi } from 'vitest'
import { AccountList, type AccountRow } from '@/components/account-list'

vi.mock('@/app/(shell)/groups/actions', () => ({
  saveAccountDetails: vi.fn(async () => ({ ok: true as const })),
  postAccountActivity: vi.fn(async () => ({ ok: true as const })),
  toggleAccountPostReaction: vi.fn(async () => ({ ok: true as const })),
  createPostMedia: vi.fn(),
  postWorkflowActivity: vi.fn(),
  redactPostMedia: vi.fn(),
  togglePostReaction: vi.fn(),
}))

/* The shapes the VIEW returns, which is the whole point of this file:
   `valued_on` and `snapshot_as_at` are bare dates, `allocation_as_at` is an
   instant. Confirmed against information_schema on the branch. */
const ACCOUNT: AccountRow = {
  account_id: 'a1',
  account_type: 'investment',
  label: 'Netwealth Wrap',
  account_number: '24033810',
  status: 'active',
  opened_on: '2019-04-01',
  closed_on: null,
  provider: 'HUB24',
  owners: 'Janet Testsmith',
  owner_count: 1,
  latest_value: 412350.55,
  valued_on: '2026-09-15',
  change_amount: null,
  change_pct: null,
  baseline_value: null,
  baseline_points: null,
  available_cash: 8421.2,
  snapshot_as_at: '2026-09-16',
  snapshot_source_system: 'hub24',
  product_display_name: null,
  valuation_source: 'HUB24 daily feed',
  valuation_source_system: 'hub24',
  owner_parties: [{ party_id: 'p1', name: 'Janet Testsmith' }],
  allocation: null,
  allocation_as_at: null,
  value_series: null,
}

const show = () =>
  render(
    <ul>
      <AccountList
        accounts={[ACCOUNT]}
        members={[{ id: 'p1', name: 'Janet Testsmith' }]}
        groupName="Testsmith Household"
        posts={[] as never}
        staff={[{ id: 's1', name: 'Sarah Chen' }]}
        viewer={{ id: 's1', name: 'Sarah Chen', canRemoveAnyImage: false }}
      />
    </ul>,
  )

describe('an account read from New York', () => {
  test('the trap is real: a bare date through Date is the day before here', () => {
    /* Not decoration. Without this line a reader cannot tell whether the
       assertions below have any teeth, and in Sydney they would not. */
    expect(new Date('2026-09-16').getDate()).toBe(15)
  })

  test('the cash keeps the provider’s business day, not UTC midnight shifted west', () => {
    const { container } = show()
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Open Netwealth Wrap' }))
    })
    const rows = Array.from(container.querySelector('dialog')!.querySelectorAll('li')).filter((li) =>
      /Available cash/.test(li.textContent ?? ''),
    )
    expect(rows).toHaveLength(1)
    expect(rows[0].textContent).toContain('As at 16 Sep 2026')
    expect(rows[0].textContent).not.toContain('15 Sep')
  })

  test('and so does the valuation', () => {
    const { container } = show()
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Open Netwealth Wrap' }))
    })
    const d = container.querySelector('dialog')!
    expect(d.textContent).toContain('As at 15 Sep 2026')
    expect(d.textContent).not.toContain('14 Sep')
  })
})
