import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import React from 'react'
import type { Editor } from '@tiptap/react'
import { PostComposer, type PostUploader } from '@/components/post-composer'
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
async function mount(onPost = vi.fn<OnPost>(async () => true), uploader?: PostUploader) {
  let editor: Editor | null = null
  render(<PostComposer staff={STAFF} onPost={onPost} onReady={(e) => (editor = e)} uploader={uploader} />)
  await waitFor(() => expect(editor).not.toBeNull())
  return { editor: editor!, onPost }
}

const postButton = () => screen.getByRole<HTMLButtonElement>('button', { name: 'Post' })

/**
 * Choosing a file, as the toolbar's first hidden input receives it.
 *
 * Neither input carries a label, on purpose — they are not controls anyone
 * should find by name — so they are reached through the DOM rather than by
 * role. Both share one handler, so driving the first is enough to exercise
 * the path; which chooser opened it only decides what the OS dialog offers.
 */
async function addFile(
  _editor: Editor,
  file = new File(['bytes'], 'shot.png', { type: 'image/png' }),
) {
  const input = document.querySelector('input[type="file"]') as HTMLInputElement
  Object.defineProperty(input, 'files', { value: [file], configurable: true })
  fireEvent.change(input)
  // Let the reserve/insert/send chain get going before anything is asserted.
  await Promise.resolve()
}

