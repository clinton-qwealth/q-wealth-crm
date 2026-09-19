import { readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, test } from 'vitest'
import {
  actorName,
  describe as describeEntry,
  detailRows,
  formatValue,
  humaniseField,
  shortId,
  TABLE_LABEL,
  type AuditEntry,
} from '@/lib/audit'

/**
 * The audit trail's pure half.
 *
 * The census at the end is the one that matters: every table with a
 * `record_audit` trigger must have a name in `TABLE_LABEL`, and every name must
 * be a table that is actually audited. Without it a newly audited table would
 * reach the screen as `financial_account_owners`, and a table that stopped
 * being audited would keep a filter option that can never match.
 */
const entry = (o: Partial<AuditEntry>): AuditEntry => ({
  id: 1,
  occurred_at: '2026-09-19T03:00:00+00:00',
  table_name: 'financial_accounts',
  record_id: '66666666-0000-4000-8000-000000000002',
  action: 'update',
  changed_fields: null,
  old_data: null,
  new_data: null,
  actor_staff_id: null,
  actor_context: 'api',
  actor_name: null,
  record_label: null,
  ...o,
})

describe('naming', () => {
  test('a field name reads as words, without its id suffix', () => {
    expect(humaniseField('closed_on')).toBe('Closed on')
    expect(humaniseField('held_in_account_id')).toBe('Held in account')
    expect(humaniseField('status')).toBe('Status')
  })

  test('a short id is the first block of the uuid, or a dash', () => {
    expect(shortId('66666666-0000-4000-8000-000000000002')).toBe('66666666')
    expect(shortId(null)).toBe('—')
  })

  /* "System", not "Unknown": a row with no staff actor from an elevated
     context is the record that the dashboard or a feed did it. */
  test('an actor is named, or is System, or is someone not yet on the staff', () => {
    expect(actorName(entry({ actor_name: 'Wide Adviser' }))).toBe('Wide Adviser')
    expect(actorName(entry({ actor_context: 'elevated' }))).toBe('System')
    expect(actorName(entry({ actor_context: 'api' }))).toBe('Someone not yet on the staff')
  })

  test('an entry describes itself with its label, or its short id', () => {
    expect(describeEntry(entry({ record_label: 'Joint Super' }))).toBe('Changed Investment account · Joint Super')
    expect(describeEntry(entry({ action: 'delete' }))).toBe('Removed Investment account · 66666666')
  })
})

describe('values', () => {
  test('are text, never markup, with nulls and booleans said in words', () => {
    expect(formatValue(null)).toEqual({ text: '—', block: false })
    expect(formatValue(true)).toEqual({ text: 'Yes', block: false })
    expect(formatValue(false)).toEqual({ text: 'No', block: false })
    expect(formatValue('')).toEqual({ text: '(blank)', block: false })
    expect(formatValue(12.5)).toEqual({ text: '12.5', block: false })
    expect(formatValue('<img src=x onerror=alert(1)>')).toEqual({ text: '<img src=x onerror=alert(1)>', block: false })
  })

  test('an object becomes indented JSON in a block', () => {
    const v = formatValue({ a: 1, b: [1, 2] })
    expect(v.block).toBe(true)
    expect(v.text).toBe(JSON.stringify({ a: 1, b: [1, 2] }, null, 2))
  })
})

describe('detail rows', () => {
  test('an update lists exactly its changed fields, old and new', () => {
    const rows = detailRows(
      entry({ changed_fields: ['closed_on', 'status'], old_data: { closed_on: null, status: 'active', extra: 1 }, new_data: { closed_on: '2026-09-01', status: 'closed', extra: 2 } }),
    )
    expect(rows).toEqual([
      { field: 'closed_on', before: null, after: '2026-09-01' },
      { field: 'status', before: 'active', after: 'closed' },
    ])
  })

  test('a delete lists every kept field as before; an insert as after', () => {
    const del = detailRows(entry({ action: 'delete', old_data: { label: 'Joint Super', account_number: '99887766' } }))
    expect(del.map((r) => r.field)).toEqual(['account_number', 'label'])
    expect(del[1]).toEqual({ field: 'label', before: 'Joint Super', after: undefined })
    const ins = detailRows(entry({ action: 'insert', new_data: { label: 'X' } }))
    expect(ins[0]).toEqual({ field: 'label', before: undefined, after: 'X' })
  })
})

/**
 * THE CENSUS. Read every migration, find every `create trigger … on public.T`
 * whose function is `record_audit`, and compare the set of T against the map.
 * A trigger that is later dropped and re-created is counted once; a table
 * whose trigger was dropped and NOT re-created would need this test edited,
 * which is the right friction.
 */
describe('the audited tables and their labels agree', () => {
  const dir = resolve(process.cwd(), 'supabase/migrations')
  const sql = readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .map((f) => readFileSync(resolve(dir, f), 'utf8'))
    .join('\n')
  const audited = new Set<string>()
  /* Two shapes. The 26 Aug migration attaches sixteen tables from a VALUES
     list inside a DO block — `('parties', 'id', '')` — and every later table
     has its own `create trigger … on public.T … execute function
     public.record_audit(…)` statement. Statements are split on `;` so a match
     cannot straddle two of them. */
  for (const m of sql.matchAll(/\(\s*'(\w+)',\s*'(?:id|party_id)',\s*'[^']*'\s*\)/g)) {
    audited.add(m[1])
  }
  for (const stmt of sql.split(';')) {
    if (!/create\s+trigger/i.test(stmt) || !/public\.record_audit\s*\(/i.test(stmt)) continue
    const on = stmt.match(/\bon\s+public\.(\w+)/i)
    if (on) audited.add(on[1])
  }

  test('the scan found the trail', () => {
    expect(audited.size).toBeGreaterThanOrEqual(20)
    expect(audited.has('financial_accounts')).toBe(true)
  })

  test('every audited table has a name', () => {
    const unnamed = [...audited].filter((t) => !(t in TABLE_LABEL))
    expect(unnamed, 'audited but unnamed').toEqual([])
  })

  test('and every name is an audited table', () => {
    const stale = Object.keys(TABLE_LABEL).filter((t) => !audited.has(t))
    expect(stale, 'named but not audited').toEqual([])
  })
})
