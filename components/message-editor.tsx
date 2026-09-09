'use client'

import { useState } from 'react'
import { EditorContent, useEditor, useEditorState, type Editor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { Color, FontFamily, TextStyle } from '@tiptap/extension-text-style'
import { EMAIL_FONTS, EMAIL_HEADING_LEVELS } from '@/lib/workflow-board'
import { Divider, LinkGlyph, LinkRow, Tool, messageHeading } from './rich-text'

/**
 * The box a message is written in — an email body today.
 *
 * **Deliberately not `PostComposer`.** It shares that composer's fiddly parts
 * through `rich-text.tsx` — the mousedown toolbar button, the link row's
 * http(s) rule, the h4-painting heading — but not its schema, because the two
 * documents are not the same kind of thing:
 *
 *  - a post may name a colleague with `@`, a client with `#`, and carry
 *    pictures and files it has claimed from `workflow_post_media`;
 *  - a message may do none of that, and `record_task_action()` refuses all
 *    four node types by name.
 *
 * So this editor is configured to exactly `EMAIL_NODE_TYPES`, and a test holds
 * the two together in both directions. As always the DATABASE is the gate and
 * the editor is the convenience — the editor being narrower is what stops a
 * writer composing something that would only be refused on Send.
 *
 * It has no Send button of its own. The modal around it owns that, because
 * Send belongs at the bottom of the form rather than in the middle of it.
 */
export function MessageEditor({
  onReady,
  ariaLabel = 'Message',
  size = 'compact',
}: {
  /** For tests, which cannot type into ProseMirror the way a person does. */
  onReady?: (editor: Editor) => void
  ariaLabel?: string
  /**
   * How much body to show at rest. `tall` is for an email, where the content
   * is what the writer is actually there to do and a box the depth of a
   * comment makes a two-paragraph message feel like it is being squeezed
   * through a slot.
   *
   * Discrete rather than a number, because Tailwind scans source text: a
   * constructed `min-h-[${n}rem]` would never be generated.
   */
  size?: 'compact' | 'tall'
}) {
  const [linkOpen, setLinkOpen] = useState(false)

  const editor = useEditor({
    // Rendered on the client after mount; nothing to serialise on the server.
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({
        heading: false,
        link: { openOnClick: false, autolink: true, defaultProtocol: 'https' },
      }),
      messageHeading(EMAIL_HEADING_LEVELS).configure({ levels: [...EMAIL_HEADING_LEVELS] }),
      /* One mark, `textStyle`, carrying both attributes — which is why adding
         a font selector and a colour picker was one migration rather than two.
         Color and FontFamily are commands over that mark, not marks of their
         own. */
      TextStyle,
      FontFamily,
      Color,
    ],
    editorProps: {
      attributes: {
        /* The same prose class the feed uses, so a message reads the way a
           post does — one stylesheet, and a heading is already painted at h4
           there rather than competing with the page's own outline. */
        class: `qw-post ${MIN_HEIGHT[size]} px-3 py-2 text-sm leading-relaxed text-neutral-900 outline-none`,
        'aria-label': ariaLabel,
      },
    },
    onCreate: ({ editor: created }) => onReady?.(created),
  })

  /* Re-render on what the toolbar shows, and nothing else. */
  const state = useEditorState({
    editor,
    selector: (ctx) => {
      const e = ctx.editor
      return {
        bold: e?.isActive('bold') ?? false,
        italic: e?.isActive('italic') ?? false,
        underline: e?.isActive('underline') ?? false,
        strike: e?.isActive('strike') ?? false,
        code: e?.isActive('code') ?? false,
        heading: (EMAIL_HEADING_LEVELS.find((l) => e?.isActive('heading', { level: l })) ?? 0) as 0 | 1,
        bullets: e?.isActive('bulletList') ?? false,
        numbers: e?.isActive('orderedList') ?? false,
        quote: e?.isActive('blockquote') ?? false,
        codeBlock: e?.isActive('codeBlock') ?? false,
        link: e?.isActive('link') ?? false,
        /* The stack and the hex as they stand at the caret, so the two
           controls show what the selection actually is rather than what was
           last picked. */
        font: (e?.getAttributes('textStyle').fontFamily as string | undefined) ?? '',
        colour: (e?.getAttributes('textStyle').color as string | undefined) ?? '',
      }
    },
  }) ?? IDLE

  const run = (f: (e: Editor) => boolean) => {
    if (editor) f(editor)
  }

  return (
    /* The same shell as the feed's composer: rounded-lg on a neutral-200
       border, so two rich-text boxes in one app are one object. */
    <div className="rounded-lg border border-neutral-200 bg-white transition-colors focus-within:border-brand-300 focus-within:ring-2 focus-within:ring-brand/15">
      {/* The toolbar sits ABOVE the words, for the reason the feed's does:
          sharing a row with a button is what made that one wrap at every
          width. Eleven controls here, and no Image or Attach file — an email's
          attachments are not post media, and offering a button that could only
          claim the wrong thing is worse than not offering one. */}
      <div
        role="toolbar"
        aria-label="Formatting"
        className="flex flex-wrap items-center gap-0.5 border-b border-neutral-100 px-2 py-1.5"
      >
        <Tool label="Bold" on={state.bold} onClick={() => run((e) => e.chain().focus().toggleBold().run())}>
          <span className="font-bold">B</span>
        </Tool>
        <Tool label="Italic" on={state.italic} onClick={() => run((e) => e.chain().focus().toggleItalic().run())}>
          <span className="italic">I</span>
        </Tool>
        <Tool label="Underline" on={state.underline} onClick={() => run((e) => e.chain().focus().toggleUnderline().run())}>
          <span className="underline">U</span>
        </Tool>
        <Tool label="Strikethrough" on={state.strike} onClick={() => run((e) => e.chain().focus().toggleStrike().run())}>
          <span className="line-through">S</span>
        </Tool>
        <Tool label="Inline code" on={state.code} onClick={() => run((e) => e.chain().focus().toggleCode().run())}>
          <span className="font-mono text-[11px]">{'<>'}</span>
        </Tool>
        <Divider />
        {/* Named from the set, not hard-coded: with one level the button is
            "Heading", because "Heading 1" would imply a Heading 2 exists. */}
        {EMAIL_HEADING_LEVELS.map((level) => (
          <Tool
            key={level}
            label={EMAIL_HEADING_LEVELS.length > 1 ? `Heading ${level}` : 'Heading'}
            on={state.heading === level}
            onClick={() => run((e) => e.chain().focus().toggleHeading({ level }).run())}
          >
            <span className="text-[11px] font-semibold">
              {EMAIL_HEADING_LEVELS.length > 1 ? `H${level}` : 'H'}
            </span>
          </Tool>
        ))}
        <Divider />
        <Tool label="Bulleted list" on={state.bullets} onClick={() => run((e) => e.chain().focus().toggleBulletList().run())}>
          <span aria-hidden>•≡</span>
        </Tool>
        <Tool label="Numbered list" on={state.numbers} onClick={() => run((e) => e.chain().focus().toggleOrderedList().run())}>
          <span aria-hidden>1≡</span>
        </Tool>
        <Tool label="Quote" on={state.quote} onClick={() => run((e) => e.chain().focus().toggleBlockquote().run())}>
          <span aria-hidden className="text-base leading-none">❝</span>
        </Tool>
        <Tool label="Code block" on={state.codeBlock} onClick={() => run((e) => e.chain().focus().toggleCodeBlock().run())}>
          <span className="font-mono text-[11px]">{'{ }'}</span>
        </Tool>
        <Divider />
        <Tool label="Link" on={state.link || linkOpen} onClick={() => setLinkOpen((o) => !o)}>
          <LinkGlyph />
        </Tool>
        <Divider />

        {/* A CLOSED list, because a font the recipient's mail client lacks
            falls back to something nobody chose. Each option is shown IN its
            own face, so the list is a sample rather than a set of names. */}
        <label className="sr-only" htmlFor="qw-message-font">
          Font
        </label>
        <select
          id="qw-message-font"
          value={state.font}
          /* Mousedown would fight the native select; a change is not a command
             that needs the selection kept, because the browser restores it. */
          onChange={(e) => {
            const stack = e.target.value
            if (!editor) return
            if (stack) editor.chain().focus().setFontFamily(stack).run()
            else editor.chain().focus().unsetFontFamily().run()
          }}
          className="h-7 max-w-[7.5rem] rounded border-0 bg-transparent px-1 text-xs text-neutral-600 outline-none hover:bg-neutral-100 focus-visible:ring-2 focus-visible:ring-brand/30"
        >
          {EMAIL_FONTS.map((f) => (
            <option key={f.label} value={f.stack ?? ''} style={f.stack ? { fontFamily: f.stack } : undefined}>
              {f.label}
            </option>
          ))}
        </select>

        {/* FREE, and the one colour this schema stores rather than keys — see
            the constant. A native input, so the value is always #rrggbb and
            the gate's check is a shape rather than a list. */}
        <label className="sr-only" htmlFor="qw-message-colour">
          Text colour
        </label>
        <span className="flex items-center gap-1">
          <input
            id="qw-message-colour"
            type="color"
            value={state.colour || '#171717'}
            onChange={(e) => editor?.chain().focus().setColor(e.target.value).run()}
            title="Text colour"
            className="h-6 w-6 cursor-pointer rounded border border-neutral-300 bg-white p-0.5"
          />
          {/* Only offered once there is something to clear, so the toolbar does
              not carry a permanently dead control. */}
          {state.colour ? (
            <Tool
              label="Clear text colour"
              on={false}
              onClick={() => editor?.chain().focus().unsetColor().run()}
            >
              <span aria-hidden className="text-[11px]">✕</span>
            </Tool>
          ) : null}
        </span>
      </div>

      {linkOpen && editor ? <LinkRow editor={editor} onDone={() => setLinkOpen(false)} /> : null}

      <EditorContent editor={editor} />
    </div>
  )
}

/* At 14px on `leading-relaxed` a line is about 22.75px, and the box carries
   8px of padding top and bottom — so 7rem is roughly four lines and 15rem is
   roughly ten. `tall` is the taller of the two by five and a half lines. */
const MIN_HEIGHT: Record<'compact' | 'tall', string> = {
  compact: 'min-h-[7rem]',
  tall: 'min-h-[15rem]',
}

/* What the toolbar shows before the editor exists. */
const IDLE = {
  bold: false,
  italic: false,
  underline: false,
  strike: false,
  code: false,
  heading: 0 as 0 | 1,
  bullets: false,
  numbers: false,
  quote: false,
  codeBlock: false,
  link: false,
  font: '',
  colour: '',
}
