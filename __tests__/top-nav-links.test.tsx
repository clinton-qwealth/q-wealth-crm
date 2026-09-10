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
const classes = (el: HTMLElement) => el.className.split(/\s+/).filter(Boolean)
const current = () =>
  screen
    .getAllByRole('link')
    .filter((el) => el.getAttribute('aria-current') === 'page')
    .map((el) => el.textContent)

describe('the top nav marks where you are', () => {
  beforeEach(() => {
    PATHNAME = '/'
  })

  test('the destinations are links, named exactly as the bar reads', () => {
    at('/')
    /* Exact names, because the e2e suite looks these up by accessible name. A
       visually-hidden "(current page)" inside the link would change the name
       and break it — which is why the current item is marked with
       `aria-current` and nothing else. */
    expect(link('Home')).toBeTruthy()
    expect(link('Groups')).toBeTruthy()
    expect(link('Workflows')).toBeTruthy()
    expect(link('Reports')).toBeTruthy()
    expect(screen.getAllByRole('link')).toHaveLength(4)
  })

  /* Groups sits between Home and Workflows, which is where it was asked for. */
  test('Groups comes before Workflows in the bar', () => {
    const nav = at('/')
    const labels = Array.from(nav.querySelectorAll('a')).map((a) => a.textContent)
    expect(labels).toEqual(['Home', 'Groups', 'Workflows', 'Reports'])
  })

  test('the Groups index marks Groups', () => {
    at('/groups')
    expect(current()).toEqual(['Groups'])
  })

  test('a group’s own page keeps Groups marked', () => {
    at('/groups/abc-1')
    expect(current()).toEqual(['Groups'])
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
    at('/help')
    expect(current()).toEqual([])
  })

  /**
   * The fill is the whole visual signal, so it is pinned — including the thing
   * that would quietly cancel it. Leaving the grey hover on the current item
   * turns it grey under the pointer, so the highlight would vanish exactly when
   * somebody reaches for it.
   */
  test('the marked link is filled with brand-500 and keeps it on hover', () => {
    at('/workflows')
    const on = classes(link('Workflows'))

    /* WHOLE TOKENS, not substrings. `toContain('bg-brand')` on the class
       string would also pass for `bg-brand-600`, so a change of step would
       slip through — and the step is the thing this test is here to pin. It
       shipped at 600 for its contrast and was deliberately moved to 500. */
    expect(on).toContain('bg-brand')
    expect(on).not.toContain('bg-brand-600')
    expect(on).toContain('hover:bg-brand-600')
    expect(on).toContain('text-white')
    expect(on).toContain('font-medium')
    expect(on).not.toContain('hover:bg-neutral-100')

    // And an unmarked link is untouched: no fill of any step, grey hover intact.
    const off = classes(link('Reports'))
    expect(off.some((c) => c.startsWith('bg-brand'))).toBe(false)
    expect(off).toContain('hover:bg-neutral-100')
  })

  test('every link keeps the standard focus ring, marked or not', () => {
    at('/workflows')
    for (const name of ['Home', 'Groups', 'Workflows', 'Reports']) {
      expect(link(name).className).toContain('focus-visible:ring-brand/30')
    }
  })
})
