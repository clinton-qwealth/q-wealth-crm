'use client'

import { useState, useTransition } from 'react'
import { loadAuditEntries } from '@/app/(shell)/admin/actions'
import {
  ACTION_LABEL,
  ACTION_TONE,
  actorName,
  detailRows,
  formatValue,
  humaniseField,
  NOT_AUDITED_COPY,
  shortId,
  TABLE_LABEL,
  tableLabel,
  type AuditAction,
  type AuditActor,
  type AuditCursor,
  type AuditEntry,
  type AuditFilters,
} from '@/lib/audit'
import { formatNoteDateTime } from '@/lib/note-date'
import { FIELD_INPUT } from './field-box'
import { ChevronDownIcon } from './icons'
import { Pill, SHEET } from './ui'
import { useServerState } from './use-server-state'

/**
 * The audit trail, newest first, fifty at a time.
 *
 * ## What it shows and what it refuses to
 *
 * Every row `record_audit()` wrote: who, when, which record, and on request
 * exactly what changed — an update as old → new pairs for its changed fields,
 * an insert or a delete as every field it kept. Values are only ever drawn as
 * text nodes or inside a `<pre>`: whatever a person typed into a record comes
 * back through here, and nothing typed is ever handed to the browser as
 * markup. A nested object prints as indented JSON text.
 *
 * ## Filters are local state, not the URL
 *
 * The tab mounts lazily inside `Tabs`, whose selection is itself local, and
 * the page's round-trip test pins one exact first wave. A `searchParams`-driven
 * list would re-run every loader on the page for each filter change and would
 * still land on the first tab from a shared link. So filters drive one server
 * action and the list is replaced in place. The cost is stated: a filtered
 * view is not shareable. When an administrator needs to send one, add
 * `?tab=&table=` to `Tabs` and here, then.
 *
 * Dates are turned into instants IN THE BROWSER — local midnight of the day
 * chosen, and the day AFTER the "to" date so the bound is exclusive — because
 * the server has no idea what day it is where the reader sits, which is the
 * rule `lib/note-date.ts` spends a hundred lines on.
 */
