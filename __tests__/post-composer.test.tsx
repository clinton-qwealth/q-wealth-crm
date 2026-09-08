import { describe, expect, test, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import React from 'react'
import type { Editor } from '@tiptap/react'
import { PostComposer } from '@/components/post-composer'
import { POST_MARK_TYPES, POST_NODE_TYPES, type PostDoc } from '@/lib/workflow-board'

const STAFF = [{ id: 's1', name: 'Sarah Chen' }, { id: 's2', name: 'Clinton Hatcher' }]

/**
 * ProseMirror mounts in jsdom but cannot be typed into the way a person types,
 * so the document is set through the editor itself, via `onReady`. What is
 * under test is the composer's contract: Post is disabled on an empty
 * document, the document handed over is the editor's own, and it clears only
 * when told the post was accepted.
 */
type OnPost = (doc: PostDoc) => Promise<boolean>
async function mount(onPost = vi.fn<OnPost>(async () => true)) {
  let editor: Editor | null = null
  render(<PostComposer staff={STAFF} onPost={onPost} onReady={(e) => (editor = e)} />)
  await waitFor(() => expect(editor).not.toBeNull())
  return { editor: editor!, onPost }
}

const postButton = () => screen.getByRole<HTMLButtonElement>('button', { name: 'Post' })

describe('the post composer', () => {
  test('starts empty, with a placeholder and Post disabled', async () => {
    await mount()
    expect(screen.getByText(/@ mentions a colleague, : adds an emoji/)).toBeTruthy()
    expect(postButton().disabled).toBe(true)
  })

  test('hands over the editor’s own document and clears once the post is accepted', async () => {
    const user = userEvent.setup()
    const { editor, onPost } = await mount()
    editor.commands.setContent({
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Hello ', marks: [] }, { type: 'text', text: 'there', marks: [{ type: 'bold' }] }] }],
    })
    await waitFor(() => expect(postButton().disabled).toBe(false))
    await user.click(postButton())

    const sent = onPost.mock.calls[0][0]
    expect(sent.type).toBe('doc')
    expect(JSON.stringify(sent)).toContain('"text":"there"')
    expect(JSON.stringify(sent)).toContain('"type":"bold"')
    await waitFor(() => expect(editor.isEmpty).toBe(true))
  })

  test('keeps the words when the post is refused', async () => {
    const user = userEvent.setup()
    const { editor } = await mount(vi.fn<OnPost>(async () => false))
    editor.commands.setContent('<p>Keep me</p>')
    await waitFor(() => expect(postButton().disabled).toBe(false))
    await user.click(postButton())
    await waitFor(() => expect(postButton().disabled).toBe(false))
    expect(editor.getText()).toBe('Keep me')
  })

  /**
   * ProseMirror builds a node's attrs with Object.create(null). React's Server
   * Action serialiser turns a null-prototype object into an opaque reference,
   * and the server throws on first access. The composer must hand over plain
   * JSON — asserted on a mention's attrs, which is where the browser first hit
   * it.
   */
  test('hands over plain JSON — a mention’s attrs have an ordinary prototype', async () => {
    const user = userEvent.setup()
    const { editor, onPost } = await mount()
    editor.commands.setContent({
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'mention', attrs: { id: 's1', label: 'Sarah Chen' } }, { type: 'text', text: ' hi' }] }],
    })
    // What the editor itself holds is NOT plain — the reason the clone exists.
    const raw = editor.getJSON().content![0].content![0] as { attrs?: object }
    expect(Object.getPrototypeOf(raw.attrs)).toBeNull()
    await waitFor(() => expect(postButton().disabled).toBe(false))
    await user.click(postButton())
    const sent = onPost.mock.calls[0][0]
    const attrs = sent.content![0].content![0].attrs
    expect(Object.getPrototypeOf(attrs)).toBe(Object.prototype)
    expect(attrs).toEqual({ id: 's1', label: 'Sarah Chen', mentionSuggestionChar: '@' })
  })

  /**
   * The editor's schema and the database's whitelist are the same list. The
   * editor may hold nothing the database refuses, and — now that everything
   * StarterKit ships is on — everything the database allows is reachable.
   */
  test('the schema is exactly what the database allows: every node and mark, and nothing else', async () => {
    const { editor } = await mount()
    const nodes = Object.keys(editor.schema.nodes).sort()
    const marks = Object.keys(editor.schema.marks).sort()
    expect(nodes).toEqual([...POST_NODE_TYPES].sort())
    expect(marks).toEqual([...POST_MARK_TYPES].sort())
    for (const banned of ['table', 'image', 'iframe', 'taskList']) expect(nodes).not.toContain(banned)
  })

  test('a heading is level 1, 2 or 3 — the editor cannot make a level 4', async () => {
    const { editor } = await mount()
    editor.commands.setContent('<p>word</p>')
    expect(editor.can().setHeading({ level: 3 })).toBe(true)
    expect(editor.can().setHeading({ level: 4 as never })).toBe(false)
  })

  /**
   * The composer sits under the panel's h2 and its boxes' h3. A heading being
   * typed must not paint an h1 into that outline, so the editor draws the three
   * levels as h4–h6 — the same tags the feed draws them with — and parses both
   * back, so copying within the editor keeps a heading a heading.
   */
  test('a heading in the editor is painted as h4–h6, never h1–h3, and both parse back', async () => {
    const { editor } = await mount()
    editor.commands.setContent('<p>word</p>')
    editor.commands.setTextSelection({ from: 1, to: 5 })
    editor.commands.setHeading({ level: 1 })
    expect(editor.view.dom.querySelector('h4')?.textContent).toBe('word')
    expect(editor.view.dom.querySelector('h1, h2, h3')).toBeNull()
    editor.commands.setContent('<h5>five</h5><h2>two</h2>')
    // The trailing empty paragraph is StarterKit's TrailingNode, not a heading.
    const headings = editor.getJSON().content!.filter((n) => n.type === 'heading')
    expect(headings.map((n) => n.attrs?.level)).toEqual([2, 2])
  })

  test('the formatting toolbar toggles marks and blocks on the selection', async () => {
    const user = userEvent.setup()
    const { editor } = await mount()
    editor.commands.setContent('<p>word</p>')
    // A text selection, as a person makes one. `selectAll` gives an
    // AllSelection, against which TipTap's isActive never reports a block.
    editor.commands.setTextSelection({ from: 1, to: 5 })
    await user.click(screen.getByRole('button', { name: 'Bold' }))
    expect(JSON.stringify(editor.getJSON())).toContain('"type":"bold"')
    await user.click(screen.getByRole('button', { name: 'Underline' }))
    expect(JSON.stringify(editor.getJSON())).toContain('"type":"underline"')
    await user.click(screen.getByRole('button', { name: 'Heading 2' }))
    expect(editor.getJSON().content![0]).toMatchObject({ type: 'heading', attrs: { level: 2 } })
    await waitFor(() => expect(screen.getByRole('button', { name: 'Heading 2' }).getAttribute('aria-pressed')).toBe('true'))
    await user.click(screen.getByRole('button', { name: 'Quote' }))
    expect(editor.getJSON().content![0].type).toBe('blockquote')
  })

  test('the toolbar offers everything StarterKit ships, and Undo is disabled until there is something to undo', async () => {
    const { editor } = await mount()
    const toolbar = screen.getByRole('toolbar', { name: 'Formatting' })
    const labels = within(toolbar).getAllByRole('button').map((b) => b.getAttribute('aria-label'))
    expect(labels).toEqual([
      'Bold', 'Italic', 'Underline', 'Strikethrough', 'Inline code',
      'Heading 1', 'Heading 2', 'Heading 3',
      'Bulleted list', 'Numbered list', 'Quote', 'Code block', 'Horizontal rule',
      'Link', 'Undo', 'Redo',
    ])
    expect(screen.getByRole('button', { name: 'Undo' }).getAttribute('aria-disabled')).toBe('true')
    editor.commands.insertContent('typed')
    await waitFor(() => expect(screen.getByRole('button', { name: 'Undo' }).getAttribute('aria-disabled')).toBeNull())
  })

  /**
   * The link row applies the same http(s) rule the database enforces, so a
   * bad scheme is a sentence in the row rather than a refusal after posting.
   * A bare domain is given https://, because that is what the writer meant.
   */
  test('the Link button opens a row; a bare domain becomes https://, a javascript: scheme is refused', async () => {
    const user = userEvent.setup()
    const { editor } = await mount()
    editor.commands.setContent('<p>word</p>')
    editor.commands.selectAll()
    await user.click(screen.getByRole('button', { name: 'Link' }))
    const input = screen.getByLabelText<HTMLInputElement>('Link address')

    await user.type(input, 'javascript:alert(1)')
    await user.click(screen.getByRole('button', { name: 'Apply' }))
    expect(screen.getByRole('alert').textContent).toContain('must start with http:// or https://')
    expect(JSON.stringify(editor.getJSON())).not.toContain('"type":"link"')

    await user.clear(input)
    await user.type(input, 'example.com/page')
    await user.click(screen.getByRole('button', { name: 'Apply' }))
    expect(JSON.stringify(editor.getJSON())).toContain('"href":"https://example.com/page"')
    expect(screen.queryByLabelText('Link address')).toBeNull()
  })

  /**
   * The two suggestion lists. jsdom has no layout, so the caret rectangle is
   * all zeros — but it is a rectangle, and the list renders against it.
   */
  test('@ opens the colleague list; choosing one inserts a mention carrying the id', async () => {
    const { editor } = await mount()
    editor.commands.insertContent('@sar')
    const list = await screen.findByRole('listbox', { name: 'Mention a colleague' })
    expect(within(list).getAllByRole('option').map((o) => o.textContent)).toEqual(['Sarah Chen'])
    fireEvent.mouseDown(within(list).getByRole('button', { name: 'Sarah Chen' }))
    const first = editor.getJSON().content![0].content![0]
    expect(first).toMatchObject({ type: 'mention', attrs: { id: 's1', label: 'Sarah Chen' } })
    await waitFor(() => expect(screen.queryByRole('listbox')).toBeNull())
  })

  test(': and two letters open the emoji list; choosing one inserts the CHARACTER as text, no new node', async () => {
    const { editor } = await mount()
    editor.commands.insertContent(':thu')
    const list = await screen.findByRole('listbox', { name: 'Insert an emoji' })
    const first = within(list).getAllByRole('option')[0]
    expect(first.textContent).toContain('👍')
    expect(first.textContent).toContain(':thumbs_up:')
    fireEvent.mouseDown(within(first).getByRole('button'))
    expect(editor.getText()).toBe('👍 ')
    expect(editor.getJSON().content![0].content!.every((n) => n.type === 'text')).toBe(true)
  })

  test('a colon with fewer than two letters after it opens nothing', async () => {
    const { editor } = await mount()
    editor.commands.insertContent('Note:')
    editor.commands.insertContent(' :t')
    await new Promise((r) => setTimeout(r, 20))
    expect(screen.queryByRole('listbox')).toBeNull()
  })
})
