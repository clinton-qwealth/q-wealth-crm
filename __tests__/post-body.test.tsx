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
              { type: 'text', text: ' under', marks: [{ type: 'underline' }] },
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
    expect(container.querySelector('u')!.textContent).toBe(' under')
    expect(container.querySelector('br')).toBeTruthy()
    expect([...container.querySelectorAll('ul li')].map((li) => li.textContent)).toEqual(['one', 'two'])
    expect(container.querySelector('ol li')!.textContent).toBe('first')
    expect(container.querySelectorAll('p').length).toBe(4)
  })

  /**
   * A post's headings sit BENEATH the panel's own h2 and h3 in the outline:
   * level 1 is h4, level 2 is h5, level 3 is h6. A comment must never be able
   * to draw an h1 and claim to be the page.
   */
  test('headings are drawn as h4, h5 and h6 — never as h1, h2 or h3', () => {
    const { container } = render(
      <PostBody
        doc={doc([
          { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'One' }] },
          { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Two' }] },
          { type: 'heading', attrs: { level: 3 }, content: [{ type: 'text', text: 'Three' }] },
        ])}
      />,
    )
    expect(container.querySelector('h4')!.textContent).toBe('One')
    expect(container.querySelector('h5')!.textContent).toBe('Two')
    expect(container.querySelector('h6')!.textContent).toBe('Three')
    expect(container.querySelector('h1, h2, h3')).toBeNull()
  })

  test('a quote, a code block and a rule are their own elements', () => {
    const { container } = render(
      <PostBody
        doc={doc([
          { type: 'blockquote', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'said' }] }] },
          { type: 'codeBlock', attrs: { language: 'sql' }, content: [{ type: 'text', text: 'select 1' }] },
          { type: 'horizontalRule' },
        ])}
      />,
    )
    expect(container.querySelector('blockquote p')!.textContent).toBe('said')
    expect(container.querySelector('pre code')!.textContent).toBe('select 1')
    // The language is a hint for a highlighter this feed does not have; it is
    // not echoed onto the element.
    expect(container.querySelector('pre')!.getAttribute('class')).toBeNull()
    expect(container.querySelector('hr')).toBeTruthy()
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
          { type: 'table', content: [{ type: 'tableRow', content: [{ type: 'text', text: 'cell' }] }] } as never,
          { type: 'iframe', attrs: { src: 'https://evil.example' } } as never,
          { type: 'paragraph', content: [{ type: 'text', text: '<b>not html</b>' }] },
        ])}
      />,
    )
    expect(container.querySelector('table, iframe')).toBeNull()
    expect(container.textContent).not.toContain('cell')
    // The text node's angle brackets are text, not tags.
    expect(container.querySelector('b')).toBeNull()
    expect(container.textContent).toContain('<b>not html</b>')
  })

  test('an empty paragraph keeps its line', () => {
    const { container } = render(<PostBody doc={doc([{ type: 'paragraph' }])} />)
    expect(container.querySelector('p br')).toBeTruthy()
  })
})
