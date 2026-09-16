import { describe, expect, test } from 'vitest'
import { render, screen } from '@testing-library/react'
import React from 'react'
import { DataRow, DataSection } from '@/components/data-section'

const empty = { title: 'Nothing here', description: 'Add something.' }

describe('DataSection', () => {
  /**
   * The case the old `if (!children)` missed. Callers pass `rows.map(...)`, and
   * on no rows that is `[]` — truthy — which would have rendered a bordered
   * sheet with nothing inside it instead of the empty state.
   */
  test('an empty array of rows shows the empty state, not an empty sheet', () => {
    render(<DataSection addLabel="Add" empty={empty}>{[]}</DataSection>)
    expect(screen.getByText('Nothing here')).toBeTruthy()
    expect(screen.queryByRole('list')).toBeNull()
  })

  test('rows render inside one list, and the total inside the same sheet', () => {
    render(
      <DataSection addLabel="Add" empty={empty} total={{ label: 'Total', value: '$10.00' }}>
        <DataRow primary="A" meta="$4.00" />
        <DataRow primary="B" meta="$6.00" />
      </DataSection>,
    )
    const list = screen.getByRole('list')
    expect(screen.getAllByRole('listitem')).toHaveLength(2)
    // The total is a sibling of the list inside the sheet, not a footer outside it.
    const total = screen.getByText('$10.00')
    expect(total.closest('div')!.parentElement).toBe(list.parentElement)
    expect(screen.queryByText('Nothing here')).toBeNull()
  })

  /**
   * The total band carries `data-slot="total"`, and this asserts it EXISTS.
   *
   * That matters more than it looks. The accounts tab's test asserts the
   * investment section has **no** total by querying for this slot, and an
   * absence assertion is only as good as the hook it looks for — drop the
   * attribute and that test keeps passing while testing nothing. Found by
   * mutation on 10 September: removing the attribute broke no test at all.
   * The label is caller-supplied, so matching the word "Total" is not a
   * substitute.
   */
  test('the total band is marked with a slot, so its absence is assertable', () => {
    const { container: withTotal } = render(
      <DataSection addLabel="Add" empty={empty} total={{ label: 'Sum', value: '$10.00' }}>
        <DataRow primary="A" meta="$10.00" />
      </DataSection>,
    )
    const band = withTotal.querySelector('[data-slot="total"]')
    expect(band).toBeTruthy()
    // The label and the figure both live in it, whatever the label says.
    expect(band!.textContent).toContain('Sum')
    expect(band!.textContent).toContain('$10.00')

    const { container: without } = render(
      <DataSection addLabel="Add" empty={empty}>
        <DataRow primary="A" meta="$10.00" />
      </DataSection>,
    )
    expect(without.querySelector('[data-slot="total"]')).toBeNull()
  })

  /**
   * Meta sits opposite the text, and that is the only placement.
   *
   * A `metaBelow` option was added and removed on 10 September — the file notes
   * list, which was its only caller, became its own disclosure row instead. The
   * assertion that survives is the one that matters: a figure belongs at the
   * right edge so a column of them lines up.
   */
  test('meta sits opposite the text, for a column of figures', () => {
    render(
      <DataSection addLabel="Add" empty={empty}>
        <DataRow primary="Super" meta="$4.00" />
      </DataSection>,
    )
    const meta = screen.getByText('$4.00')
    expect(meta.className).toContain('ml-auto')
    expect(meta.className).toContain('shrink-0')
    expect(meta.className).not.toContain('basis-full')
  })

  test('a row carries its leading tile before the text', () => {
    render(
      <DataSection addLabel="Add" empty={empty}>
        <DataRow leading={<span data-testid="tile" />} primary="Super" secondary="Janet" />
      </DataSection>,
    )
    const row = screen.getByRole('listitem')
    const tile = screen.getByTestId('tile')
    expect(row.firstElementChild).toBe(tile)
  })

  /**
   * **The name has the header line to itself.**
   *
   * A `badge` prop used to put a status pill here, to the right of the name.
   * The pill was `whitespace-nowrap` and the name is `truncate`, so in this
   * flexible column the pill always won and the NAME was what got cut —
   * plainly wrong once the accounts list moved into the 65% column of a
   * `TAB_SPLIT`. Status moved to the leading tile, which is a fixed 36px
   * square and cannot squeeze anything, and the prop was removed rather than
   * left unused (see the note in the component, and the removed `metaBelow`
   * before it).
   *
   * So the header line is one element now, and that is the assertion: a second
   * child here means something is competing for the width again.
   */
  test('nothing shares the header line with the name', () => {
    render(
      <DataSection addLabel="Add" empty={empty}>
        <DataRow primary="A Very Long Account Label Indeed" secondary="Janet" meta="$1.00" />
      </DataSection>,
    )
    const name = screen.getByText('A Very Long Account Label Indeed')
    expect(name.className).toContain('truncate')
    // `block`, not a flex row holding the name plus a badge.
    expect(name.className).toContain('block')
    expect(name.parentElement!.firstElementChild, 'the name is first in its column').toBe(name)
    // Its column holds the name and the second line, and nothing else.
    expect(name.parentElement!.children).toHaveLength(2)
  })
})