describe('the post composer', () => {
  test('starts empty, with a placeholder and Post disabled', async () => {
    await mount()
    expect(screen.getByText(/@ a colleague, # a client, : an emoji/)).toBeTruthy()
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
   *
   * `image` is on the list as of 8 September; `table`, `iframe` and `taskList`
   * are not, and the point of this test is that adding one to the editor
   * without adding it to the database's whitelist fails here rather than in a
   * refusal after somebody has written a post.
   */
  test('the schema is exactly what the database allows: every node and mark, and nothing else', async () => {
    const { editor } = await mount()
    const nodes = Object.keys(editor.schema.nodes).sort()
    const marks = Object.keys(editor.schema.marks).sort()
    expect(nodes).toEqual([...POST_NODE_TYPES].sort())
    expect(marks).toEqual([...POST_MARK_TYPES].sort())
    for (const banned of ['table', 'iframe', 'taskList']) expect(nodes).not.toContain(banned)
  })

  /**
   * A callout wraps what you have already written rather than inserting an
   * empty box, and the same button unwraps it — which is what its pressed
   * state promises. The tone is a KEY from a closed set; a colour never
   * reaches the document.
   */
  test('the Callout button wraps the selection, toggles off again, and carries a tone key', async () => {
    const user = userEvent.setup()
    const { editor } = await mount()
    editor.commands.setContent('<p>Check the TFN before lodging</p>')
    editor.commands.setTextSelection({ from: 1, to: 6 })

    await user.click(screen.getByRole('button', { name: 'Callout' }))
    const wrapped = editor.getJSON().content![0]
    expect(wrapped).toMatchObject({ type: 'callout', attrs: { tone: 'info' } })
    // The words are still there, inside it.
    expect(editor.getText()).toContain('Check the TFN before lodging')
    expect(JSON.stringify(wrapped)).not.toMatch(/#[0-9a-f]{3,6}|rgb\(/i)
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Callout' }).getAttribute('aria-pressed')).toBe('true'),
    )

    await user.click(screen.getByRole('button', { name: 'Callout' }))
    expect(editor.getJSON().content![0].type).toBe('paragraph')
  })

  /**
   * Reported from use on 8 September: inserting a callout into an empty
   * composer left the placeholder sitting on top of it.
   *
   * The cause is that `editor.isEmpty` asks about TEXT, so a block that wraps
   * text but has none yet — a callout, a quote, a code block — still reports
   * empty. The placeholder now asks a structural question instead, and Post
   * keeps asking the text one. Both halves are asserted here, because the fix
   * is only correct if they stay different: a wordless callout must hide the
   * placeholder AND keep Post disabled, since the database refuses a post with
   * no words in it.
   */
  test('inserting a wordless block hides the placeholder but leaves Post disabled', async () => {
    const user = userEvent.setup()
    const { editor } = await mount()
    const placeholder = () => screen.queryByText(/@ a colleague, # a client/)

    expect(placeholder()).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Callout' }))

    // The reported bug: this used to still be on screen, over the callout.
    await waitFor(() => expect(placeholder()).toBeNull())
    // And the other half: nothing worth posting yet.
    expect(editor.isEmpty).toBe(true)
    expect(postButton().disabled).toBe(true)

    editor.commands.insertContent('Check the TFN')
    await waitFor(() => expect(postButton().disabled).toBe(false))
    expect(placeholder()).toBeNull()
  })

  test('a quote and a code block behave the same way, and clearing brings the placeholder back', async () => {
    const { editor } = await mount()
    const placeholder = () => screen.queryByText(/@ a colleague, # a client/)

    for (const doc of [
      { type: 'doc', content: [{ type: 'blockquote', content: [{ type: 'paragraph' }] }] },
      { type: 'doc', content: [{ type: 'codeBlock' }] },
    ]) {
      editor.commands.setContent(doc as never)
      await waitFor(() => expect(placeholder()).toBeNull())
      expect(editor.isEmpty).toBe(true)
    }

    editor.commands.clearContent(true)
    await waitFor(() => expect(placeholder()).toBeTruthy())
  })

  test('a callout’s tone can be changed from inside it, to one of three', async () => {
    const { editor } = await mount()
    editor.commands.setContent({
      type: 'doc',
      content: [
        { type: 'callout', attrs: { tone: 'info' }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Careful' }] }] },
      ],
    })
    editor.commands.setTextSelection(2)

    /* `findByRole`, not `getByRole`: a node view is rendered by ProseMirror
       through a React portal, which lands after setContent returns. */
    for (const label of ['Note', 'Careful', 'Settled']) {
      expect(await screen.findByRole('button', { name: `Callout tone: ${label}` })).toBeTruthy()
    }
    fireEvent.mouseDown(screen.getByRole('button', { name: 'Callout tone: Careful' }))
    expect(editor.getJSON().content![0].attrs!.tone).toBe('warning')
  })

  /** An unqualified `div` in parseHTML would turn every pasted page wrapper into a callout. */
  test('a pasted div is not a callout; only our own marker is', async () => {
    const { editor } = await mount()
    editor.commands.setContent('<div class="wrapper"><p>ordinary pasted markup</p></div>')
    expect(JSON.stringify(editor.getJSON())).not.toContain('callout')

    editor.commands.setContent('<div data-callout data-tone="warning"><p>mind this</p></div>')
    expect(editor.getJSON().content![0]).toMatchObject({ type: 'callout', attrs: { tone: 'warning' } })

    // A tone the database would refuse never enters the document.
    editor.commands.setContent('<div data-callout data-tone="chartreuse"><p>x</p></div>')
    expect(editor.getJSON().content![0].attrs!.tone).toBe('info')
  })

  /**
   * Narrowed from three levels to one on 8 September. A post is a paragraph or
   * two about a piece of work; three sizes of emphasis were being chosen
   * arbitrarily rather than structurally.
   */
  test('a post has one heading size — the editor cannot make a level 2, 3 or 4', async () => {
    const { editor } = await mount()
    editor.commands.setContent('<p>word</p>')
    expect(editor.can().setHeading({ level: 1 })).toBe(true)
    for (const level of [2, 3, 4]) {
      expect(editor.can().setHeading({ level: level as never })).toBe(false)
    }
  })

  /**
   * The composer sits under the panel's h2 and its boxes' h3. A heading being
   * typed must not paint an h1 into that outline, so the editor draws its one
   * level as an h4 — the same tag the feed draws it with — and parses both an
   * h1 and an h4 back, so copying within the editor keeps a heading a heading.
   */
  test('a heading in the editor is painted as h4, never h1, and both parse back', async () => {
    const { editor } = await mount()
    editor.commands.setContent('<p>word</p>')
    editor.commands.setTextSelection({ from: 1, to: 5 })
    editor.commands.setHeading({ level: 1 })
    expect(editor.view.dom.querySelector('h4')?.textContent).toBe('word')
    expect(editor.view.dom.querySelector('h1, h2, h3')).toBeNull()

    // Both tags the level is written as come back as the level.
    editor.commands.setContent('<h4>four</h4><h1>one</h1>')
    // The trailing empty paragraph is StarterKit's TrailingNode, not a heading.
    const headings = editor.getJSON().content!.filter((n) => n.type === 'heading')
    expect(headings.map((n) => n.attrs?.level)).toEqual([1, 1])

    // A level the post no longer has is not a heading at all — a pasted h2
    // becomes ordinary text rather than silently becoming level 1.
    editor.commands.setContent('<h2>two</h2>')
    expect(editor.getJSON().content!.filter((n) => n.type === 'heading')).toEqual([])
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
    await user.click(screen.getByRole('button', { name: 'Heading' }))
    expect(editor.getJSON().content![0]).toMatchObject({ type: 'heading', attrs: { level: 1 } })
    await waitFor(() => expect(screen.getByRole('button', { name: 'Heading' }).getAttribute('aria-pressed')).toBe('true'))
    await user.click(screen.getByRole('button', { name: 'Quote' }))
    expect(editor.getJSON().content![0].type).toBe('blockquote')
  })

  test('the toolbar offers everything StarterKit ships, and Undo is disabled until there is something to undo', async () => {
    const { editor } = await mount()
    const toolbar = screen.getByRole('toolbar', { name: 'Formatting' })
    const labels = within(toolbar).getAllByRole('button').map((b) => b.getAttribute('aria-label'))
    expect(labels).toEqual([
      'Bold', 'Italic', 'Underline', 'Strikethrough', 'Inline code',
      'Heading',
      'Bulleted list', 'Numbered list', 'Quote', 'Code block', 'Horizontal rule', 'Callout',
      'Image', 'Attach file',
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

  /**
   * The third suggestion list, on the same machinery as `@` and `:`.
   *
   * The candidates are handed in rather than searched for, and that is the
   * point: the set is exactly what post_workflow_activity() will accept, so
   * the menu cannot offer a client the database is going to refuse — nor
   * become the only thing standing between a chip and a name reaching people
   * with no right to it.
   */
  test('# opens the list of things a post may name; choosing one inserts a chip with kind and id', async () => {
    const entities = [
      { kind: 'group' as const, id: '11111111-1111-4111-8111-111111111111', label: 'Testsmith Household' },
      { kind: 'client' as const, id: '22222222-2222-4222-8222-222222222222', label: 'Jane Testsmith' },
    ]
    let editor: Editor | null = null
    render(
      <PostComposer
        staff={STAFF}
        entities={entities}
        onPost={vi.fn<OnPost>(async () => true)}
        onReady={(e) => (editor = e)}
      />,
    )
    await waitFor(() => expect(editor).not.toBeNull())
    editor!.commands.insertContent('#Test')

    const list = await screen.findByRole('listbox', { name: 'Name a client, group or workflow' })
    const options = within(list).getAllByRole('option').map((o) => o.textContent)
    /* Both match: the filter is a substring of the whole label, so "Test"
       finds the household AND "Jane Testsmith". That is wanted — people
       search by surname — and it is why each row shows its kind. */
    expect(options.length).toBe(2)
    expect(options[0]).toContain('Testsmith Household')
    expect(options[0]).toContain('Group')
    expect(options[1]).toContain('Jane Testsmith')
    expect(options[1]).toContain('Client')

    fireEvent.mouseDown(within(list).getAllByRole('button')[0])
    const chip = editor!.getJSON().content![0].content!.find((n) => n.type === 'entity')! as {
      attrs?: Record<string, unknown>
    }
    expect(chip.attrs).toMatchObject({
      kind: 'group',
      id: '11111111-1111-4111-8111-111111111111',
      label: 'Testsmith Household',
    })
  })

  test('# with nothing to offer opens a list that says so', async () => {
    const { editor } = await mount()
    editor.commands.insertContent('#any')
    const list = await screen.findByRole('listbox', { name: 'Name a client, group or workflow' })
    expect(list.textContent).toContain('Nothing on this group matches')
  })

  /** A chip is a word in a sentence, so it must not break the line it sits in. */
  test('a chip is inline, and reads as #Label in the plain text', async () => {
    const { editor } = await mount()
    editor.commands.setContent({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'Spoke to ' },
            { type: 'entity', attrs: { kind: 'client', id: '22222222-2222-4222-8222-222222222222', label: 'Jane' } },
            { type: 'text', text: ' today' },
          ],
        },
      ],
    })
    expect(editor.getJSON().content![0].type).toBe('paragraph')
    expect(editor.getText()).toBe('Spoke to #Jane today')
  })

  test('a pasted span is not a chip unless it carries a real id and a known kind', async () => {
    const { editor } = await mount()
    editor.commands.setContent(
      '<p><span data-entity-chip data-entity-kind="client" data-entity-id="22222222-2222-4222-8222-222222222222" data-label="Jane">#Jane</span></p>',
    )
    expect(JSON.stringify(editor.getJSON())).toContain('"type":"entity"')

    editor.commands.setContent('<p><span data-entity-chip data-entity-kind="client" data-entity-id="nope">#x</span></p>')
    expect(JSON.stringify(editor.getJSON())).not.toContain('"type":"entity"')

    // A kind outside the closed set is not one of ours either.
    editor.commands.setContent(
      '<p><span data-entity-chip data-entity-kind="invoice" data-entity-id="22222222-2222-4222-8222-222222222222">#x</span></p>',
    )
    expect(JSON.stringify(editor.getJSON())).not.toContain('"type":"entity"')
  })

  test('a colon with fewer than two letters after it opens nothing', async () => {
    const { editor } = await mount()
    editor.commands.insertContent('Note:')
    editor.commands.insertContent(' :t')
    await new Promise((r) => setTimeout(r, 20))
    expect(screen.queryByRole('listbox')).toBeNull()
  })

  /**
   * Pictures.
   *
   * The invariant under test throughout is that a document may hold an
   * upload's ID and nothing that looks like an address, and that it never
   * names bytes which have not arrived.
   */
  describe('pictures', () => {
    /**
     * jsdom neither loads images nor hands out blob URLs, so both are stubbed:
     * without the first, `measure()` waits out its own 600ms cap in every test
     * here, and without the second there is no preview to show. The stub
     * reports a size, so the dimensions the composer passes to `reserve` are
     * exercised rather than skipped.
     */
    beforeEach(() => {
      vi.stubGlobal(
        'Image',
        class {
          naturalWidth = 800
          naturalHeight = 600
          onload: (() => void) | null = null
          onerror: (() => void) | null = null
          set src(_value: string) {
            queueMicrotask(() => this.onload?.())
          }
        },
      )
      URL.createObjectURL = vi.fn(() => 'blob:preview')
      URL.revokeObjectURL = vi.fn()
    })
    afterEach(() => vi.unstubAllGlobals())

    /**
     * Until an `image` node existed, a pasted `<img>` was dropped because the
     * schema had nothing to parse one into — the safety came for free. It does
     * not any more, so this is the test that a loose `parseHTML` cannot slip
     * in: an image from a web page, with a real address on it, must still
     * produce nothing.
     */
    test('an img with a src is not a picture — pasted markup produces no node', async () => {
      const { editor } = await mount()
      editor.commands.setContent(
        '<p>before</p><img src="https://evil.example/pixel.gif"><img src="data:image/gif;base64,R0lGOD"><p>after</p>',
      )
      const types = editor.getJSON().content!.map((n) => n.type)
      expect(types).not.toContain('image')
      expect(JSON.stringify(editor.getJSON())).not.toContain('evil.example')
      expect(JSON.stringify(editor.getJSON())).not.toContain('data:image')
    })

    /** Our own marker round-trips, so copying a picture within the editor keeps it. */
    test('our own marker parses back, but only when it carries a real id', async () => {
      const { editor } = await mount()
      editor.commands.setContent(
        '<img data-post-media="3f1a2b4c-5d6e-4f70-8901-23456789abcd" data-name="shot.png">',
      )
      expect(editor.getJSON().content![0]).toMatchObject({
        type: 'image',
        attrs: { id: '3f1a2b4c-5d6e-4f70-8901-23456789abcd', name: 'shot.png' },
      })

      editor.commands.setContent('<img data-post-media="not-an-id" data-name="shot.png">')
      expect(JSON.stringify(editor.getJSON())).not.toContain('image')
    })

    test('the Image and Attach file buttons are dead without an uploader', async () => {
      await mount()
      expect(screen.getByRole('button', { name: 'Image' }).getAttribute('aria-disabled')).toBe('true')
      expect(screen.getByRole('button', { name: 'Attach file' }).getAttribute('aria-disabled')).toBe('true')
    })

    /**
     * The two choosers offer different things on purpose: somebody looking for
     * a screenshot should not be shown every spreadsheet on the machine.
     */
    test('the Image chooser offers only pictures; Attach file offers everything a post may carry', async () => {
      await mount(vi.fn<OnPost>(async () => true), {
        reserve: vi.fn(async () => ({ id: 'x', path: 'y' })),
        send: vi.fn(async () => null),
      })
      const accepts = Array.from(document.querySelectorAll('input[type="file"]')).map((i) =>
        (i as HTMLInputElement).accept,
      )
      const images = accepts.find((a) => !a.includes('application/pdf'))!
      const everything = accepts.find((a) => a.includes('application/pdf'))!
      expect(images).toContain('image/png')
      expect(images).not.toContain('application/pdf')
      expect(everything).toContain('image/png')
      expect(everything).toContain('application/pdf')
      // Never, in either: both can carry script.
      for (const a of accepts) {
        expect(a).not.toContain('svg')
        expect(a).not.toContain('text/html')
      }
    })

    /**
     * A document is a chip, not a picture: no blob is made for it, so nothing
     * is drawn from the local file and no dimensions are measured.
     */
    test('a PDF becomes an attachment node, with no preview and no dimensions', async () => {
      const uploader = {
        reserve: vi.fn(async () => ({ id: '7c9e6679-7425-40de-944b-e07fc1f90ae7', path: 'w1/pdf' })),
        send: vi.fn(async () => null),
      }
      const { editor } = await mount(vi.fn<OnPost>(async () => true), uploader)

      await addFile(editor, new File(['%PDF'], 'statement.pdf', { type: 'application/pdf' }))

      await waitFor(() => expect(JSON.stringify(editor.getJSON())).toContain('7c9e6679'))
      const node = editor.getJSON().content!.find((n) => n.type === 'attachment')!
      // Only the two attributes, and neither of them an address.
      expect(Object.keys(node.attrs!).sort()).toEqual(['id', 'name'])
      expect(node.attrs!.name).toBe('statement.pdf')
      // Null dimensions: a PDF has no pixel size worth reserving.
      expect(uploader.reserve).toHaveBeenCalledWith(expect.anything(), null)
      expect(URL.createObjectURL).not.toHaveBeenCalled()
    })

    test('an attachment node carrying an address is not parsed back', async () => {
      const { editor } = await mount()
      editor.commands.setContent(
        '<span data-post-attachment data-post-media="7c9e6679-7425-40de-944b-e07fc1f90ae7" data-name="ok.pdf"></span>',
      )
      expect(editor.getJSON().content![0]).toMatchObject({
        type: 'attachment',
        attrs: { id: '7c9e6679-7425-40de-944b-e07fc1f90ae7', name: 'ok.pdf' },
      })

      // A bare anchor from a web page is not an attachment.
      editor.commands.setContent('<a href="https://evil.example/x.pdf">x.pdf</a>')
      expect(JSON.stringify(editor.getJSON())).not.toContain('attachment')
      editor.commands.setContent('<span data-post-attachment data-post-media="nope"></span>')
      expect(JSON.stringify(editor.getJSON())).not.toContain('attachment')
    })

    /**
     * The two steps the database requires, in order: the row is reserved
     * first, and only then may the bytes go to the path it named. The picture
     * appears BETWEEN them, so a slow upload is visible — and Post stays
     * disabled until the bytes land, because a document naming bytes that
     * never arrived is a post the database would refuse.
     */
    test('reserves, shows the picture, sends the bytes — and Post waits for them', async () => {
      let release: (v: null) => void = () => {}
      const uploader = {
        reserve: vi.fn(async () => ({ id: '3f1a2b4c-5d6e-4f70-8901-23456789abcd', path: 'w1/3f1a2b4c-5d6e-4f70-8901-23456789abcd' })),
        send: vi.fn(() => new Promise<null>((r) => { release = r })),
      }
      const { editor } = await mount(vi.fn<OnPost>(async () => true), uploader)

      void addFile(editor)

      // The picture is in the document while the bytes are still going.
      await waitFor(() => expect(JSON.stringify(editor.getJSON())).toContain('3f1a2b4c'))
      expect(uploader.reserve).toHaveBeenCalledTimes(1)
      // The picture's own pixel size goes with the reservation, so the feed can
      // reserve its shape and not jump as it loads.
      expect(uploader.reserve).toHaveBeenCalledWith(expect.anything(), { width: 800, height: 600 })
      await waitFor(() => expect(screen.getByRole('status').textContent).toContain('Adding a file'))
      expect(postButton().disabled).toBe(true)
      expect(uploader.send).toHaveBeenCalledWith('w1/3f1a2b4c-5d6e-4f70-8901-23456789abcd', expect.anything())

      release(null)
      await waitFor(() => expect(postButton().disabled).toBe(false))
      expect(screen.queryByRole('status')).toBeNull()
      // The node carries the id and no address of any kind.
      const node = editor.getJSON().content!.find((n) => n.type === 'image')!
      expect(Object.keys(node.attrs!).sort()).toEqual(['alt', 'id', 'name', 'width'])
    })

    /**
     * A failed upload takes its node back out. Leaving it in would only move
     * the failure to the moment somebody pressed Post, and the writer would
     * lose the picture either way — but this way they keep their words and are
     * told why.
     */
    test('bytes that do not arrive take the picture back out, and say so', async () => {
      const uploader = {
        reserve: vi.fn(async () => ({ id: '3f1a2b4c-5d6e-4f70-8901-23456789abcd', path: 'w1/x' })),
        send: vi.fn(async () => ({ error: 'The network gave up.' })),
      }
      const { editor } = await mount(vi.fn<OnPost>(async () => true), uploader)
      editor.commands.setContent('<p>Keep me</p>')

      await addFile(editor)

      await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('The network gave up.'))
      expect(JSON.stringify(editor.getJSON())).not.toContain('3f1a2b4c')
      expect(editor.getText()).toContain('Keep me')
    })

    test('a refused reservation never puts a picture in the document', async () => {
      const uploader = {
        reserve: vi.fn(async () => ({ error: 'That file is larger than the 10 MB limit.' })),
        send: vi.fn(async () => null),
      }
      const { editor } = await mount(vi.fn<OnPost>(async () => true), uploader)

      await addFile(editor)

      await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('10 MB limit'))
      expect(uploader.send).not.toHaveBeenCalled()
      expect(JSON.stringify(editor.getJSON())).not.toContain('image')
    })

    /** The client's copy of the bucket's type list, so a refusal costs no round trip. */
    test('a kind of file a post cannot carry is refused without asking the server', async () => {
      const uploader = {
        reserve: vi.fn(async () => ({ id: 'x', path: 'y' })),
        send: vi.fn(async () => null),
      }
      const { editor } = await mount(vi.fn<OnPost>(async () => true), uploader)

      await addFile(editor, new File(['<svg/>'], 'logo.svg', { type: 'image/svg+xml' }))

      await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('logo.svg'))
      expect(uploader.reserve).not.toHaveBeenCalled()
    })
  })
})
