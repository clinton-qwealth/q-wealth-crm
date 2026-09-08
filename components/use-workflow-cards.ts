'use client'

import { useState, useTransition } from 'react'
import { useServerState } from './use-server-state'
import { moveWorkflow, setWorkflowPriority } from '@/app/(shell)/groups/actions'
import { columnFor, type BoardCard, type BoardColumn, type Priority } from '@/lib/workflow-board'

/**
 * The cards and the two things that can be done to one, shared by every screen
 * that shows workflow cards — the board and a group's Workflows tab.
 *
 * Optimistic: the change shows the moment it is made and is put back if the
 * server refuses, with the refusal kept for the caller to show. Cards that
 * hang for a round trip after every click feel broken even when they are
 * working; cards that silently stay put after a refusal are lying. Both
 * screens must behave identically here, which is why this is one hook and not
 * two copies of the same eight lines.
 */
export function useWorkflowCards(initial: BoardCard[]) {
  /* Seeded from the server and RE-seeded when the server sends new rows —
     otherwise a workflow started from the board would not appear on it until
     the tab was reloaded. See useServerState. */
  const [cards, setCards] = useServerState(initial)
  const [error, setError] = useState<string | null>(null)
  const [, start] = useTransition()

  function move(id: string, to: BoardColumn) {
    const card = cards.find((c) => c.id === id)
    if (!card) return
    // Same lane, and not unblocking: nothing to do. A blocked card moved back
    // to In progress IS a change — it clears the block.
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

  return { cards, error, move, reprioritise }
}