/**
 * The row's optional click target, added 16 September for the account and
 * policy drawers.
 *
 * The rule the tests below encode is that a row only behaves like a control
 * when it actually is one — the balance-sheet rows and the file-notes rows open
 * nothing, and a hover tint or a button role on those would promise something
 * that does not happen.
 */
describe('DataRow with a trigger', () => {
  const noop = () => {}

  test('a row without one renders no button and no hover tint', () => {
    const { container } = render(
      <DataSection addLabel="Add" empty={empty}>
        <DataRow primary="Untouchable" meta="$1.00" />
      </DataSection>,
    )
    expect(container.querySelector('button')).toBeNull()
    expect(container.querySelector('li')!.className).not.toContain('hover:bg-neutral-50')
  })

  test('a row with one renders exactly one button, named as given', () => {
    const { container } = render(
      <DataSection addLabel="Add" empty={empty}>
        <DataRow
          primary="Netwealth Wrap"
          meta="$1.00"
          trigger={{ label: 'Open account: Netwealth Wrap', onClick: noop }}
        />
      </DataSection>,
    )
    expect(container.querySelectorAll('button')).toHaveLength(1)
    expect(screen.getByRole('button', { name: 'Open account: Netwealth Wrap' })).toBeTruthy()
    expect(container.querySelector('li')!.className).toContain('hover:bg-neutral-50')
  })

  /* A control inside a control is invalid, and the meta column is where a
     valuation picker is the obvious next thing to land. */
  test('and the meta column stays outside it', () => {
    render(
      <DataSection addLabel="Add" empty={empty}>
        <DataRow
          primary="Netwealth Wrap"
          meta={<span>$626,559.81</span>}
          trigger={{ label: 'Open account: Netwealth Wrap', onClick: noop }}
        />
      </DataSection>,
    )
    const button = screen.getByRole('button', { name: 'Open account: Netwealth Wrap' })
    expect(button.textContent).toContain('Netwealth Wrap')
    expect(button.textContent).not.toContain('626,559.81')
  })

  /**
   * A class assertion, justified the way `modal-centring` justifies its own:
   * jsdom has no CSS engine, and `SHEET` is `overflow-hidden`, so an outer ring
   * on the first or last row is shaved by the sheet's own clip. Nothing that
   * renders can see that; the class is the only evidence there is.
   */
  test('and its focus ring is inset, so the sheet cannot clip it', () => {
    render(
      <DataSection addLabel="Add" empty={empty}>
        <DataRow primary="A" trigger={{ label: 'Open account: A', onClick: noop }} />
      </DataSection>,
    )
    expect(screen.getByRole('button', { name: 'Open account: A' }).className).toContain(
      'ring-inset',
    )
  })

  test('and clicking it calls what it was given', () => {
    let opened = 0
    render(
      <DataSection addLabel="Add" empty={empty}>
        <DataRow primary="A" trigger={{ label: 'Open account: A', onClick: () => (opened += 1) }} />
      </DataSection>,
    )
    screen.getByRole('button', { name: 'Open account: A' }).click()
    expect(opened).toBe(1)
  })
})
