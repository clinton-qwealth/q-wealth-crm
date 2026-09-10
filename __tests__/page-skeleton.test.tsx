import { describe, expect, test } from 'vitest'
import { render, screen } from '@testing-library/react'
import { PageSkeleton } from '@/components/page-skeleton'

/**
 * The skeleton behind every `loading.tsx` under the shell.
 *
 * These pin the properties that make it a correct loading state rather than a
 * page pretending to be loaded: it fits the shell's grid, it announces itself
 * once, it shows nothing readable, and it holds still under reduced motion.
 */
describe('the page skeleton', () => {
  test('every top-level child is a grid child of <main>, not a wrapper', () => {
    const { container } = render(<PageSkeleton />)
    const children = Array.from(container.children)
    expect(children.length).toBeGreaterThanOrEqual(2)
    for (const child of children) {
      expect(child.className).toMatch(/\bcol-span-/)
    }
  })

  test('it announces itself once, as a polite status, and is otherwise silent', () => {
    render(<PageSkeleton />)
    const status = screen.getByRole('status')
    expect(status.textContent).toBe('Loading page')
    /* No aria-busy on the live region: it would tell assistive technology to
       suppress announcements until it clears, and this element never clears —
       it is replaced wholesale when the page lands. */
    expect(status.getAttribute('aria-busy')).toBeNull()
    expect(status.querySelector('.sr-only')).toBeTruthy()
  })

  test('nothing readable is visible: no fake title, no fake figures', () => {
    const { container } = render(<PageSkeleton />)
    const visible = Array.from(container.querySelectorAll('*'))
      .filter((el) => !el.classList.contains('sr-only') && !el.closest('.sr-only'))
      .map((el) => Array.from(el.childNodes).filter((n) => n.nodeType === Node.TEXT_NODE))
      .flat()
      .map((n) => n.textContent?.trim() ?? '')
      .filter(Boolean)
    expect(visible).toEqual([])
  })

  test('every pulsing bar stands still under reduced motion', () => {
    const { container } = render(<PageSkeleton />)
    const bars = Array.from(container.querySelectorAll('.animate-pulse'))
    expect(bars.length).toBeGreaterThan(4)
    for (const bar of bars) {
      expect(bar.className).toContain('motion-reduce:animate-none')
    }
  })

  test('the bars are decorative, hidden from assistive technology', () => {
    const { container } = render(<PageSkeleton />)
    for (const bar of container.querySelectorAll('.animate-pulse')) {
      expect(bar.closest('[aria-hidden="true"]')).toBeTruthy()
    }
  })

  /**
   * A skeleton means "arriving". The dashed Placeholder means "planned, not
   * built". They must not share a mark, or an empty state and a loading state
   * become the same picture.
   */
  test('it does not borrow the dashed placeholder mark', () => {
    const { container } = render(<PageSkeleton />)
    expect(container.querySelector('.border-dashed')).toBeNull()
  })

  /**
   * The anchor: the heading block uses PageHeading's own line heights so the
   * eye's fixed point does not move when the real heading swaps in.
   */
  test('the heading block matches PageHeading’s metrics', () => {
    const { container } = render(<PageSkeleton />)
    const status = screen.getByRole('status')
    const [eyebrow, title] = Array.from(status.querySelectorAll('.animate-pulse'))
    expect(eyebrow.className).toContain('h-4')
    expect(title.className).toContain('h-8')
    expect(title.className).toContain('mt-1')
    expect(container.firstElementChild).toBe(status)
  })
})

/**
 * The three loading files are the SAME component, re-exported. Three files
 * because a loading boundary is scoped to its segment; one component because a
 * second hand-built copy is where copies drift.
 */
describe('the loading files', () => {
  test('shell, groups and workflows all default-export the one skeleton', async () => {
    const shell = await import('@/app/(shell)/loading')
    const groups = await import('@/app/(shell)/groups/loading')
    const workflows = await import('@/app/(shell)/workflows/loading')
    expect(shell.default).toBe(PageSkeleton)
    expect(groups.default).toBe(PageSkeleton)
    expect(workflows.default).toBe(PageSkeleton)
  })
})
