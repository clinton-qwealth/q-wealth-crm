'use client'

import { useState, useTransition, type DragEvent } from 'react'
import { moveWorkflow, setWorkflowPriority } from '@/app/(shell)/groups/actions'
import {
  applyFilters,
  BOARD_COLUMNS,
  columnFor,
  filterOptions,
  NO_FILTERS,
  PRIORITIES,
  reconcileFilters,
  UNASSIGNED,
  type BoardCard,
  type BoardColumn,
  type BoardFilters,
  type Priority,
} from '@/lib/workflow-board'
import { PriorityPicker } from './priority-picker'
import { InitialsTile, Pill, SHEET_SURFACE, WELL } from './ui'
import { WORKFLOW_TYPE_LABEL } from './file-notes'
import { PriorityGlyph } from './priority-picker'

/**
 * The workflow board: four lanes, cards dragged between them.
 *
 * Native HTML drag and drop, no library. Moving a card between four lanes is
 * the one thing the native API does well, and a dependency for it would be a
 * dependency for the sake of one gesture.
 *
 * Every card also carries a "Move to" select. Drag and drop is a mouse-only
 * idea — it has no keyboard story and screen readers do not announce it — so
 * the select is not a fallback, it is the accessible path, and the drag is the
 * convenience layered on top. Both call the same action.
 *
 * Optimistic: the card moves the moment it is dropped, and moves back if the
 * server refuses, with the refusal shown. A board where cards hang for 200ms
 * after every drop feels broken even when it is working.
 */
