'use client'

import { useEffect, useRef, useState, type ReactNode } from 'react'
import { EditorContent, useEditor, useEditorState } from '@tiptap/react'
import type { Editor } from '@tiptap/react'
import { Extension, mergeAttributes, type ChainedCommands } from '@tiptap/core'
import { PluginKey } from '@tiptap/pm/state'
import StarterKit from '@tiptap/starter-kit'
import Heading from '@tiptap/extension-heading'
import Mention from '@tiptap/extension-mention'
import Suggestion, { type SuggestionOptions, type SuggestionProps } from '@tiptap/suggestion'
import { POST_HEADING_LEVELS, type PostDoc } from '@/lib/workflow-board'
import { searchEmoji, type Emoji } from '@/lib/emoji'

type Staff = { id: string; name: string }

/**
 * The box a post is written in.
 *
 * TipTap — ProseMirror — rather than a hand-rolled contenteditable, because a
 * rich-text editor is a well-known trap and this one produces exactly the
 * document the database stores. Everything StarterKit ships is switched on,
 * and configured to what the schema allows: headings at three levels and no
 * more, links with http(s) only. Nothing else is added, so the editor cannot
 * produce a node `post_workflow_activity()` would refuse — and a test holds
 * the editor's schema to the same list the database enforces.
 *
 * `@` opens a list of colleagues; choosing one inserts a mention node carrying
 * the person's id and name. `:` followed by two letters opens a list of emoji;
 * choosing one inserts the CHARACTER into ordinary text — no new node type,
 * the same thing the keyboard's own picker has always produced.
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
  const [popup, setPopupState] = useState<Popup | null>(null)
  /* The keyboard handler TipTap calls lives outside React's render cycle, so
     it reads the latest popup from a ref rather than a closed-over state value. */
  const popupRef = useRef<Popup | null>(null)
  const setPopup = (p: Popup | null) => {
    popupRef.current = p
    setPopupState(p)
  }
  /* The @ and : menus are positioned against this, not the viewport. The panel
     this composer lives in is a <dialog> that slides in with a transform, and a
     transformed ancestor makes `position: fixed` behave as `absolute` relative
     to itself — the first menu rendered 300px off the right of the screen. */
  const frameRef = useRef<HTMLDivElement>(null)

  const editor = useEditor({
    // Rendered on the client after mount; nothing to serialise on the server.
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({
        heading: false,
        link: { openOnClick: false, autolink: true, defaultProtocol: 'https' },
      }),
      PostHeading.configure({ levels: [...POST_HEADING_LEVELS] }),
      Mention.configure({
        HTMLAttributes: { class: 'rounded bg-brand-50 px-1 font-medium text-brand-700' },
        renderText: ({ node }) => `@${node.attrs.label ?? node.attrs.id}`,
        deleteTriggerWithBackspace: true,
        suggestion: {
          char: '@',
          items: ({ query }) =>
            staff.filter((s) => s.name.toLowerCase().includes(query.toLowerCase())).slice(0, 6),
          render: suggestionRender<Staff>('mention', setPopup, popupRef, (props, s) =>
            props.command({ id: s.id, label: s.name }),
          ),
        },
      }),
      EmojiSuggestion.configure({
        render: suggestionRender<Emoji>('emoji', setPopup, popupRef, (props, e) => props.command(e)),
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
    selector: (ctx) => {
      const e = ctx.editor
      return {
        empty: e?.isEmpty ?? true,
        bold: e?.isActive('bold') ?? false,
        italic: e?.isActive('italic') ?? false,
        underline: e?.isActive('underline') ?? false,
        strike: e?.isActive('strike') ?? false,
        code: e?.isActive('code') ?? false,
        heading: (POST_HEADING_LEVELS.find((l) => e?.isActive('heading', { level: l })) ?? 0) as 0 | 1 | 2 | 3,
        bullets: e?.isActive('bulletList') ?? false,
        numbers: e?.isActive('orderedList') ?? false,
        quote: e?.isActive('blockquote') ?? false,
        codeBlock: e?.isActive('codeBlock') ?? false,
        link: e?.isActive('link') ?? false,
        canUndo: e?.can().undo() ?? false,
        canRedo: e?.can().redo() ?? false,
      }
    },
  }) ?? IDLE

  const [linkOpen, setLinkOpen] = useState(false)

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

  const run = (f: (c: ChainedCommands) => boolean) => {
    if (editor) f(editor.chain().focus())
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
            Write an update. @ mentions a colleague, : adds an emoji.
          </span>
        ) : null}
        <EditorContent editor={editor} />
        {popup && popup.rect && frameRef.current ? (
          <SuggestionMenu popup={popup} frame={frameRef.current.getBoundingClientRect()} />
        ) : null}
      </div>

      <div className="flex items-start justify-between gap-2 border-t border-neutral-100 px-2 py-1.5">
        <div className="flex flex-wrap items-center gap-0.5" role="toolbar" aria-label="Formatting">
          <Tool label="Bold" on={state.bold} onClick={() => run((c) => c.toggleBold().run())}>
            <span className="font-bold">B</span>
          </Tool>
          <Tool label="Italic" on={state.italic} onClick={() => run((c) => c.toggleItalic().run())}>
            <span className="italic">I</span>
          </Tool>
          <Tool label="Underline" on={state.underline} onClick={() => run((c) => c.toggleUnderline().run())}>
            <span className="underline">U</span>
          </Tool>
          <Tool label="Strikethrough" on={state.strike} onClick={() => run((c) => c.toggleStrike().run())}>
            <span className="line-through">S</span>
          </Tool>
          <Tool label="Inline code" on={state.code} onClick={() => run((c) => c.toggleCode().run())}>
            <span className="font-mono text-[11px]">{'<>'}</span>
          </Tool>
          <Divider />
          {POST_HEADING_LEVELS.map((level) => (
            <Tool
              key={level}
              label={`Heading ${level}`}
              on={state.heading === level}
              onClick={() => run((c) => c.toggleHeading({ level }).run())}
            >
              <span className="text-[11px] font-semibold">H{level}</span>
            </Tool>
          ))}
          <Divider />
          <Tool label="Bulleted list" on={state.bullets} onClick={() => run((c) => c.toggleBulletList().run())}>
            <span aria-hidden>•≡</span>
          </Tool>
          <Tool label="Numbered list" on={state.numbers} onClick={() => run((c) => c.toggleOrderedList().run())}>
            <span aria-hidden>1≡</span>
          </Tool>
          <Tool label="Quote" on={state.quote} onClick={() => run((c) => c.toggleBlockquote().run())}>
            <span aria-hidden className="text-base leading-none">❝</span>
          </Tool>
          <Tool label="Code block" on={state.codeBlock} onClick={() => run((c) => c.toggleCodeBlock().run())}>
            <span className="font-mono text-[11px]">{'{ }'}</span>
          </Tool>
          <Tool label="Horizontal rule" on={false} onClick={() => run((c) => c.setHorizontalRule().run())}>
            <span aria-hidden>—</span>
          </Tool>
          <Divider />
          <Tool label="Link" on={state.link || linkOpen} onClick={() => setLinkOpen((o) => !o)}>
            <LinkGlyph />
          </Tool>
          <Divider />
          <Tool label="Undo" on={false} disabled={!state.canUndo} onClick={() => run((c) => c.undo().run())}>
            <span aria-hidden>↶</span>
          </Tool>
          <Tool label="Redo" on={false} disabled={!state.canRedo} onClick={() => run((c) => c.redo().run())}>
            <span aria-hidden>↷</span>
          </Tool>
        </div>
        <button
          type="button"
          onClick={post}
          disabled={!editor || state.empty || posting}
          className="shrink-0 rounded-md bg-brand px-3 py-1 text-xs font-medium text-white outline-none transition-colors hover:bg-brand-600 disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-brand/40"
        >
          {posting ? 'Posting…' : 'Post'}
        </button>
      </div>

      {linkOpen && editor ? <LinkRow editor={editor} onDone={() => setLinkOpen(false)} /> : null}
    </div>
  )
}

