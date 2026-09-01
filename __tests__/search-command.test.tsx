import { afterEach, describe, expect, test, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { SearchCommand } from '@/components/search-command'

/**
 * The shortcut hint has to differ by platform, which the server cannot know.
 * It is read during render via useSyncExternalStore rather than corrected in an
 * effect, so these tests pin the value each platform actually gets.
 */
function onPlatform(userAgent: string) {
  vi.spyOn(window.navigator, 'userAgent', 'get').mockReturnValue(userAgent)
}

afterEach(() => vi.restoreAllMocks())

describe('SearchCommand', () => {
  test('shows the command symbol on Apple platforms', () => {
    onPlatform('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)')
    render(<SearchCommand />)
    expect(screen.getByText(/⌘/)).toBeDefined()
  })

  test('shows Ctrl elsewhere', () => {
    onPlatform('Mozilla/5.0 (Windows NT 10.0; Win64; x64)')
    render(<SearchCommand />)
    expect(screen.getByText(/Ctrl/)).toBeDefined()
    expect(screen.queryByText(/⌘/)).toBeNull()
  })

  test('an iPad counts as Apple', () => {
    onPlatform('Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)')
    render(<SearchCommand />)
    expect(screen.getByText(/⌘/)).toBeDefined()
  })
})
