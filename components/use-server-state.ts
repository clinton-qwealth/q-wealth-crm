'use client'

import { useState } from 'react'

/**
 * Local state seeded from the server, and re-seeded whenever the server sends
 * a new value.
 *
 * **`useState(serverValue)` reads its argument once, on mount.** Every list on
 * this site keeps its server rows in local state so a change can be shown the
 * moment it is made — and every one of them therefore ignored the fresh rows
 * that arrived afterwards. Add a task and the server re-rendered the page with
 * it; the list went on showing the array it had mounted with, until the tab
 * was reloaded.
 *
 * This is React's documented "adjusting state when a prop changes": compare
 * against the last value seen and reset **during render**, not in an effect.
 * React re-runs the component immediately with the new value, so nothing ever
 * paints stale and there is no second commit to watch flicker.
 *
 * The comparison is by identity, which is exactly right here: a server render
 * deserialises a new array every time, so any render carrying server data
 * re-seeds, while a re-render for some other reason — a menu opening, an error
 * being set — leaves the local value alone.
 *
 * An optimistic change made while a revalidation is in flight is overwritten by
 * it. That is the correct outcome: the revalidation was caused by the write
 * that change represents, so it carries the same fact from the source of truth.
 */
export function useServerState<T>(server: T) {
  const [value, setValue] = useState(server)
  const [seen, setSeen] = useState(server)

  if (seen !== server) {
    setSeen(server)
    setValue(server)
  }

  return [value, setValue] as const
}
