import { describe, expect, test, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import React from 'react'
import type { Editor } from '@tiptap/react'
import { PostComposer } from '@/components/post-composer'
import type { PostDoc } from '@/lib/workflow-board'

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

describe('the post composer', () => {
  test('starts empty, with a placeholder and Post disabled', async () => {
    await mount()
    expect(screen.getByText(/Use @ to mention a colleague/)).toBeTruthy()
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Post' }).disabled).toBe(true)
  })

  test('hands over the editor’s own document and clears once the post is accepted', async () => {
    const user = userEvent.setup()
    const { editor, onPost } = await mount()
    editor.commands.setContent({
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Hello ', marks: [] }, { type: 'text', text: 'there', marks: [{ type: 'bold' }] }] }],
    })
    await waitFor(() => expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Post' }).disabled).toBe(false))
    await user.click(screen.getByRole('button', { name: 'Post' }))

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
    await waitFor(() => expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Post' }).disabled).toBe(false))
    await user.click(screen.getByRole('button', { name: 'Post' }))
    await waitFor(() => expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Post' }).disabled).toBe(false))
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
    await waitFor(() => expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Post' }).disabled).toBe(false))
    await user.click(screen.getByRole('button', { name: 'Post' }))
    const sent = onPost.mock.calls[0][0]
    const attrs = sent.content![0].content![0].attrs
    expect(Object.getPrototypeOf(attrs)).toBe(Object.prototype)
    expect(attrs).toEqual({ id: 's1', label: 'Sarah Chen', mentionSuggestionChar: '@' })
  })

  test('the schema cannot produce what the database refuses: no headings, quotes or code blocks', async () => {
    const { editor } = await mount()
    const names = Object.keys(editor.schema.nodes)
    for (const banned of ['heading', 'blockquote', 'codeBlock', 'horizontalRule']) {
      expect(names).not.toContain(banned)
    }
    for (const allowed of ['paragraph', 'text', 'hardBreak', 'mention', 'bulletList', 'orderedList', 'listItem']) {
      expect(names).toContain(allowed)
    }
    expect(Object.keys(editor.schema.marks)).not.toContain('underline')
  })

  test('the formatting toolbar toggles marks on the selection', async () => {
    const user = userEvent.setup()
    const { editor } = await mount()
    editor.commands.setContent('<p>word</p>')
    editor.commands.selectAll()
    await user.click(screen.getByRole('button', { name: 'Bold' }))
    expect(JSON.stringify(editor.getJSON())).toContain('"type":"bold"')
  })
})
