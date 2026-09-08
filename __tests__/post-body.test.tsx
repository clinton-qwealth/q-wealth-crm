import { describe, expect, test } from 'vitest'
import { render } from '@testing-library/react'
import React from 'react'
import { PostBody } from '@/components/post-body'
import type { PostDoc } from '@/lib/workflow-board'

const doc = (content: PostDoc['content']): PostDoc => ({ type: 'doc', content })

/**
 * The renderer is the reason a post is a document and not HTML: it walks a
 * known shape and emits known elements, so nothing anyone typed is ever handed
 * to the browser as markup. These tests pin that it draws every allowed node
 * and mark, and that it draws nothing it does not know.
 */
describe('PostBody', () => {
  test('draws paragraphs, marks and lists as real elements', () => {
    const { container } = render(
      <PostBody
        doc={doc([
          {
            type: 'paragraph',
            content: [
              { type: 'text', text: 'Plain ' },
              { type: 'text', text: 'bold', marks: [{ type: 'bold' }] },
              { type: 'text', text: ' and ' },
              { type: 'text', text: 'italic', marks: [{ type: 'italic' }] },
              { type: 'hardBreak' },
              { type: 'text', text: 'struck', marks: [{ type: 'strike' }] },
              { type: 'text', text: ' code', marks: [{ type: 'code' }] },
            ],
          },
          {
            type: 'bulletList',
            content: [
              { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'one' }] }] },
              { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'two' }] }] },
            ],
          },
          {
            type: 'orderedList',
            content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'first' }] }] }],
          },
        ])}
      />,
    )
    expect(container.querySelector('strong')!.textContent).toBe('bold')
    expect(container.querySelector('em')!.textContent).toBe('italic')
    expect(container.querySelector('s')!.textContent).toBe('struck')
    expect(container.querySelector('code')!.textContent).toBe(' code')
    expect(container.querySelector('br')).toBeTruthy()
    expect([...container.querySelectorAll('ul li')].map((li) => li.textContent)).toEqual(['one', 'two'])
    expect(container.querySelector('ol li')!.textContent).toBe('first')
    expect(container.querySelectorAll('p').length).toBe(4)
  })

  test('a web link is a link; anything else is text — even if the database let it through', () => {
    const { container } = render(
      <PostBody
        doc={doc([
          {
            type: 'paragraph',
            content: [
              { type: 'text', text: 'safe', marks: [{ type: 'link', attrs: { href: 'https://example.com/x' } }] },
              { type: 'text', text: ' ' },
              { type: 'text', text: 'unsafe', marks: [{ type: 'link', attrs: { href: 'javascript:alert(1)' } }] },
            ],
          },
        ])}
      />,
    )
    const links = [...container.querySelectorAll('a')]
    expect(links.length).toBe(1)
    expect(links[0].getAttribute('href')).toBe('https://example.com/x')
    expect(links[0].getAttribute('rel')).toBe('noopener noreferrer')
    expect(container.textContent).toContain('unsafe')
  })

  test('a mention shows the person’s CURRENT name from the view, falling back to what was typed', () => {
    const { container } = render(
      <PostBody
        doc={doc([
          {
            type: 'paragraph',
            content: [
              { type: 'mention', attrs: { id: 's1', label: 'Sarah C' } },
              { type: 'text', text: ' and ' },
              { type: 'mention', attrs: { id: 's9', label: 'Someone Gone' } },
            ],
          },
        ])}
        mentioned={[{ staff_id: 's1', full_name: 'Sarah Chen' }]}
      />,
    )
    const mentions = [...container.querySelectorAll('[data-mention]')].map((m) => m.textContent)
    expect(mentions).toEqual(['@Sarah Chen', '@Someone Gone'])
  })

  test('a node type it does not know is not drawn — and never as markup', () => {
    const { container } = render(
      <PostBody
        doc={doc([
          { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'shout' }] } as never,
          { type: 'paragraph', content: [{ type: 'text', text: '<b>not html</b>' }] },
        ])}
      />,
    )
    expect(container.querySelector('h1')).toBeNull()
    expect(container.textContent).not.toContain('shout')
    // The text node's angle brackets are text, not tags.
    expect(container.querySelector('b')).toBeNull()
    expect(container.textContent).toContain('<b>not html</b>')
  })

  test('an empty paragraph keeps its line', () => {
    const { container } = render(<PostBody doc={doc([{ type: 'paragraph' }])} />)
    expect(container.querySelector('p br')).toBeTruthy()
  })
})
