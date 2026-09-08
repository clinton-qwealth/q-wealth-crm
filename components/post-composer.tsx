'use client'

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { EditorContent, ReactRenderer, useEditor, useEditorState } from '@tiptap/react'
import type { Editor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Mention from '@tiptap/extension-mention'
import type { SuggestionKeyDownProps, SuggestionProps } from '@tiptap/suggestion'
import type { PostDoc } from '@/lib/workflow-board'

type Staff = { id: string; name: string }

/**
 * The box a post is written in.
 *
 * TipTap — ProseMirror — rather than a hand-rolled contenteditable, because a
 * rich-text editor is a well-known trap and this one produces exactly the
 * document the database stores. It is configured down to the nodes and marks
 * the schema allows: no headings, quotes, code blocks or rules, so the editor
 * cannot produce what `post_workflow_activity()` would refuse.
 *
 * `@` opens a list of colleagues; choosing one inserts a mention node carrying
 * the person's id and name. The id is what the database records and resolves;
 * the name is what was typed, kept so the document reads on its own.
 *
 * The composer does not post. It hands the document to `onPost` and clears
 * itself only when told the post was accepted — so a refusal never costs the
 * writer their words.
 */
export function PostComposer({
  staff,
  onPost,
  onReady,
}: {
  staff: Staff[]
  /** Return true if the post was accepted, so the editor clears. */
  onPost: (doc: PostDoc) => Promise<boolean>
  /** For tests, which cannot type into ProseMirror the way a person does. */
  onReady?: (editor: Editor) => void
}) {
  const [posting, setPosting] = useState(false)
  const [suggestion, setSuggestion] = useState<{ props: SuggestionProps<Staff>; rect: DOMRect | null } | null>(null)
  /* The @ menu is positioned against this, not the viewport. The panel this
     composer lives in is a <dialog> that slides in with a transform, and a
     transformed ancestor makes `position: fixed` behave as `absolute` relative
     to itself — the first menu rendered 300px off the right of the screen. */
  const frameRef = useRef<HTMLDivElement>(null)

  const editor = useEditor({
    // Rendered on the client after mount; nothing to serialise on the server.
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({
        heading: false,
        blockquote: false,
        codeBlock: false,
        horizontalRule: false,
        underline: false,
        link: { openOnClick: false, autolink: true, defaultProtocol: 'https' },
      }),
      Mention.configure({
        HTMLAttributes: { class: 'rounded bg-brand-50 px-1 font-medium text-brand-700' },
        renderText: ({ node }) => `@${node.attrs.label ?? node.attrs.id}`,
        deleteTriggerWithBackspace: true,
        suggestion: {
          char: '@',
          items: ({ query }) =>
            staff.filter((s) => s.name.toLowerCase().includes(query.toLowerCase())).slice(0, 6),
          render: () => {
            let component: ReactRenderer<MentionListHandle, MentionListProps> | null = null
            return {
              onStart: (props) => {
                component = new ReactRenderer(MentionList, { props, editor: props.editor })
                setSuggestion({ props, rect: props.clientRect?.() ?? null })
              },
              onUpdate: (props) => {
                component?.updateProps(props)
                setSuggestion({ props, rect: props.clientRect?.() ?? null })
              },
              onKeyDown: (props) => {
                if (props.event.key === 'Escape') {
                  setSuggestion(null)
                  return true
                }
                return component?.ref?.onKeyDown(props) ?? false
              },
              onExit: () => {
                component?.destroy()
                component = null
                setSuggestion(null)
              },
            }
          },
        },
      }),
    ],
    editorProps: {
      attributes: {
        class: 'qw-post min-h-[4.5rem] px-3 py-2 text-sm leading-relaxed text-neutral-900 outline-none',
        'aria-label': 'Write a post',
      },
    },
  })

  useEffect(() => {
    if (editor && onReady) onReady(editor)
  }, [editor, onReady])

  /* Re-render on what the toolbar shows, and nothing else. */
  const state = useEditorState({
    editor,
    selector: (ctx) => ({
      empty: ctx.editor?.isEmpty ?? true,
      bold: ctx.editor?.isActive('bold') ?? false,
      italic: ctx.editor?.isActive('italic') ?? false,
      bullets: ctx.editor?.isActive('bulletList') ?? false,
      numbers: ctx.editor?.isActive('orderedList') ?? false,
    }),
  }) ?? { empty: true, bold: false, italic: false, bullets: false, numbers: false }

  async function post() {
    if (!editor || state.empty || posting) return
    setPosting(true)
    try {
      /* Through JSON and back, on purpose. ProseMirror builds a node's `attrs`
         with Object.create(null), and React's Server Action serialiser turns
         a null-prototype object into an opaque "temporary client reference"
         rather than data — the server then throws the moment it reads
         `attrs.label`. Caught in a browser, not by any test: jsdom has no
         server boundary to cross. A round trip through JSON gives every object
         an ordinary prototype and hands the action what it can read. */
      const doc = JSON.parse(JSON.stringify(editor.getJSON())) as PostDoc
      const ok = await onPost(doc)
      if (ok) editor.commands.clearContent(true)
    } finally {
      setPosting(false)
    }
  }

  return (
    <div className="rounded-md border border-neutral-300 bg-white transition-colors focus-within:border-brand-300 focus-within:ring-2 focus-within:ring-brand/15">
      <div ref={frameRef} className="relative">
        {/* The editor is a client-only thing; until it mounts, the box is a
            box. Once it has, an empty document shows the placeholder. */}
        {editor && state.empty ? (
          <span
            aria-hidden
            className="pointer-events-none absolute left-3 top-2 text-sm text-neutral-400"
          >
            Write an update. Use @ to mention a colleague.
          </span>
        ) : null}
        <EditorContent editor={editor} />
        {suggestion && suggestion.rect && frameRef.current ? (
          <MentionMenu
            items={suggestion.props.items}
            caret={suggestion.rect}
            frame={frameRef.current.getBoundingClientRect()}
            onPick={(s) => suggestion.props.command({ id: s.id, label: s.name })}
          />
        ) : null}
      </div>

      <div className="flex items-center justify-between gap-2 border-t border-neutral-100 px-2 py-1.5">
        <div className="flex items-center gap-0.5" role="toolbar" aria-label="Formatting">
          <Tool label="Bold" on={state.bold} onClick={() => editor?.chain().focus().toggleBold().run()}>
            <span className="font-bold">B</span>
          </Tool>
          <Tool label="Italic" on={state.italic} onClick={() => editor?.chain().focus().toggleItalic().run()}>
            <span className="italic">I</span>
          </Tool>
          <Tool label="Bulleted list" on={state.bullets} onClick={() => editor?.chain().focus().toggleBulletList().run()}>
            <span aria-hidden>•≡</span>
          </Tool>
          <Tool label="Numbered list" on={state.numbers} onClick={() => editor?.chain().focus().toggleOrderedList().run()}>
            <span aria-hidden>1≡</span>
          </Tool>
        </div>
        <button
          type="button"
          onClick={post}
          disabled={!editor || state.empty || posting}
          className="rounded-md bg-brand px-3 py-1 text-xs font-medium text-white outline-none transition-colors hover:bg-brand-600 disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-brand/40"
        >
          {posting ? 'Posting…' : 'Post'}
        </button>
      </div>
    </div>
  )
}

