import { describe, expect, test } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import type { Editor } from '@tiptap/react'

const { MessageEditor } = await import('@/components/message-editor')
const { EMAIL_MARK_TYPES, EMAIL_NODE_TYPES } = await import('@/lib/workflow-board')

async function mount() {
  let editor: Editor | null = null
  render(<MessageEditor onReady={(e) => (editor = e)} />)
  await waitFor(() => expect(editor).not.toBeNull())
  return editor!
}

/**
 * The email body's editor. Its whole reason for existing separately from the
 * feed's composer is that it produces a NARROWER document, so that is what
 * these hold.
 */
describe('the message editor', () => {
  /**
   * The single most useful assertion here, and the mirror of the one the post
   * composer carries: the editor's schema must equal the shared constant in
   * BOTH directions, so it can neither produce something `record_task_action()`
   * would refuse nor be missing something the database allows.
   */
  test('the editor’s schema is exactly the email node and mark list', async () => {
    const editor = await mount()
    expect(Object.keys(editor.schema.nodes).sort()).toEqual([...EMAIL_NODE_TYPES].sort())
    expect(Object.keys(editor.schema.marks).sort()).toEqual([...EMAIL_MARK_TYPES].sort())
  })

  /**
   * The four node types a post may carry and a message may not. Each is a
   * specific hazard rather than tidiness — a mention resolves to a current
   * name inside an already-sent message, an image claims a post's media row.
   */
  test('a message cannot carry a mention, a chip, a picture or a file', async () => {
    const editor = await mount()
    for (const node of ['mention', 'entity', 'image', 'attachment', 'callout']) {
      expect(editor.schema.nodes[node]).toBeUndefined()
    }
  })

  test('the toolbar offers formatting only — no Image, no Attach file, no Post', async () => {
    await mount()
    const toolbar = screen.getByRole('toolbar', { name: 'Formatting' })
    const labels = within(toolbar).getAllByRole('button').map((b) => b.getAttribute('aria-label'))
    expect(labels).toEqual([
      'Bold', 'Italic', 'Underline', 'Strikethrough', 'Inline code',
      'Heading',
      'Bulleted list', 'Numbered list', 'Quote', 'Code block',
      'Link',
    ])
    // Send belongs to the modal, at the bottom of the form.
    expect(screen.queryByRole('button', { name: /Post|Send/ })).toBeNull()
  })

  /** One heading size, as a post has — and painted h4 so it cannot claim the page. */
  test('a heading is level 1 only, and paints h4 rather than h1', async () => {
    const editor = await mount()
    editor.commands.setContent('<p>x</p>')
    editor.commands.setTextSelection(2)
    editor.commands.toggleHeading({ level: 1 })
    expect(editor.getJSON().content![0]).toMatchObject({ type: 'heading', attrs: { level: 1 } })
    expect(editor.getHTML()).toContain('<h4')
    expect(editor.getHTML()).not.toContain('<h1')

    // A pasted h2 finds no level to parse into, so it becomes ordinary text —
    // not silently a level 1.
    editor.commands.setContent('<h2>two</h2>')
    expect(editor.getJSON().content!.filter((n) => n.type === 'heading')).toEqual([])
  })
})