const IDLE = {
  empty: true,
  bold: false,
  italic: false,
  underline: false,
  strike: false,
  code: false,
  heading: 0 as 0 | 1 | 2 | 3,
  bullets: false,
  numbers: false,
  quote: false,
  codeBlock: false,
  link: false,
  canUndo: false,
  canRedo: false,
}

function Divider() {
  return <span aria-hidden className="mx-0.5 h-4 w-px bg-neutral-200" />
}

function Tool({
  label,
  on,
  disabled = false,
  onClick,
  children,
}: {
  label: string
  on: boolean
  disabled?: boolean
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={on}
      aria-disabled={disabled || undefined}
      title={label}
      // Mousedown, not click: a click would blur the editor first and lose
      // the selection the command applies to.
      onMouseDown={(e) => {
        e.preventDefault()
        if (!disabled) onClick()
      }}
      onKeyDown={(e) => {
        if ((e.key === 'Enter' || e.key === ' ') && !disabled) {
          e.preventDefault()
          onClick()
        }
      }}
      className={`flex h-7 min-w-7 items-center justify-center rounded px-1.5 text-xs outline-none transition-colors focus-visible:ring-2 focus-visible:ring-brand/30 ${
        on ? 'bg-neutral-200 text-neutral-900' : 'text-neutral-600 hover:bg-neutral-100 hover:text-neutral-900'
      } ${disabled ? 'cursor-default opacity-40 hover:bg-transparent hover:text-neutral-600' : ''}`}
    >
      {children}
    </button>
  )
}

