import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { AuditEntry } from '@/lib/audit'

/**
 * The Audit trail tab, as rendered.
 *
 * What is guarded: that a payload value is never rendered as markup, that an
 * update shows exactly its changed fields as old → new, that a row with no
 * staff actor says System, that older pages append with BOTH cursor keys, and
 * that a filter change replaces the list from the top.
 */
vi.mock('@/app/(shell)/admin/actions', () => ({
  loadAuditEntries: vi.fn(async () => ({ entries: [], hasMore: false })),
}))
const actions = await import('@/app/(shell)/admin/actions')
const { AuditTrail } = await import('@/components/audit-trail')

const entry = (o: Partial<AuditEntry>): AuditEntry => ({
  id: 1,
  occurred_at: '2026-09-19T03:41:00+00:00',
  table_name: 'financial_accounts',
  record_id: '66666666-0000-4000-8000-000000000002',
  action: 'update',
  changed_fields: ['label'],
  old_data: { label: 'Joint Super' },
  new_data: { label: 'Joint Super (SMSF)' },
  actor_staff_id: 's1',
  actor_context: 'api',
  actor_name: 'Wide Adviser',
  record_label: 'Joint Super (SMSF)',
  ...o,
})

const ACTORS = [
  { id: 's1', name: 'Wide Adviser', status: 'active' },
  { id: 's2', name: 'Former Colleague', status: 'inactive' },
]

const show = (entries: AuditEntry[], hasMore = false) =>
  render(<AuditTrail initial={entries} initialHasMore={hasMore} actors={ACTORS} />)

const rows = () => Array.from(document.querySelectorAll('[data-slot="audit-entry"]'))
const expand = (li: Element) =>
  act(() => {
    fireEvent.click(within(li as HTMLElement).getByRole('button', { expanded: false }))
  })

beforeEach(() => {
  vi.mocked(actions.loadAuditEntries).mockClear()
  vi.mocked(actions.loadAuditEntries).mockResolvedValue({ entries: [], hasMore: false })
})

describe('an entry', () => {
  test('says the verb, the table in words, the record, who, and when', () => {
    show([entry({})])
    const li = rows()[0]
    expect(li.textContent).toContain('Changed')
    expect(li.textContent).toContain('Investment account')
    expect(li.querySelector('[data-slot="record-label"]')!.textContent).toBe('Joint Super (SMSF)')
    expect(li.querySelector('[data-slot="actor"]')!.textContent).toBe('Wide Adviser')
    expect(li.querySelector('time')!.getAttribute('dateTime')).toBe('2026-09-19T03:41:00+00:00')
    expect(li.textContent).toContain('Changed: Label')
  })

  test('falls back to a short id when the trail could not name the record', () => {
    show([entry({ record_label: null })])
    expect(rows()[0].querySelector('[data-slot="record-label"]')!.textContent).toBe('66666666')
  })

  /* Not "Unknown": no staff actor from an elevated context is the record that
     the dashboard or a feed did it. */
  test('names System for an elevated write with no staff actor', () => {
    show([entry({ actor_staff_id: null, actor_name: null, actor_context: 'elevated' })])
    expect(rows()[0].querySelector('[data-slot="actor"]')!.textContent).toBe('System')
  })

  test('expands to exactly its changed fields, old then new', () => {
    /* `updated_at` is in the payload but NOT in changed_fields — the list of
       changed fields is the authority, and a row for every payload key would
       be a mutation this fixture is shaped to catch. */
    show([entry({ changed_fields: ['closed_on', 'status'], old_data: { closed_on: null, status: 'active', updated_at: 'x' }, new_data: { closed_on: '2026-09-01', status: 'closed', updated_at: 'y' } })])
    const li = rows()[0]
    expand(li)
    const terms = Array.from(li.querySelectorAll('dt')).map((d) => d.textContent)
    expect(terms).toEqual(['Closed on', 'Status'])
    const defs = Array.from(li.querySelectorAll('dd')).map((d) => d.textContent)
    expect(defs[0]).toContain('—')
    expect(defs[0]).toContain('2026-09-01')
    expect(defs[1]).toContain('active')
    expect(defs[1]).toContain('closed')
    expect(li.querySelector('button')!.getAttribute('aria-expanded')).toBe('true')
  })

  test('a removal expands to every field it kept', () => {
    show([entry({ action: 'delete', changed_fields: null, new_data: null, old_data: { label: 'Joint Super', account_number: '99887766' } })])
    const li = rows()[0]
    expand(li)
    expect(Array.from(li.querySelectorAll('dt')).map((d) => d.textContent)).toEqual(['Account number', 'Label'])
  })

  /**
   * THE ONE THAT MATTERS. Whatever a person typed into a record comes back
   * through this screen, so a value is a text node or a <pre>, never markup.
   */
  test('renders a hostile value as text and an object as JSON in a block', () => {
    show([
      entry({
        changed_fields: ['label', 'meta'],
        old_data: { label: 'x', meta: null },
        new_data: { label: '<img src=x onerror=alert(1)>', meta: { nested: [1, 2] } },
      }),
    ])
    const li = rows()[0]
    expand(li)
    expect(li.querySelector('img')).toBeNull()
    expect(li.textContent).toContain('<img src=x onerror=alert(1)>')
    const pre = li.querySelector('pre')!
    expect(pre.textContent).toBe(JSON.stringify({ nested: [1, 2] }, null, 2))
  })
})

