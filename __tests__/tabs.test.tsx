import { describe, expect, test } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Tabs } from '@/components/tabs'
import { WELL, WORKING_AREA } from '@/components/ui'

const items = [
  { id: 'one', label: 'Workflows', panel: <p>workflow content</p> },
  { id: 'two', label: 'Accounts', panel: <p>account content</p> },
  { id: 'three', label: 'Detail', panel: <p>detail content</p> },
]

describe('Tabs', () => {
  test('the first tab is selected and only its panel is exposed', () => {
    render(<Tabs items={items} label="Group sections" />)

    expect(screen.getByRole('tab', { name: 'Workflows' }).getAttribute('aria-selected')).toBe('true')
    expect(screen.getByRole('tab', { name: 'Accounts' }).getAttribute('aria-selected')).toBe('false')

    /* Every panel has a box in the DOM and the inactive ones carry `hidden`,
       which keeps them out of the accessibility tree — hence exactly one
       element with the tabpanel role. */
    expect(screen.getAllByRole('tabpanel')).toHaveLength(1)
    expect(screen.getByRole('tabpanel').textContent).toBe('workflow content')
    expect(document.querySelectorAll('[role="tabpanel"]')).toHaveLength(items.length)
  })

  describe('a panel is built when its tab is first opened, and kept after that', () => {
    /**
     * **The unopened panels are EMPTY, not merely hidden.**
     *
     * Every panel used to render at once, inactive ones behind `hidden`. That
     * is harmless for text and wrong for a panel that does something on mount:
     * the investment ring played its draw animation at page load inside a
     * hidden box, so it was already finished by the time the Accounts tab was
     * reached. Reported on 11 September as the chart drawing on page load
     * rather than on tab selection.
     *
     * Asserting on the panel's own box rather than on `queryByText` alone, so
     * this cannot be satisfied by the panel disappearing altogether.
     */
    test('an unopened panel is an empty box, so nothing in it has mounted', () => {
      render(<Tabs items={items} label="Group sections" />)

      const boxes = Array.from(document.querySelectorAll('[role="tabpanel"]'))
      expect(boxes.map((b) => b.textContent)).toEqual(['workflow content', '', ''])
      expect(screen.queryByText('account content')).toBeNull()
    })

    test('opening a tab builds its panel', async () => {
      const user = userEvent.setup()
      render(<Tabs items={items} label="Group sections" />)

      await user.click(screen.getByRole('tab', { name: 'Accounts' }))

      expect(screen.getByText('account content')).toBeTruthy()
      // Still untouched, because it has never been opened.
      expect(screen.queryByText('detail content')).toBeNull()
    })

    /**
     * Mount on first open and KEEP. Unmounting on the way out would restart the
     * ring's draw on every visit and throw away anything typed into a panel's
     * form — the property the all-mounted version existed for, and the half of
     * it worth keeping.
     */
    test('and leaving it again keeps it, rather than tearing it down', async () => {
      const user = userEvent.setup()
      render(<Tabs items={items} label="Group sections" />)

      await user.click(screen.getByRole('tab', { name: 'Accounts' }))
      await user.click(screen.getByRole('tab', { name: 'Workflows' }))

      const kept = screen.getByText('account content')
      expect(kept.closest('[role="tabpanel"]')).toHaveProperty('hidden', true)
    })

    test('the keyboard opens a panel too, not only the mouse', async () => {
      const user = userEvent.setup()
      render(<Tabs items={items} label="Group sections" />)

      screen.getByRole('tab', { name: 'Workflows' }).focus()
      await user.keyboard('{ArrowRight}')

      expect(screen.getByText('account content')).toBeTruthy()
    })
  })

  test('clicking a tab switches the panel', async () => {
    const user = userEvent.setup()
    render(<Tabs items={items} label="Group sections" />)

    await user.click(screen.getByRole('tab', { name: 'Accounts' }))

    expect(screen.getByRole('tab', { name: 'Accounts' }).getAttribute('aria-selected')).toBe('true')
    expect(screen.getAllByRole('tabpanel')).toHaveLength(1)
    expect(screen.getByRole('tabpanel').textContent).toBe('account content')
  })

  test('arrow keys move between tabs', async () => {
    const user = userEvent.setup()
    render(<Tabs items={items} label="Group sections" />)

    screen.getByRole('tab', { name: 'Workflows' }).focus()
    await user.keyboard('{ArrowRight}')

    expect(screen.getByRole('tab', { name: 'Accounts' }).getAttribute('aria-selected')).toBe('true')
  })

  /* Roving tabindex: exactly one tab is reachable by Tab key, so the tablist is
     a single stop rather than three. */
  test('only the selected tab is in the tab order', () => {
    render(<Tabs items={items} label="Group sections" />)

    const reachable = screen
      .getAllByRole('tab')
      .filter((t) => t.getAttribute('tabindex') === '0')
    expect(reachable).toHaveLength(1)
    expect(reachable[0].textContent).toBe('Workflows')
  })

  /* The indicator is measured from the DOM, so before measurement its width is
     zero. It must not animate on that first paint, or it visibly slides in from
     the left edge on load. jsdom reports every element as 0x0, which makes this
     exactly the unmeasured case. */
  test('the indicator does not animate before it has been measured', () => {
    const { container } = render(<Tabs items={items} label="Group sections" />)

    const indicator = container.querySelector('[aria-hidden="true"]')
    expect(indicator).not.toBeNull()
    // motion-reduce:transition-none is always present; the animating class is not.
    expect(indicator?.className).not.toContain('transition-[left,width]')
  })

  /**
   * **The gutter is a closed set of steps, and each step is four branches.**
   *
   * Tailwind scans source text, so a constructed `-mx-${gutter}` would never be
   * generated — which is why this is `4 | 5 | 6 | 8` rather than a number, and
   * why adding a step means editing the strip's padding, the negative margin
   * that bleeds it, the lift that caps a container, and the grounded panel.
   * Three of those four are easy to forget, and nothing about the markup looks
   * wrong when one is missed.
   *
   * 8 was added on 11 September 2026 for the member panel.
   */
  describe('the gutter steps', () => {
    const strip = (c: HTMLElement) => c.querySelector('[role="tablist"]')!
    const panel = (c: HTMLElement) => c.querySelector('[role="tabpanel"]')!

    test('each step pads the strip to its own width', () => {
      for (const [gutter, cls] of [[4, 'px-4'], [5, 'px-5'], [6, 'px-6'], [8, 'px-8']] as const) {
        const { container, unmount } = render(
          <Tabs items={items} label="s" gutter={gutter} />,
        )
        expect(strip(container).className, `gutter ${gutter}`).toContain(cls)
        unmount()
      }
    })

    /* With `alignFirst` the left side gives back the button's own 12px, so the
       first LABEL lands on the container's text edge rather than its box edge.
       The right side still carries the gutter whole — asserted together,
       because a step that got one and not the other would look centred. */
    test('and lines the first label up by giving back the button’s own padding', () => {
      for (const [gutter, left, right] of [
        [4, 'pl-1', 'pr-4'],
        [5, 'pl-2', 'pr-5'],
        [6, 'pl-3', 'pr-6'],
        [8, 'pl-5', 'pr-8'],
      ] as const) {
        const { container, unmount } = render(
          <Tabs items={items} label="s" gutter={gutter} alignFirst />,
        )
        expect(strip(container).className, `gutter ${gutter} left`).toContain(left)
        expect(strip(container).className, `gutter ${gutter} right`).toContain(right)
        unmount()
      }
    })

    /* Bleeding cancels the parent's padding so the strip reaches the container's
       edges, and the lift pulls it into the top padding so it caps the card.
       Both are the gutter's own negative — a mismatch puts the strip inside a
       picture frame, which is the bug `bleed` exists to prevent. */
    test('a bled strip cancels exactly the padding it sits in', () => {
      for (const [gutter, pull, lift] of [
        [4, '-mx-4', '-mt-4'],
        [5, '-mx-5', '-mt-5'],
        [6, '-mx-6', '-mt-6'],
        [8, '-mx-8', '-mt-8'],
      ] as const) {
        const { container, unmount } = render(<Tabs items={items} label="s" gutter={gutter} />)
        expect(strip(container).className, `gutter ${gutter} pull`).toContain(pull)
        expect(strip(container).className, `gutter ${gutter} lift`).toContain(lift)
        unmount()
      }
    })

    /* A grounded panel has to reach the edges the same way, or the grey sits in
       a white frame. This is the fourth branch, and the one with no visible
       symptom until a caller turns `ground` on. */
    test('and a grounded panel reaches them too', () => {
      for (const [gutter, cls] of [
        [4, '-mx-4'],
        [5, '-mx-5'],
        [6, '-mx-6'],
        [8, '-mx-8'],
      ] as const) {
        const { container, unmount } = render(
          <Tabs items={items} label="s" gutter={gutter} ground />,
        )
        expect(panel(container).className, `gutter ${gutter}`).toContain(cls)
        unmount()
      }
    })
  })

  /**
   * `minPanel` — a floor under the panel's height, added 14 September so the
   * group page's middle column keeps a working area whatever tab is open.
   */
  describe('the panel floor', () => {
    const panels = (container: HTMLElement) =>
      Array.from(container.querySelectorAll('[role="tabpanel"]')) as HTMLElement[]

    /**
     * **On every panel, not only the open one.** The floor exists so the
     * container does not change height as the reader moves between tabs, and
     * one tall panel among short ones would produce exactly the jump it is
     * meant to remove.
     */
    test('applies to every panel, so the height does not jump between tabs', () => {
      const { container } = render(<Tabs items={items} label="s" minPanel={WORKING_AREA} />)
      expect(panels(container)).toHaveLength(3)
      for (const p of panels(container)) expect(p.className).toContain(WORKING_AREA)
    })

    test('and is absent unless a caller asks for it', () => {
      const { container } = render(<Tabs items={items} label="s" />)
      for (const p of panels(container)) expect(p.className).not.toContain('min-h-')
    })

    /**
     * **The floor and the grey well are the same box.** A grounded panel
     * carries the well and cancels the card's bottom padding to reach its
     * edge; if the height were applied to some outer element instead, the well
     * would stop at its content and leave a white band below it — which reads
     * as a rendering fault, not as space.
     */
    test('lands on the same element as the ground, so the well fills it', () => {
      const { container } = render(
        <Tabs items={items} label="s" ground minPanel={WORKING_AREA} />,
      )
      for (const p of panels(container)) {
        expect(p.className).toContain(WELL)
        expect(p.className).toContain(WORKING_AREA)
      }
    })

    /* Under `fill` the panel is already stretching to a container with its own
       height, and a floor on top of that would push the strip off the top of a
       fixed-height box — the member panel's case. */
    test('a filling panel ignores it, since it is already stretching', () => {
      const { container } = render(
        <Tabs items={items} label="s" fill minPanel={WORKING_AREA} />,
      )
      for (const p of panels(container)) {
        expect(p.className).toContain('flex-1')
        expect(p.className).not.toContain(WORKING_AREA)
      }
    })
  })
})
