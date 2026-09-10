import { beforeEach, describe, expect, test, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

/* usePathname is what the highlight is computed from, so it is the one thing
   these tests drive. `vitest.setup.ts` does not mock next/navigation, so each
   file that needs it mocks it itself — the precedent is
   groups-page-round-trips.test.tsx. */
let PATHNAME = '/'
vi.mock('next/navigation', () => ({ usePathname: () => PATHNAME }))

const { TopNavLinks } = await import('@/components/top-nav-links')

const at = (pathname: string) => {
  PATHNAME = pathname
  render(<TopNavLinks />)
  return screen.getByRole('navigation', { name: 'Main' })
}
const link = (name: string) => screen.getByRole('link', { name })
const current = () =>
  screen
    .getAllByRole('link')
    .filter((el) => el.getAttribute('aria-current') === 'page')
    .map((el) => el.textContent)

describe('the top nav marks where you are', () => {
  beforeEach(() => {
    PATHNAME = '/'
  })

  test('the three destinations are links, named exactly as the bar reads', () => {
    at('/')
    /* Exact names, because the e2e suite looks these up by accessible name. A
       visually-hidden "(current page)" inside the link would change the name
       and break it — which is why the current item is marked with
       `aria-current` and nothing else. */
    expect(link('Home')).toBeTruthy()
    expect(link('Workflows')).toBeTruthy()
    expect(link('Reports')).toBeTruthy()
    expect(screen.getAllByRole('link')).toHaveLength(3)
  })

  test('the page you are on is the one marked, and only it', () => {
    at('/workflows')
    expect(current()).toEqual(['Workflows'])
    expect(link('Home').getAttribute('aria-current')).toBeNull()
    expect(link('Reports').getAttribute('aria-current')).toBeNull()
  })

  test('Home is marked at the root, and nowhere else', () => {
    at('/')
    expect(current()).toEqual(['Home'])
  })

  /** The case the highlight exists for: drilling into a workflow. */
  test('a workflow detail page keeps Workflows marked', () => {
    at('/workflows/abc-1')
    expect(current()).toEqual(['Workflows'])
  })

  test('a page outside the nav marks nothing', () => {
    at('/groups')
    expect(current()).toEqual([])
  })

  /**
   * The fill is the whole visual signal, so it is pinned — including the thing
   * that would quietly cancel it. Leaving the grey hover on the current item
   * turns it grey under the pointer, so the highlight would vanish exactly when
   * somebody reaches for it.
   */
  test('the marked link is filled with the brand colour and keeps it on hover', () => {
    at('/workflows')
    const on = link('Workflows')
    expect(on.className).toContain('bg-brand-600')
    expect(on.className).toContain('text-white')
    expect(on.className).toContain('font-medium')
    expect(on.className).not.toContain('hover:bg-neutral-100')

    // And an unmarked link is untouched: no fill, and its grey hover intact.
    const off = link('Reports')
    expect(off.className).not.toContain('bg-brand')
    expect(off.className).toContain('hover:bg-neutral-100')
  })

  test('every link keeps the standard focus ring, marked or not', () => {
    at('/workflows')
    for (const name of ['Home', 'Workflows', 'Reports']) {
      expect(link(name).className).toContain('focus-visible:ring-brand/30')
    }
  })
})