describe('paging and filters', () => {
  const fifty = Array.from({ length: 50 }, (_, i) => entry({ id: 200 - i, occurred_at: `2026-09-19T02:${String(59 - i).padStart(2, '0')}:00+00:00` }))

  test('offers Show older only while the server said there is more', () => {
    show(fifty, false)
    expect(screen.queryByRole('button', { name: 'Show older' })).toBeNull()
  })

  test('and asks for the next page from where this one ended, with both cursor keys', async () => {
    vi.mocked(actions.loadAuditEntries).mockResolvedValueOnce({ entries: [entry({ id: 5, occurred_at: '2026-09-18T00:00:00+00:00' })], hasMore: false })
    show(fifty, true)
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Show older' }))
    })
    expect(actions.loadAuditEntries).toHaveBeenCalledWith({}, { occurred_at: '2026-09-19T02:10:00+00:00', id: 151 })
    expect(rows()).toHaveLength(51)
    expect(screen.queryByRole('button', { name: 'Show older' })).toBeNull()
  })

  test('a filter change replaces the list from the top, with no cursor', async () => {
    vi.mocked(actions.loadAuditEntries).mockResolvedValueOnce({ entries: [entry({ id: 9, table_name: 'staff_users', record_label: 'Someone' })], hasMore: false })
    show(fifty, true)
    await act(async () => {
      fireEvent.change(screen.getByLabelText('Table'), { target: { value: 'staff_users' } })
    })
    expect(actions.loadAuditEntries).toHaveBeenCalledWith({ table: 'staff_users' }, null)
    expect(rows()).toHaveLength(1)
    expect(rows()[0].textContent).toContain('Staff member')
  })

  /* Local midnight of the day chosen; the day AFTER the "to" date, so the
     bound is exclusive. Built in the browser, where the calendar is. */
  test('dates become local-midnight instants, with the upper bound exclusive', async () => {
    show(fifty, false)
    await act(async () => {
      fireEvent.change(screen.getByLabelText('From'), { target: { value: '2026-09-01' } })
    })
    await act(async () => {
      fireEvent.change(screen.getByLabelText('To'), { target: { value: '2026-09-15' } })
    })
    const [, lastCall] = vi.mocked(actions.loadAuditEntries).mock.calls.slice(-2)
    expect(lastCall[0].from).toBe(new Date(2026, 8, 1).toISOString())
    expect(lastCall[0].to).toBe(new Date(2026, 8, 16).toISOString())
    expect(lastCall[1]).toBeNull()
  })

  test('the actor filter offers System and marks former colleagues', () => {
    show(fifty)
    const options = Array.from((screen.getByLabelText('Who') as HTMLSelectElement).options).map((o) => o.textContent)
    expect(options).toEqual(['Anyone', 'System', 'Wide Adviser', 'Former Colleague (former)'])
  })

  test('a refusal from the action is shown and the list is left alone', async () => {
    vi.mocked(actions.loadAuditEntries).mockResolvedValueOnce({ error: 'A verified second factor is required.' })
    show(fifty, true)
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Show older' }))
    })
    expect(screen.getByRole('alert').textContent).toBe('A verified second factor is required.')
    expect(rows()).toHaveLength(50)
  })

  test('nothing matching is a dashed state that says so, and the footnote is always there', () => {
    show([])
    expect(screen.getByText('No changes match')).toBeTruthy()
    expect(document.querySelector('[data-slot="not-audited"]')!.textContent).toContain('Not everything is audited')
  })
})
