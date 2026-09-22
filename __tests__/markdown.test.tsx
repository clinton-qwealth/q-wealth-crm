import { render } from '@testing-library/react'
import { describe, expect, test } from 'vitest'
import { Markdown, outline } from '@/components/markdown'

/**
 * The reader draws the converter's markdown as elements, never as HTML.
 */
describe('Markdown', () => {
  test('headings carry the chunker’s slug as their id, one level down from the page title', () => {
    render(<Markdown source={'## The seven steps\n\nBody.\n\n### Step 1\n\nMore.'} />)
    const h2 = document.getElementById('the-seven-steps')!
    expect(h2.tagName).toBe('H3')
    expect(h2.textContent).toBe('The seven steps')
    expect(document.getElementById('step-1')!.tagName).toBe('H4')
  })

  test('a table with a header row, br inside a cell, and an escaped pipe', () => {
    render(<Markdown source={'| **Version** | Notes |\n| --- | --- |\n| 1.1 | first<br>second \\| third |'} />)
    const ths = [...document.querySelectorAll('th')].map((th) => th.textContent)
    expect(ths).toEqual(['Version', 'Notes'])
    const td = document.querySelectorAll('td')[1]
    expect(td.querySelector('br')).not.toBeNull()
    expect(td.textContent).toBe('firstsecond | third')
  })

  test('a blank header row draws no thead', () => {
    render(<Markdown source={'|  |  |\n| --- | --- |\n| Name | Jane |'} />)
    expect(document.querySelector('thead')).toBeNull()
    expect(document.querySelectorAll('td')).toHaveLength(2)
  })

  test('lists nest, tasks show a box, and a licence panel is a blockquote', () => {
    render(<Markdown source={'- One\n  - Nested\n- [x] Done\n\n> **Financial Advice Co Pty Ltd**\n> ABN 37 660 747 366'} />)
    const outer = document.querySelector('ul')!
    expect(outer.querySelector('ul')).not.toBeNull()
    expect(document.body.textContent).toContain('☑')
    const quote = document.querySelector('blockquote')!
    expect(quote.querySelector('strong')?.textContent).toBe('Financial Advice Co Pty Ltd')
    expect(quote.textContent).toContain('ABN 37 660 747 366')
  })

  test('inline marks: strong, em, code, links external and internal, escapes', () => {
    render(<Markdown source={'**bold** *em* `code` [mail](mailto:a@b.c) [in](/help/1) \\*not em\\* 1\\. not a list'} />)
    expect(document.querySelector('strong')?.textContent).toBe('bold')
    expect(document.querySelector('em')?.textContent).toBe('em')
    expect(document.querySelector('code')?.textContent).toBe('code')
    const [mail, internal] = [...document.querySelectorAll('a')]
    expect(mail.getAttribute('target')).toBe('_blank')
    expect(mail.getAttribute('rel')).toBe('noopener noreferrer')
    expect(internal.getAttribute('target')).toBeNull()
    expect(document.body.textContent).toContain('*not em* 1. not a list')
  })

  test('a lone star is a character, and a fence is preformatted with ## kept as text', () => {
    render(<Markdown source={'5 * 3 = 15\n\n```sql\n## not a heading\nselect 1;\n```'} />)
    expect(document.body.textContent).toContain('5 * 3 = 15')
    expect(document.querySelector('pre code')?.textContent).toBe('## not a heading\nselect 1;')
    expect(document.getElementById('not-a-heading')).toBeNull()
  })

  /* The rule the audit trail pins for a payload, pinned here for a policy. */
  test('markup inside a policy is shown, never interpreted', () => {
    render(<Markdown source={'A line with \\<img src=x onerror=alert(1)\\> in it.\n\n| \\<b\\>x\\</b\\> |\n| --- |\n| <script>1</script> |'} />)
    expect(document.querySelector('img')).toBeNull()
    expect(document.querySelector('script')).toBeNull()
    expect(document.querySelector('b')).toBeNull()
    expect(document.body.textContent).toContain('<img src=x onerror=alert(1)>')
    expect(document.body.textContent).toContain('<script>1</script>')
  })
})

/**
 * The reader's "On this page" column. Its whole value is that every entry
 * links to a heading that exists, so each test pairs the outline against what
 * the renderer actually put in the document.
 */
describe('outline', () => {
  test('every entry’s id is a heading the renderer drew', () => {
    const md = '## The seven steps\n\nBody.\n\n### Step 1 — scope\n\nMore.\n\n## Review\n\nEnd.'
    render(<Markdown source={md} />)
    const entries = outline(md)
    expect(entries.map((e) => e.text)).toEqual(['The seven steps', 'Step 1 — scope', 'Review'])
    expect(entries.map((e) => e.depth)).toEqual([0, 1, 0])
    for (const e of entries) expect(document.getElementById(e.id)).not.toBeNull()
  })

  /**
   * The reason it shares the renderer's fence handling rather than scanning
   * for `/^## /`. Mutation: drop the FENCE branch → 'Not a heading' is listed
   * and links nowhere.
   */
  test('a ## inside a fenced block is not a heading', () => {
    const md = '## Real\n\n```\n## Not a heading\n```\n\n## Also real'
    expect(outline(md).map((e) => e.text)).toEqual(['Real', 'Also real'])
  })

  test('marks are stripped so the id matches the rendered heading', () => {
    const md = '## **Breach** reporting'
    render(<Markdown source={md} />)
    const [entry] = outline(md)
    expect(entry.text).toBe('Breach reporting')
    expect(document.getElementById(entry.id)).not.toBeNull()
  })

  test('nothing below h3 clutters the column', () => {
    expect(outline('## A\n\n#### Too deep').map((e) => e.text)).toEqual(['A'])
  })
})