export function AuditTrail({
  initial,
  initialHasMore,
  actors,
}: {
  initial: AuditEntry[]
  initialHasMore: boolean
  actors: AuditActor[]
}) {
  const [entries, setEntries] = useServerState(initial)
  const [hasMore, setHasMore] = useState(initialHasMore)
  const [filters, setFilters] = useState<AuditFilters>({})
  const [fromDay, setFromDay] = useState('')
  const [toDay, setToDay] = useState('')
  const [open, setOpen] = useState<Set<number>>(() => new Set())
  const [error, setError] = useState<string | null>(null)
  const [pending, start] = useTransition()

  function apply(next: AuditFilters) {
    setFilters(next)
    setError(null)
    start(async () => {
      const page = await loadAuditEntries(next, null)
      if ('error' in page) {
        setError(page.error)
        return
      }
      setEntries(page.entries)
      setHasMore(page.hasMore)
      setOpen(new Set())
    })
  }

  function older() {
    const last = entries[entries.length - 1]
    if (!last) return
    const cursor: AuditCursor = { occurred_at: last.occurred_at, id: last.id }
    setError(null)
    start(async () => {
      const page = await loadAuditEntries(filters, cursor)
      if ('error' in page) {
        setError(page.error)
        return
      }
      setEntries((es) => [...es, ...page.entries])
      setHasMore(page.hasMore)
    })
  }

  /* A day → an instant, in the reader's own calendar. */
  const dayStart = (day: string) => {
    const [y, m, d] = day.split('-').map(Number)
    return new Date(y, m - 1, d).toISOString()
  }
  const dayAfter = (day: string) => {
    const [y, m, d] = day.split('-').map(Number)
    return new Date(y, m - 1, d + 1).toISOString()
  }

  const tables = Object.entries(TABLE_LABEL).sort((a, b) => a[1].localeCompare(b[1]))
  const select = `${FIELD_INPUT} text-sm`

  return (
    <div className="flex flex-col gap-4">
      <div data-slot="audit-filters" className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <label className="flex flex-col gap-1">
          <span className={LABEL}>Table</span>
          <select
            className={select}
            value={filters.table ?? ''}
            onChange={(e) => apply({ ...filters, table: e.target.value || undefined })}
          >
            <option value="">All tables</option>
            {tables.map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className={LABEL}>Action</span>
          <select
            className={select}
            value={filters.action ?? ''}
            onChange={(e) => apply({ ...filters, action: (e.target.value || undefined) as AuditAction | undefined })}
          >
            <option value="">All actions</option>
            {(Object.keys(ACTION_LABEL) as AuditAction[]).map((a) => (
              <option key={a} value={a}>
                {ACTION_LABEL[a]}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className={LABEL}>Who</span>
          <select
            className={select}
            value={filters.actor ?? ''}
            onChange={(e) => apply({ ...filters, actor: e.target.value || undefined })}
          >
            <option value="">Anyone</option>
            <option value="system">System</option>
            {actors.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
                {a.status === 'active' ? '' : ' (former)'}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className={LABEL}>From</span>
          <input
            type="date"
            className={select}
            value={fromDay}
            onChange={(e) => {
              setFromDay(e.target.value)
              apply({ ...filters, from: e.target.value ? dayStart(e.target.value) : undefined })
            }}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className={LABEL}>To</span>
          <input
            type="date"
            className={select}
            value={toDay}
            onChange={(e) => {
              setToDay(e.target.value)
              apply({ ...filters, to: e.target.value ? dayAfter(e.target.value) : undefined })
            }}
          />
        </label>
      </div>

      {error ? (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      ) : null}

      {entries.length === 0 ? (
        /* House empty state: the dashed div carries no text-center; the
           paragraph does. `inherited-alignment.test.ts` holds both. */
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-neutral-200 bg-neutral-50/60 px-6 py-10">
          <p className="text-center text-sm font-medium text-neutral-700">No changes match</p>
          <p className="mt-1 max-w-sm text-center text-xs leading-relaxed text-neutral-500">
            Nothing in the trail fits these filters. Widen the dates or choose a different table.
          </p>
        </div>
      ) : (
        <div className={SHEET}>
          <ul data-slot="audit-list" className="divide-y divide-neutral-200/80">
            {entries.map((e) => (
              <Entry key={e.id} entry={e} open={open.has(e.id)} onToggle={() => {
                setOpen((s) => {
                  const next = new Set(s)
                  if (next.has(e.id)) next.delete(e.id)
                  else next.add(e.id)
                  return next
                })
              }} />
            ))}
          </ul>
        </div>
      )}

      {hasMore ? (
        <div className="flex justify-center">
          <button
            type="button"
            onClick={older}
            disabled={pending}
            aria-busy={pending || undefined}
            className="rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-sm font-medium text-neutral-800 outline-none transition-colors hover:bg-neutral-50 disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-brand/30"
          >
            {pending ? 'Loading…' : 'Show older'}
          </button>
        </div>
      ) : null}

      <p data-slot="not-audited" className="text-xs leading-relaxed text-neutral-400">
        {NOT_AUDITED_COPY}
      </p>
    </div>
  )
}

const LABEL = 'text-xs font-semibold uppercase tracking-wider text-neutral-500'

function Entry({ entry: e, open, onToggle }: { entry: AuditEntry; open: boolean; onToggle: () => void }) {
  const bodyId = `audit-${e.id}`
  const label = e.record_label ?? shortId(e.record_id)
  const changed = e.action === 'update' ? (e.changed_fields ?? []).map(humaniseField).join(', ') : null
  return (
    <li data-slot="audit-entry" data-action={e.action}>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        aria-controls={open ? bodyId : undefined}
        className="flex w-full items-start gap-3 px-4 py-3 text-left outline-none transition-colors hover:bg-neutral-50 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand/30"
      >
        <ChevronDownIcon
          className={`mt-1 h-4 w-4 shrink-0 text-neutral-400 transition-transform ${open ? '' : '-rotate-90'}`}
        />
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-2">
            <Pill tone={ACTION_TONE[e.action]}>{ACTION_LABEL[e.action]}</Pill>
            <span className="text-sm text-neutral-900">{tableLabel(e.table_name)}</span>
            <span
              data-slot="record-label"
              className={e.record_label ? 'text-sm text-neutral-700' : 'font-mono text-xs text-neutral-400'}
            >
              {label}
            </span>
          </span>
          <span className="mt-0.5 block text-xs text-neutral-500">
            <span data-slot="actor">{actorName(e)}</span>
            {changed ? <span> · Changed: {changed}</span> : null}
          </span>
        </span>
        <time dateTime={e.occurred_at} className="shrink-0 text-xs tabular-nums text-neutral-500">
          {formatNoteDateTime(e.occurred_at)}
        </time>
      </button>

      {open ? (
        <div id={bodyId} className="border-t border-neutral-100 bg-neutral-50/60 px-4 py-3 pl-11">
          <dl className="divide-y divide-neutral-100">
            {detailRows(e).map((row) => (
              <div key={row.field} className="grid grid-cols-1 gap-x-4 gap-y-1 py-2 sm:grid-cols-[10rem_minmax(0,1fr)]">
                <dt className="text-xs font-medium text-neutral-500">{humaniseField(row.field)}</dt>
                <dd className="min-w-0 text-sm text-neutral-900">
                  {e.action === 'update' ? (
                    <span className="flex flex-wrap items-baseline gap-2">
                      <Value v={row.before} />
                      <span aria-hidden="true" className="text-neutral-400">
                        →
                      </span>
                      <Value v={row.after} />
                    </span>
                  ) : (
                    <Value v={e.action === 'insert' ? row.after : row.before} />
                  )}
                </dd>
              </div>
            ))}
          </dl>
        </div>
      ) : null}
    </li>
  )
}

/** A payload value, as text only. See the component docblock. */
function Value({ v }: { v: unknown }) {
  const { text, block } = formatValue(v)
  if (block) {
    return <pre className="whitespace-pre-wrap break-all font-mono text-[11px] text-neutral-800">{text}</pre>
  }
  return <span className="break-words">{text}</span>
}
