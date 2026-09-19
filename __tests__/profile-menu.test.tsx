import { act, fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, test, vi } from 'vitest'

vi.mock('@/app/actions', () => ({ signOut: vi.fn() }))
const { ProfileMenu } = await import('@/components/profile-menu')

/**
 * The account menu gained its first permission-dependent destination on
 * 19 September. Hiding it is courtesy — the page answers not-found to anyone
 * else — but a destination that appears for the wrong people, or fails to
 * appear for the right ones, is the kind of defect nobody reports.
 */
const open = () =>
  act(() => {
    fireEvent.click(screen.getByRole('button', { name: /Account menu/ }))
  })
const items = () => screen.getAllByRole('menuitem').map((m) => m.textContent)

describe('the account menu', () => {
  test('offers Profile, Preferences and Sign out to everyone', () => {
    render(<ProfileMenu name="Sarah Chen" email="s@example.com" />)
    open()
    expect(items()).toEqual(['Profile', 'Preferences', 'Sign out'])
  })

  test('and Administration, after Preferences and before Sign out, to an administrator', () => {
    render(<ProfileMenu name="Sarah Chen" email="s@example.com" isAdmin />)
    open()
    expect(items()).toEqual(['Profile', 'Preferences', 'Administration', 'Sign out'])
    expect(screen.getByRole('menuitem', { name: 'Administration' }).getAttribute('href')).toBe('/admin')
  })

  /* The Sign out button's place in the arrow-key list is the links' length,
     which changed; ArrowDown from the last link must still reach it. */
  test('arrow keys still cycle through to Sign out with the extra item', () => {
    render(<ProfileMenu name="Sarah Chen" isAdmin />)
    open()
    const admin = screen.getByRole('menuitem', { name: 'Administration' })
    act(() => {
      admin.focus()
    })
    act(() => {
      fireEvent.keyDown(document, { key: 'ArrowDown' })
    })
    expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: 'Sign out' }))
  })
})
