'use client'

import type { DragEvent } from 'react'
import Link from 'next/link'
import { BOARD_COLUMNS, columnFor, type BoardCard, type BoardColumn, type Priority } from '@/lib/workflow-board'
import { PriorityPicker } from './priority-picker'
import { InitialsTile, Pill, SHEET_SURFACE } from './ui'
import { WORKFLOW_TYPE_LABEL } from './file-notes'

/**
 * One workflow as a card: name and a second line, the owner's initials, then a
 * footer with the priority glyph, the kind, a Blocked mark when it applies,
 * and the Move-to select.
 *
 * The same component on the board and on a group's Workflows tab, so the two
 * cannot drift — a card is a card wherever it is met. What differs is passed
 * in: the second line (the group's name on the cross-group board; when it
 * started on the group's own page, where the group is already the page), and
 * whether the card can be dragged (only where there are lanes to drag to).
 *
 * The Move-to select is not a fallback for drag and drop. Drag has no keyboard
 * story and screen readers do not announce it, so the select is the accessible
 * path and the drag is the convenience. Labelled by the card's name, so a
 * screen reader hears "Move Annual review 2026 to".
 */
export function WorkflowCard({
  card: c,
  subtitle,
  onMove,
  onPriority,
  dragging = false,
  onDragStart,
  onDragEnd,
}: {
  card: BoardCard
  subtitle: string
  onMove: (to: BoardColumn) => void
  onPriority: (to: Priority) => void
  /** True while this card is the one being dragged; it fades to show it. */
  dragging?: boolean
  /** Providing this makes the card draggable. Absent, it is not. */
  onDragStart?: (e: DragEvent) => void
  onDragEnd?: () => void
}) {
  const draggable = Boolean(onDragStart)
  return (
    <article
      draggable={draggable || undefined}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      aria-label={c.name}
      className={`${SHEET_SURFACE} p-3 ${draggable ? 'cursor-grab active:cursor-grabbing' : ''} ${
        dragging ? 'opacity-50' : ''
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          {/* The name opens the workflow. `draggable={false}` on the link:
              anchors are natively draggable, and without it a drag that
              starts on the name would drag the link rather than the card. */}
          <p className="truncate text-sm font-medium text-neutral-900">
            <Link
              href={`/workflows/${c.id}`}
              draggable={false}
              className="rounded outline-none hover:text-brand hover:underline hover:decoration-brand/40 hover:underline-offset-4 focus-visible:ring-2 focus-visible:ring-brand/30"
            >
              {c.name}
            </Link>
          </p>
          <p className="mt-0.5 truncate text-xs text-neutral-500">{subtitle}</p>
        </div>
        {c.owner_name ? (
          <span title={c.owner_name} className="shrink-0 [&>span]:h-6 [&>span]:w-6 [&>span]:text-[10px]">
            <InitialsTile name={c.owner_name} />
          </span>
        ) : null}
      </div>

      {/* Wraps: when the glyph, kind, a Blocked mark and the select will not
          fit on one line at lane width, the select drops to a second line — a
          label never breaks mid-word to make room for it. Same rule as DataRow. */}
      <div className="mt-2.5 flex flex-wrap items-center gap-2">
        <span className="flex items-center gap-1.5">
          <PriorityPicker value={c.priority} name={c.name} onChange={onPriority} />
          <Pill tone="neutral">{WORKFLOW_TYPE_LABEL[c.workflow_type]}</Pill>
          {c.status === 'blocked' ? <Pill tone="warning">Blocked</Pill> : null}
        </span>
        <select
          aria-label={`Move ${c.name} to`}
          value={columnFor(c.status) ?? ''}
          onChange={(e) => onMove(e.target.value as BoardColumn)}
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
  )
}
