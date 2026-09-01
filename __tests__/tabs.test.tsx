import { describe, expect, test } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Tabs } from '@/components/tabs'

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

    /* Every panel stays mounted and inactive ones carry `hidden`, so state and
       scroll position survive a tab switch. `hidden` keeps them out of the
       accessibility tree, which is why exactly one tabpanel has a role. */
    expect(screen.getAllByRole('tabpanel')).toHaveLength(1)
    expect(screen.getByRole('tabpanel').textContent).toBe('workflow content')
    expect(screen.getByText('account content').closest('[role="tabpanel"]')).toHaveProperty(
      'hidden',
      true,
    )
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
})
