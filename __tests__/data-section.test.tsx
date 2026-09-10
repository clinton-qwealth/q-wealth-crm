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
})