export function KanbanBoard({ cards: initial, cancelled }: { cards: BoardCard[]; cancelled: number }) {
  const [cards, setCards] = useState(initial)
  const [dragging, setDragging] = useState<string | null>(null)
  const [over, setOver] = useState<BoardColumn | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [, start] = useTransition()
  const [filters, setFiltersRaw] = useState<BoardFilters>(NO_FILTERS)
  // Every change is reconciled so a downstream filter is never left pointing
  // at options the upstream choice has removed.
  const setFilters = (patch: Partial<BoardFilters>) =>
    setFiltersRaw((f) => reconcileFilters(cards, { ...f, ...patch }))
  const options = filterOptions(cards, filters)
  const shown = applyFilters(cards, filters)
  const filtering = filters.owner !== null || filters.type !== null || filters.priority !== null

  function move(id: string, to: BoardColumn) {
    const card = cards.find((c) => c.id === id)
    if (!card) return
    // Same lane, and not unblocking: nothing to do. A blocked card dropped back
    // on In progress IS a change — it clears the block.
    if (columnFor(card.status) === to && card.status !== 'blocked') return

    const before = cards
    setError(null)
    setCards((cs) => cs.map((c) => (c.id === id ? { ...c, status: to } : c)))
    start(async () => {
      const result = await moveWorkflow(id, to)
      if (result && 'error' in result) {
        setCards(before)
        setError(result.error)
      }
    })
  }

  // Same shape as a move: optimistic, reverted with the reason on refusal.
  function reprioritise(id: string, to: Priority) {
    const before = cards
    setError(null)
    setCards((cs) => cs.map((c) => (c.id === id ? { ...c, priority: to } : c)))
    start(async () => {
      const result = await setWorkflowPriority(id, to)
      if (result && 'error' in result) {
        setCards(before)
        setError(result.error)
      }
    })
  }

  // The dragged id is kept in state as well as on the DataTransfer: some
  // environments (and jsdom) hand a drop event with no usable dataTransfer.
  function onDragStart(e: DragEvent, id: string) {
    setDragging(id)
    e.dataTransfer?.setData('text/plain', id)
    if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move'
  }
  function onDrop(e: DragEvent, to: BoardColumn) {
    e.preventDefault()
    const id = dragging ?? e.dataTransfer?.getData('text/plain')
    setDragging(null)
    setOver(null)
    if (id) move(id, to)
  }

  const SELECT =
    'rounded-md border border-neutral-200 bg-white px-2 py-1 text-xs text-neutral-700 outline-none focus-visible:ring-2 focus-visible:ring-brand/30'

  return (
    <div className="flex flex-1 flex-col">
      {/* Slim filter bar. Layered left to right: owner narrows kind, kind
          narrows priority. Plain selects — a filter is a control, not a
          feature, and the board is the thing to look at. */}
      <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-neutral-500">
        <label className="flex items-center gap-1.5">
          Owner
          <select
            aria-label="Filter by owner"
            value={filters.owner ?? ''}
            onChange={(e) => setFilters({ owner: e.target.value || null })}
            className={SELECT}
          >
            <option value="">All owners</option>
            {options.owners.map((o) => (
              <option key={o} value={o}>
                {o === UNASSIGNED ? 'Unassigned' : o}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-1.5">
          Type
          <select
            aria-label="Filter by type"
            value={filters.type ?? ''}
            onChange={(e) => setFilters({ type: (e.target.value || null) as BoardFilters['type'] })}
            className={SELECT}
          >
            <option value="">All types</option>
            {options.types.map((t) => (
              <option key={t} value={t}>
                {WORKFLOW_TYPE_LABEL[t]}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-1.5">
          Priority
          <select
            aria-label="Filter by priority"
            value={filters.priority ?? ''}
            onChange={(e) => setFilters({ priority: (e.target.value || null) as Priority | null })}
            className={SELECT}
          >
            <option value="">All priorities</option>
            {options.priorities.map((p) => (
              <option key={p} value={p}>
                {PRIORITIES.find((x) => x.id === p)!.label}
              </option>
            ))}
          </select>
        </label>
        {filtering ? (
          <span className="flex items-center gap-2">
            {filters.priority ? <PriorityGlyph priority={filters.priority} className="h-3.5 w-3.5" /> : null}
            <span className="tabular-nums">
              Showing {shown.length} of {cards.length}
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

      {error ? (
        <p role="alert" className="mb-3 text-sm text-red-600">
          {error}
        </p>
      ) : null}

      {/* Lanes stretch with the card, so an empty board is four tall wells
          rather than four short boxes floating in white. */}
      <div className="grid flex-1 grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        {BOARD_COLUMNS.map((col) => {
          const lane = shown.filter((c) => columnFor(c.status) === col.id)
          const active = over === col.id
          return (
            <section
              key={col.id}
              aria-labelledby={`lane-${col.id}`}
              onDragOver={(e) => {
                e.preventDefault()
                if (over !== col.id) setOver(col.id)
              }}
              onDragLeave={(e) => {
                // Leaving to a child still counts as inside.
                if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver(null)
              }}
              onDrop={(e) => onDrop(e, col.id)}
              className={`flex min-h-[16rem] flex-col rounded-lg p-3 transition-colors ${WELL} ${
                active ? 'ring-2 ring-inset ring-brand/40' : ''
              }`}
            >
              <div className="mb-3 flex items-center justify-between gap-3 px-1">
                <h2
                  id={`lane-${col.id}`}
                  className="text-xs font-semibold uppercase tracking-wider text-neutral-500"
                >
                  {col.label}
                </h2>
                <span className="text-xs tabular-nums text-neutral-400">{lane.length}</span>
              </div>

              {lane.length ? (
                <ul className="flex flex-col gap-2">
                  {lane.map((c) => (
                    <li key={c.id}>
                      <article
                        draggable
                        onDragStart={(e) => onDragStart(e, c.id)}
                        onDragEnd={() => {
                          setDragging(null)
                          setOver(null)
                        }}
                        aria-label={c.name}
                        className={`${SHEET_SURFACE} cursor-grab p-3 active:cursor-grabbing ${
                          dragging === c.id ? 'opacity-50' : ''
                        }`}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="truncate text-sm font-medium text-neutral-900">{c.name}</p>
                            <p className="mt-0.5 truncate text-xs text-neutral-500">{c.group_name}</p>
                          </div>
                          {c.owner_name ? (
                            <span title={c.owner_name} className="shrink-0 [&>span]:h-6 [&>span]:w-6 [&>span]:text-[10px]">
                              <InitialsTile name={c.owner_name} />
                            </span>
                          ) : null}
                        </div>

                        {/* Wraps: when the glyph, kind, a Blocked mark and the
                            select will not fit on one line at lane width, the
                            select drops to a second line — a label never breaks
                            mid-word to make room for it. Same rule as DataRow. */}
                        <div className="mt-2.5 flex flex-wrap items-center gap-2">
                          <span className="flex items-center gap-1.5">
                            <PriorityPicker
                              value={c.priority}
                              name={c.name}
                              onChange={(p) => reprioritise(c.id, p)}
                            />
                            <Pill tone="neutral">{WORKFLOW_TYPE_LABEL[c.workflow_type]}</Pill>
                            {c.status === 'blocked' ? <Pill tone="warning">Blocked</Pill> : null}
                          </span>
                          {/* The accessible path. Labelled by the card's name so
                              a screen reader hears "Move Annual review 2026 to". */}
                          <select
                            aria-label={`Move ${c.name} to`}
                            value={columnFor(c.status) ?? ''}
                            onChange={(e) => move(c.id, e.target.value as BoardColumn)}
                            className="ml-auto max-w-[9rem] rounded-md border border-neutral-200 bg-white px-1.5 py-0.5 text-[11px] text-neutral-600 outline-none focus-visible:ring-2 focus-visible:ring-brand/30"
                          >
                            {BOARD_COLUMNS.map((o) => (
                              <option key={o.id} value={o.id}>
                                {o.label}
                              </option>
                            ))}
                          </select>
                        </div>
                      </article>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="flex flex-1 items-center justify-center rounded-md border border-dashed border-neutral-300/80 px-3 py-6 text-center text-xs text-neutral-400">
                  {filtering ? 'Nothing matches' : 'Nothing here'}
                </p>
              )}
            </section>
          )
        })}
      </div>

      {cancelled ? (
        <p className="mt-3 text-xs text-neutral-400">
          {cancelled} cancelled workflow{cancelled === 1 ? ' is' : 's are'} not shown.
        </p>
      ) : null}
    </div>
  )
}