function LinkGlyph() {
  return (
    <svg aria-hidden viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
      <path d="M6.5 9.5l3-3" />
      <path d="M7 4.5l1.2-1.2a2.6 2.6 0 013.7 3.7L10.7 8.2" />
      <path d="M9 11.5l-1.2 1.2a2.6 2.6 0 01-3.7-3.7L5.3 7.8" />
    </svg>
  )
}

/* ---- the link row ---------------------------------------------------- */

const SAFE_HREF = /^https?:\/\//i

/**
 * A URL is typed here, not prompted for. The row opens under the toolbar with
 * the selection's current link, if any, and applies on Enter or Apply. The
 * same http(s) rule the database enforces is checked here first, so a bad
 * scheme is a sentence in the row rather than a refusal after posting.
 */
function LinkRow({ editor, onDone }: { editor: Editor; onDone: () => void }) {
  const current = (editor.getAttributes('link').href as string | undefined) ?? ''
  const [href, setHref] = useState(current)
  const [problem, setProblem] = useState<string | null>(null)

  function apply() {
    let value = href.trim()
    if (value && !/^[a-z][a-z0-9+.-]*:/i.test(value)) value = `https://${value}`
    if (!SAFE_HREF.test(value)) {
      setProblem('A link must start with http:// or https://')
      return
    }
    const chain = editor.chain().focus()
    if (editor.state.selection.empty && !editor.isActive('link')) {
      // Nothing selected: the address becomes the text, linked.
      chain.insertContent({ type: 'text', text: value, marks: [{ type: 'link', attrs: { href: value } }] }).run()
    } else {
      chain.extendMarkRange('link').setLink({ href: value }).run()
    }
    onDone()
  }

  return (
    <div className="flex flex-wrap items-center gap-2 border-t border-neutral-100 px-2 py-1.5">
      <label className="sr-only" htmlFor="qw-post-link">
        Link address
      </label>
      <input
        id="qw-post-link"
        type="url"
        autoFocus
        value={href}
        onChange={(e) => {
          setHref(e.target.value)
          setProblem(null)
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            apply()
          }
          if (e.key === 'Escape') onDone()
        }}
        placeholder="https://"
        className="h-7 min-w-0 flex-1 rounded-md border border-neutral-300 px-2 text-xs text-neutral-900 outline-none focus:border-brand-300 focus:ring-2 focus:ring-brand/15"
      />
      <button type="button" onClick={apply} className="h-7 rounded-md bg-neutral-900 px-2.5 text-xs font-medium text-white hover:bg-neutral-800">
        Apply
      </button>
      {current ? (
        <button
          type="button"
          onClick={() => {
            editor.chain().focus().extendMarkRange('link').unsetLink().run()
            onDone()
          }}
          className="h-7 rounded-md px-2 text-xs text-neutral-600 hover:bg-neutral-100"
        >
          Remove link
        </button>
      ) : null}
      <button type="button" onClick={onDone} className="h-7 rounded-md px-2 text-xs text-neutral-600 hover:bg-neutral-100">
        Cancel
      </button>
      {problem ? (
        <span role="alert" className="basis-full text-xs text-red-600">
          {problem}
        </span>
      ) : null}
    </div>
  )
}

/* ---- the @ and : menus ----------------------------------------------- */

type Popup =
  | { kind: 'mention'; items: Staff[]; index: number; rect: DOMRect | null; pick: (item: Staff) => void }
  | { kind: 'emoji'; items: Emoji[]; index: number; rect: DOMRect | null; pick: (item: Emoji) => void }

/**
 * One render lifecycle for both suggestion lists. TipTap calls onStart and
 * onUpdate as the query changes and onKeyDown for every key while the list is
 * open; the popup state is what React draws from, and the ref is what the
 * key handler reads, since it runs outside a render.
 */
