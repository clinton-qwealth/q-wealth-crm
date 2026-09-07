'use client'

import { useState, type DragEvent } from 'react'
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
import { PriorityGlyph } from './priority-picker'
import { WELL } from './ui'
import { WORKFLOW_TYPE_LABEL } from './file-notes'
import { WorkflowCard } from './workflow-card'
import { useWorkflowCards } from './use-workflow-cards'

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
 * after every drop feels broken even when it is working. That logic, and the
 * card itself, are shared with the group page's Workflows tab — see
 * useWorkflowCards and WorkflowCard.
 */
export function KanbanBoard({ cards: initial, cancelled }: { cards: BoardCard[]; cancelled: number }) {
  const { cards, error, move, reprioritise } = useWorkflowCards(initial)
  const [dragging, setDragging] = useState<string | null>(null)
  const [over, setOver] = useState<BoardColumn | null>(null)
  const [filters, setFiltersRaw] = useState<BoardFilters>(NO_FILTERS)
  // Every change is reconciled so a downstream filter is never left pointing
  // at options the upstream choice has removed.
  const setFilters = (patch: Partial<BoardFilters>) =>
    setFiltersRaw((f) => reconcileFilters(cards, { ...f, ...patch }))
  const options = filterOptions(cards, filters)
  const shown = applyFilters(cards, filters)
  const filtering = filters.owner !== null || filters.type !== null || filters.priority !== null

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
                      <WorkflowCard
                        card={c}
                        subtitle={c.group_name}
                        onMove={(to) => move(c.id, to)}
                        onPriority={(p) => reprioritise(c.id, p)}
                        dragging={dragging === c.id}
                        onDragStart={(e) => onDragStart(e, c.id)}
                        onDragEnd={() => {
                          setDragging(null)
                          setOver(null)
                        }}
                      />
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