function Tool({
  label,
  on,
  onClick,
  children,
}: {
  label: string
  on: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={on}
      title={label}
      // Mousedown, not click: a click would blur the editor first and lose
      // the selection the command applies to.
      onMouseDown={(e) => {
        e.preventDefault()
        onClick()
      }}
      className={`flex h-7 min-w-7 items-center justify-center rounded px-1.5 text-xs outline-none transition-colors focus-visible:ring-2 focus-visible:ring-brand/30 ${
        on ? 'bg-neutral-200 text-neutral-900' : 'text-neutral-600 hover:bg-neutral-100 hover:text-neutral-900'
      }`}
    >
      {children}
    </button>
  )
}

/* ---- the @ menu ------------------------------------------------------ */

type MentionListProps = SuggestionProps<Staff>
type MentionListHandle = { onKeyDown: (p: SuggestionKeyDownProps) => boolean }

/**
 * Keyboard handling for the suggestion list lives here, on an instance TipTap
 * holds; the visible menu is `MentionMenu`, rendered by React from state so it
 * stays inside the component tree and its styling. The two share `props`.
 */
const MentionList = forwardRef<MentionListHandle, MentionListProps>(function MentionList(props, ref) {
  const [index, setIndex] = useState(0)
  /* Back to the first item whenever the list changes — adjusted during render,
     not in an effect, the same way useServerState re-seeds: an effect would
     paint one frame with the old index pointing past the end of a shorter list. */
  const [seenItems, setSeenItems] = useState(props.items)
  if (seenItems !== props.items) {
    setSeenItems(props.items)
    setIndex(0)
  }

  useImperativeHandle(ref, () => ({
    onKeyDown: ({ event }) => {
      if (event.key === 'ArrowDown') {
        setIndex((i) => (i + 1) % Math.max(props.items.length, 1))
        return true
      }
      if (event.key === 'ArrowUp') {
        setIndex((i) => (i - 1 + props.items.length) % Math.max(props.items.length, 1))
        return true
      }
      if (event.key === 'Enter' || event.key === 'Tab') {
        const item = props.items[index]
        if (item) props.command({ id: item.id, label: item.name })
        return true
      }
      return false
    },
  }))

  // Nothing drawn here; MentionMenu draws from the same props.
  return null
})

function MentionMenu({
  items,
  caret,
  frame,
  onPick,
}: {
  items: Staff[]
  /** Where the @ is, in viewport coordinates. */
  caret: DOMRect
  /** The composer's own box, so the menu is placed relative to it. */
  frame: DOMRect
  onPick: (s: Staff) => void
}) {
  return (
    <ul
      role="listbox"
      aria-label="Mention a colleague"
      style={{ position: 'absolute', left: caret.left - frame.left, top: caret.bottom - frame.top + 4 }}
      className="z-30 w-56 overflow-hidden rounded-lg border border-neutral-200 bg-white p-1 shadow-[0_1px_2px_rgb(0_0_0/0.05),0_8px_24px_-12px_rgb(0_0_0/0.18)]"
    >
      {items.length ? (
        items.map((s) => (
          <li key={s.id} role="option" aria-selected={false}>
            <button
              type="button"
              onMouseDown={(e) => {
                e.preventDefault()
                onPick(s)
              }}
              className="flex w-full items-center rounded-md px-2 py-1.5 text-left text-sm text-neutral-800 outline-none hover:bg-neutral-100"
            >
              {s.name}
            </button>
          </li>
        ))
      ) : (
        <li className="px-2 py-1.5 text-xs text-neutral-400">No one matches</li>
      )}
    </ul>
  )
}
