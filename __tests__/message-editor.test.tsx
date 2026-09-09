import { describe, expect, test } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import type { Editor } from '@tiptap/react'

const { MessageEditor } = await import('@/components/message-editor')
const { EMAIL_FONT_STACKS, EMAIL_MARK_TYPES, EMAIL_NODE_TYPES, isEmailColour, isEmailFont } =
  await import('@/lib/workflow-board')

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

  /**
   * The font and colour selectors, added 9 September. `textStyle` is the one
   * mark carrying values a WRITER chose rather than keys we chose, which is
   * why both are checked at the gate and again by the renderer.
   */
  describe('font and colour', () => {
    test('the font list is closed, and each option shows in its own face', async () => {
      await mount()
      const font = screen.getByRole<HTMLSelectElement>('combobox', { name: 'Font' })
      const options = [...font.options].map((o) => o.textContent)
      expect(options).toEqual([
        'Default', 'Arial', 'Georgia', 'Times New Roman', 'Courier New', 'Verdana', 'Tahoma',
      ])
      // A sample, not a list of names: the option is set in the font it names.
      const georgia = [...font.options].find((o) => o.textContent === 'Georgia')!
      expect(georgia.style.fontFamily).toContain('Georgia')
      // Default clears the mark rather than naming a font.
      expect([...font.options].find((o) => o.textContent === 'Default')!.value).toBe('')
    })

    test('choosing a font puts an offered stack on the text', async () => {
      const editor = await mount()
      editor.commands.setContent('<p>word</p>')
      editor.commands.setTextSelection({ from: 1, to: 5 })
      editor.commands.setFontFamily('Georgia, serif')
      expect(JSON.stringify(editor.getJSON())).toContain('"fontFamily":"Georgia, serif"')
      expect(EMAIL_FONT_STACKS).toContain('Georgia, serif')
    })

    test('a colour is six hex digits, and the input is a native colour picker', async () => {
      const editor = await mount()
      const colour = screen.getByLabelText('Text colour') as HTMLInputElement
      expect(colour.type).toBe('color')

      editor.commands.setContent('<p>word</p>')
      editor.commands.setTextSelection({ from: 1, to: 5 })
      editor.commands.setColor('#1a4d8f')
      expect(JSON.stringify(editor.getJSON())).toContain('"color":"#1a4d8f"')
      expect(isEmailColour('#1a4d8f')).toBe(true)
    })

    /**
     * The guards the stored values pass through. Both are enforced by
     * `record_task_action()` too — this holds the client's copy of the same
     * rules, so a refusal costs no round trip.
     */
    test('the guards refuse what the database refuses', async () => {
      await mount()
      for (const bad of ['rgb(255,0,0)', '#f00', 'currentColor', 'red;background:url(http://e/x)', '']) {
        expect(isEmailColour(bad)).toBe(false)
      }
      expect(isEmailFont('Comic Sans MS, cursive')).toBe(false)
      expect(isEmailFont('Georgia, serif')).toBe(true)
    })

    /** No quotes in any stack — that is what keeps the database's check a plain string compare. */
    test('no font stack carries a quote', async () => {
      for (const stack of EMAIL_FONT_STACKS) {
        expect(stack).not.toMatch(/['"]/)
      }
    })
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
    // The font and colour controls are a select and a colour input, not
    // toolbar buttons — so they are not in that list.
    expect(screen.getByRole('combobox', { name: 'Font' })).toBeTruthy()
    expect(screen.getByLabelText('Text colour')).toBeTruthy()
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
