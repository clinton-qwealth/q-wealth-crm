import { render } from '@testing-library/react'
import { describe, expect, test } from 'vitest'
import { WorkflowRoleTile, WorkflowTemplateTile } from '@/components/ui'

/**
 * The Workflow management tiles — the anchors the two admin lists gained on
 * 25 September 2026.
 *
 * What a plausible implementation gets wrong, pinned here:
 *
 * - **A draft looks published.** The tile is the row's loudest signal, and a
 *   draft wearing the live violet says "deployable" about a template the
 *   deploy dialog will not offer. The word is load-bearing too: on the tile
 *   the state is otherwise only a tint, which a colour-blind reader does not
 *   have — so the dormant states must carry their word (`title` + `sr-only`),
 *   and the live one must NOT, or every published row would announce a label
 *   nobody wrote.
 * - **Roles all get one glyph.** The lettering is the point: six roles, six
 *   different tiles for the scanning eye to land on.
 * - **A circle.** People are circles here, things are squares, and a role is
 *   a job — a thing somebody will fill, not the somebody.
 */
describe('the template tile', () => {
  test('published is the live violet, and quiet about it', () => {
    const { container } = render(<WorkflowTemplateTile status="published" />)
    const tile = container.querySelector('span[aria-hidden]')!
    expect(tile.className).toContain('violet')
    expect(container.querySelector('.sr-only')).toBeNull()
  })

  test.each([
    ['draft', 'Draft'],
    ['archived', 'Archived'],
  ])('%s is dormant grey and says so', (status, word) => {
    const { container } = render(<WorkflowTemplateTile status={status} />)
    const tile = container.querySelector('span[aria-hidden]')!
    expect(tile.className).not.toContain('violet')
    expect(tile.getAttribute('title')).toBe(word)
    expect(container.querySelector('.sr-only')?.textContent).toBe(word)
  })

  test('draft and archived carry different glyphs — being written is not being done with', () => {
    const draft = render(<WorkflowTemplateTile status="draft" />).container.innerHTML
    const archived = render(<WorkflowTemplateTile status="archived" />).container.innerHTML
    expect(draft).not.toBe(archived.replace('Archived', 'Draft'))
  })
})

describe('the role tile', () => {
  test('carries the role’s initials, so each role gets its own tile', () => {
    const { container } = render(<WorkflowRoleTile name="Client Services" status="active" />)
    expect(container.querySelector('span[aria-hidden]')?.textContent).toBe('CS')
  })

  test('is a square, because a role is a job and not the person who fills it', () => {
    const { container } = render(<WorkflowRoleTile name="Adviser" status="active" />)
    const tile = container.querySelector('span[aria-hidden]')!
    expect(tile.className).toContain('rounded-lg')
    expect(tile.className).not.toContain('rounded-full')
  })

  test('archived gives up its initials for the archive glyph, and says the word', () => {
    const { container } = render(<WorkflowRoleTile name="Registry" status="archived" />)
    const tile = container.querySelector('span[aria-hidden]')!
    expect(tile.textContent).not.toContain('R')
    expect(tile.querySelector('svg')).toBeTruthy()
    expect(container.querySelector('.sr-only')?.textContent).toBe('Archived')
  })
})
