import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, test } from 'vitest'

/**
 * The Administration menu's mark, and WHEN it moves.
 *
 * Asked for on 25 September 2026: "the tab selection happens before the load".
 * It did not. The mark came from a server prop, which only changes once the
 * new render arrives, so it sat on the old item for the whole round trip and
 * the menu felt dead for a beat after every click.
 *
 * The top bar does not need this — `usePathname()` updates at commit, and
 * `app/(shell)/loading.tsx` makes commit happen on the first frame for a
 * page-segment change. Every section here is the SAME `/admin` segment with a
 * different query string, so nothing re-suspends, nothing commits early, and
 * the mark has to be moved locally.
 *
 * What a plausible implementation gets wrong, and what each test catches:
 *
 * - **The mark is still derived from the prop.** Everything renders, nothing
 *   is broken, and the lag is exactly as it was — invisible to any assertion
 *   that only checks the mark after the server has caught up.
 * - **The mark moves on a ⌘-click too.** That click opens a new tab; this page
 *   has not changed section, and the menu now lies about where you are. This
 *   is the objection `top-nav-links.tsx` raises against optimistic marks, and
 *   the reason that file declines them.
 * - **Local state wins forever.** Once it is set by a click, a later server
 *   value cannot move it back — so an abandoned navigation, or a link opened
 *   from elsewhere, leaves the mark permanently wrong.
 *
 * `next/link` renders as a real anchor under jsdom, which is what the top nav's
 * own test relies on, so nothing here is mocked. jsdom logs "Not implemented:
 * navigation" on the click; the handler under test runs regardless.
 */
const { AdminNav } = await import('@/components/admin-nav')

const marked = () =>
  screen
    .getAllByRole('link')
    .filter((el) => el.getAttribute('aria-current') === 'page')
    .map((el) => el.textContent)

describe('the Administration menu’s mark', () => {
  test('starts on the section the server says it is on', () => {
    render(<AdminNav current="workflows" />)
    expect(marked()).toEqual(['Workflow management'])
  })

  /**
   * The whole point. The prop is UNCHANGED across the click — this is the
   * round trip, and the mark has to have moved before it ends.
   *
   * Mutation, and it was run: replace `useServerState(current)` with `current`
   * in `admin-nav.tsx` — this fails with the mark still on User management.
   */
  test('moves on the click, before the server has said anything', () => {
    render(<AdminNav current="users" />)
    expect(marked()).toEqual(['User management'])

    fireEvent.click(screen.getByRole('link', { name: 'Workflow management' }))

    expect(marked()).toEqual(['Workflow management'])
  })

  test('marks exactly one section, so the old one lets go as the new one takes it', () => {
    render(<AdminNav current="users" />)
    fireEvent.click(screen.getByRole('link', { name: 'Observability' }))
    expect(marked()).toHaveLength(1)
  })

  /* ⌘-click, ctrl-click, shift-click and alt-click all open somewhere else
     rather than navigating this page. Tested one per modifier because the
     guard is a four-way `||` and three of the four could be dropped without
     a single-case test noticing. */
  for (const modifier of ['metaKey', 'ctrlKey', 'shiftKey', 'altKey'] as const) {
    test(`does not move on a ${modifier} click — that opens a new tab, it does not change section`, () => {
      render(<AdminNav current="users" />)
      fireEvent.click(screen.getByRole('link', { name: 'Workflow management' }), { [modifier]: true })
      expect(marked()).toEqual(['User management'])
    })
  }

  /**
   * The server is still the source of truth. `useServerState` re-seeds when the
   * value it was given changes, which is what puts the mark back after a
   * navigation that never landed.
   */
  test('follows the server when it sends a different section', () => {
    const { rerender } = render(<AdminNav current="users" />)
    fireEvent.click(screen.getByRole('link', { name: 'Workflow management' }))
    expect(marked()).toEqual(['Workflow management'])

    rerender(<AdminNav current="observability" />)
    expect(marked()).toEqual(['Observability'])
  })

  test('every section is a link with an href, so the menu can be opened in a tab', () => {
    render(<AdminNav current="users" />)
    const links = screen.getAllByRole('link')
    expect(links.map((a) => a.getAttribute('href'))).toEqual([
      '/admin',
      '/admin?section=workflows',
      '/admin?section=observability',
    ])
  })
})