function suggestionRender<T extends Staff | Emoji>(
  kind: Popup['kind'],
  setPopup: (p: Popup | null) => void,
  popupRef: { current: Popup | null },
  commit: (props: SuggestionProps<T>, item: T) => void,
): SuggestionOptions<T, T>['render'] {
  const show = (props: SuggestionProps<T>) =>
    setPopup({
      kind,
      items: props.items,
      index: 0,
      rect: props.clientRect?.() ?? null,
      pick: (item: T) => commit(props, item),
    } as unknown as Popup)
  return () => ({
    onStart: show,
    onUpdate: show,
    onKeyDown: ({ event }) => {
      const p = popupRef.current
      if (!p) return false
      if (event.key === 'Escape') {
        setPopup(null)
        return true
      }
      const n = Math.max(p.items.length, 1)
      if (event.key === 'ArrowDown') {
        setPopup({ ...p, index: (p.index + 1) % n } as Popup)
        return true
      }
      if (event.key === 'ArrowUp') {
        setPopup({ ...p, index: (p.index - 1 + n) % n } as Popup)
        return true
      }
      if (event.key === 'Enter' || event.key === 'Tab') {
        const item = p.items[p.index]
        if (item) (p.pick as (i: Staff | Emoji) => void)(item)
        return true
      }
      return false
    },
    onExit: () => setPopup(null),
  })
}

/**
 * The heading node, drawn in the editor the way the feed draws it: level 1 is
 * an h4, level 2 an h5, level 3 an h6. The composer sits inside a panel whose
 * own headings are h2 and h3, and the first browser pass found an <h1> in the
 * panel's outline while a heading was being typed. The document is unchanged —
 * the level is still 1, 2 or 3 — only the tag the editor paints. Both tags
 * parse back, so a heading copied within the editor stays a heading.
 */
const PostHeading = Heading.extend({
  parseHTML() {
    return POST_HEADING_LEVELS.flatMap((level) => [
      { tag: `h${level}`, attrs: { level } },
      { tag: `h${level + 3}`, attrs: { level } },
    ])
  },
  renderHTML({ node, HTMLAttributes }) {
    const level = (POST_HEADING_LEVELS as readonly number[]).includes(node.attrs.level) ? node.attrs.level : 1
    return [`h${level + 3}`, mergeAttributes(this.options.HTMLAttributes, HTMLAttributes), 0]
  },
})

/**
 * `:` opens the emoji list. A plain Suggestion plugin — not TipTap's Emoji
 * extension, which inserts an `emoji` node the database would refuse — whose
 * command replaces `:name` with the character. Two letters before it opens,
 * so a colon in ordinary prose does not.
 */
const EmojiSuggestion = Extension.create<{ render: SuggestionOptions<Emoji, Emoji>['render'] }>({
  name: 'emojiSuggestion',
  addOptions() {
    return { render: () => ({}) }
  },
  addProseMirrorPlugins() {
    return [
      Suggestion<Emoji, Emoji>({
        editor: this.editor,
        pluginKey: new PluginKey('emojiSuggestion'),
        char: ':',
        allowSpaces: false,
        items: ({ query }) => (query.length < 2 ? [] : searchEmoji(query)),
        allow: ({ state, range }) => state.doc.textBetween(range.from, range.to).length >= 3,
        command: ({ editor, range, props }) => {
          editor.chain().focus().insertContentAt(range, `${props.glyph} `).run()
        },
        render: this.options.render,
      }),
    ]
  },
})

function SuggestionMenu({ popup, frame }: { popup: Popup; frame: DOMRect }) {
  const caret = popup.rect!
  const label = popup.kind === 'mention' ? 'Mention a colleague' : 'Insert an emoji'
  const empty = popup.kind === 'mention' ? 'No one matches' : 'No emoji matches'
  return (
    <ul
      role="listbox"
      aria-label={label}
      style={{ position: 'absolute', left: caret.left - frame.left, top: caret.bottom - frame.top + 4 }}
      className="z-30 w-56 overflow-hidden rounded-lg border border-neutral-200 bg-white p-1 shadow-[0_1px_2px_rgb(0_0_0/0.05),0_8px_24px_-12px_rgb(0_0_0/0.18)]"
    >
      {popup.items.length ? (
        popup.items.map((item, i) => {
          const active = i === popup.index
          const key = popup.kind === 'mention' ? (item as Staff).id : (item as Emoji).name
          return (
            <li key={key} role="option" aria-selected={active}>
              <button
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault()
                  ;(popup.pick as (i: Staff | Emoji) => void)(item)
                }}
                className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-neutral-800 outline-none hover:bg-neutral-100 ${
                  active ? 'bg-neutral-100' : ''
                }`}
              >
                {popup.kind === 'mention' ? (
                  (item as Staff).name
                ) : (
                  <>
                    <span className="text-base leading-none">{(item as Emoji).glyph}</span>
                    <span className="text-xs text-neutral-600">:{(item as Emoji).name}:</span>
                  </>
                )}
              </button>
            </li>
          )
        })
      ) : (
        <li className="px-2 py-1.5 text-xs text-neutral-400">{empty}</li>
      )}
    </ul>
  )
}
