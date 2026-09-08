'use client'

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react'
import {
  EditorContent,
  NodeViewWrapper,
  ReactNodeViewRenderer,
  useEditor,
  useEditorState,
  type NodeViewProps,
} from '@tiptap/react'
import type { Editor } from '@tiptap/react'
import { Extension, Node, mergeAttributes, type ChainedCommands } from '@tiptap/core'
import { PluginKey } from '@tiptap/pm/state'
import StarterKit from '@tiptap/starter-kit'
import Heading from '@tiptap/extension-heading'
import Mention from '@tiptap/extension-mention'
import Suggestion, { type SuggestionOptions, type SuggestionProps } from '@tiptap/suggestion'
import {
  POST_HEADING_LEVELS,
  POST_IMAGE_MAX_WIDTH,
  POST_IMAGE_MIN_WIDTH,
  POST_MEDIA_SIZE_LIMIT,
  isPostMediaType,
  postMediaKind,
  postMediaUrl,
  type PostDoc,
} from '@/lib/workflow-board'
import { searchEmoji, type Emoji } from '@/lib/emoji'

type Staff = { id: string; name: string }

/**
 * How bytes get out of the browser, in the two steps the database requires.
 *
 * ROW FIRST, THEN BYTES: `reserve` creates the `workflow_post_media` row and
 * returns the id the document will name and the path the bytes must go to.
 * Only then may `send` write them, because the storage policy decides by
 * matching that path against that row. The composer inserts the picture into
 * the document BETWEEN the two, so a slow upload is something the writer can
 * see happening rather than a pause with nothing on screen.
 *
 * Passed in rather than done here, for the same reason the composer does not
 * post: this component knows about documents, not about Supabase, and the tests
 * mount it with neither.
 */
export type PostUploader = {
  reserve: (
    file: File,
    dimensions: { width: number; height: number } | null,
  ) => Promise<{ id: string; path: string } | { error: string }>
  send: (path: string, file: File) => Promise<{ error: string } | null>
}

/* ---- what is still going up ------------------------------------------- */

/**
 * Upload state lives OUTSIDE React's tree, deliberately.
 *
 * An image's node view is mounted by ProseMirror, not by this component, so it
 * cannot be handed props, and it renders through a portal whose position in the
 * React tree is TipTap's business rather than ours. A tiny external store is
 * the one thing certainly reachable from both sides. The keys are database
 * uuids, so two composers on one page cannot collide, and an entry is deleted
 * the moment its upload finishes — no entry means "this is a finished picture",
 * which is exactly what a node view rendering a posted document should see.
 */
/* No 'failed': a picture whose bytes did not arrive is taken back out of the
   document, so there is no such thing as a failed one still on screen. */
type Upload = { status: 'sending' | 'ready'; preview: string }
const uploads = new Map<string, Upload>()
const uploadListeners = new Set<() => void>()

function subscribeUploads(fn: () => void) {
  uploadListeners.add(fn)
  return () => {
    uploadListeners.delete(fn)
  }
}

function setUpload(id: string, upload: Upload | null) {
  if (upload) uploads.set(id, upload)
  else uploads.delete(id)
  for (const listener of uploadListeners) listener()
}

/** Let go of a preview's blob, and of the entry, once the node is gone. */
function forgetUpload(id: string) {
  const existing = uploads.get(id)
  if (existing) URL.revokeObjectURL(existing.preview)
  setUpload(id, null)
}

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
 * A picture can be pasted, dropped or chosen from the toolbar, and its node
 * carries the UPLOAD'S ID and nothing resembling an address. Post stays
 * disabled while any of them is still going up: a document naming bytes that
 * never arrived is a broken post, and the database would refuse it anyway.
 *
 * The composer does not post. It hands the document to `onPost` and clears
 * itself only when told the post was accepted — so a refusal never costs the
 * writer their words.
 */
export function PostComposer({
  staff,
  onPost,
  onReady,
  uploader,
}: {
  staff: Staff[]
  /** Return true if the post was accepted, so the editor clears. */
  onPost: (doc: PostDoc) => Promise<boolean>
  /** For tests, which cannot type into ProseMirror the way a person does. */
  onReady?: (editor: Editor) => void
  /** Absent means this composer cannot carry pictures; the Image button says so. */
  uploader?: PostUploader
}) {
  const [posting, setPosting] = useState(false)
  /* How many uploads are in flight. A count rather than a boolean: two
     screenshots pasted together must both land before Post comes back. */
  const [sending, setSending] = useState(0)
  const [problem, setProblem] = useState<string | null>(null)
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
      PostImage,
    ],
    editorProps: {
      attributes: {
        class: 'qw-post min-h-[4.5rem] px-3 py-2 text-sm leading-relaxed text-neutral-900 outline-none',
        'aria-label': 'Write a post',
      },
      /* Pasting a screenshot is the way people actually add one, so it is
         handled first and the browser's own behaviour — which would drop an
         image file entirely, there being no node to parse it into — never
         runs. Returning true only when files were actually taken, so pasting
         text still pastes text. */
      handlePaste: (_view, event) => {
        const files = imageFilesFrom(event.clipboardData)
        if (!files.length) return false
        void addFilesRef.current(files)
        return true
      },
      handleDrop: (_view, event) => {
        const files = imageFilesFrom((event as DragEvent).dataTransfer)
        if (!files.length) return false
        event.preventDefault()
        void addFilesRef.current(files)
        return true
      },
    },
  })

  useEffect(() => {
    if (editor && onReady) onReady(editor)
  }, [editor, onReady])

  const fileInputRef = useRef<HTMLInputElement>(null)
  /* ProseMirror's paste and drop handlers are captured when the editor is
     built, so they cannot close over a callback that changes with `uploader`.
     They read the current one from here instead — the same reason the
     suggestion key handler reads the popup from a ref. */
  const addFilesRef = useRef<(files: File[]) => Promise<void>>(async () => {})
  /* The uploads THIS composer made. The store behind it is module-scoped and
     keyed by database uuid, so two composers cannot collide — but only this
     set says whose blobs are whose when one of them goes away. */
  const ownedRef = useRef<Set<string>>(new Set())

  const addFiles = useCallback(
    async (files: File[]) => {
      if (!editor) return
      if (!uploader) {
        setProblem('Pictures cannot be added here.')
        return
      }
      for (const file of files) {
        /* The same two rules the database and the bucket enforce, asked here
           so a 40 MB drop is a sentence rather than a round trip. */
        if (!isPostMediaType(file.type) || postMediaKind(file.type) !== 'image') {
          setProblem(`${file.name || 'That file'} is not a kind of picture a post can carry.`)
          continue
        }
        if (file.size > POST_MEDIA_SIZE_LIMIT) {
          const mb = POST_MEDIA_SIZE_LIMIT / 1024 / 1024
          setProblem(`${file.name || 'That picture'} is larger than the ${mb} MB limit.`)
          continue
        }
        setProblem(null)

        const preview = URL.createObjectURL(file)
        const reserved = await uploader.reserve(file, await measure(preview))
        if ('error' in reserved) {
          URL.revokeObjectURL(preview)
          setProblem(reserved.error)
          continue
        }

        /* The picture goes in NOW, showing the local file, while its bytes are
           still on their way. Post is disabled until they land. */
        ownedRef.current.add(reserved.id)
        setUpload(reserved.id, { status: 'sending', preview })
        editor
          .chain()
          .focus()
          .insertContent({
            type: 'image',
            attrs: { id: reserved.id, name: file.name, alt: null, width: null },
          })
          .run()

        setSending((n) => n + 1)
        const failure = await uploader.send(reserved.path, file)
        setSending((n) => n - 1)

        if (failure) {
          /* The node comes out. A document that names bytes which are not
             there is a broken post, and leaving it in would only move the
             failure to the moment someone pressed Post. */
          removeImage(editor, reserved.id)
          ownedRef.current.delete(reserved.id)
          forgetUpload(reserved.id)
          setProblem(failure.error)
          continue
        }
        /* Keep the local file on screen for the rest of the writing session:
           swapping to the served URL the moment the upload finished would
           flicker for no reason. */
        setUpload(reserved.id, { status: 'ready', preview })
      }
    },
    [editor, uploader],
  )

  useEffect(() => {
    addFilesRef.current = addFiles
  }, [addFiles])

  /* Previews are blobs, and a blob lives until it is revoked. This composer is
     the only thing that knows when its own stop mattering. */
  useEffect(() => {
    const owned = ownedRef.current
    return () => {
      for (const id of owned) forgetUpload(id)
      owned.clear()
    }
  }, [])

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
    /* `sending` is part of the guard, not just the button's disabled state: a
       document naming bytes that have not landed is a post the database will
       refuse, and the writer would lose nothing but would learn nothing either. */
    if (!editor || state.empty || posting || sending > 0) return
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
      if (ok) {
        editor.commands.clearContent(true)
        /* The post is stored, so the feed will serve these pictures from the
           row rather than from a blob in this tab. */
        for (const id of ownedRef.current) forgetUpload(id)
        ownedRef.current.clear()
        setProblem(null)
      }
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
          <Tool
            label="Image"
            on={false}
            disabled={!uploader}
            onClick={() => fileInputRef.current?.click()}
          >
            <ImageGlyph />
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
          disabled={!editor || state.empty || posting || sending > 0}
          className="shrink-0 rounded-md bg-brand px-3 py-1 text-xs font-medium text-white outline-none transition-colors hover:bg-brand-600 disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-brand/40"
        >
          {posting ? 'Posting…' : 'Post'}
        </button>
      </div>

      {linkOpen && editor ? <LinkRow editor={editor} onDone={() => setLinkOpen(false)} /> : null}

      {/* Outside the toolbar so it is not in the toolbar's tab ring, and
          `accept` narrowed to what a post may carry so the file chooser does
          not offer files that would only be refused. */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        multiple
        hidden
        onChange={(e) => {
          const files = Array.from(e.target.files ?? [])
          // Cleared so choosing the same file twice in a row still fires.
          e.target.value = ''
          if (files.length) void addFiles(files)
        }}
      />

      {sending > 0 ? (
        <p role="status" className="border-t border-neutral-100 px-3 py-1.5 text-xs text-neutral-500">
          {sending === 1 ? 'Adding a picture…' : `Adding ${sending} pictures…`}
        </p>
      ) : null}
      {problem ? (
        <p role="alert" className="border-t border-neutral-100 px-3 py-1.5 text-xs text-red-600">
          {problem}
        </p>
      ) : null}
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

/* ---- pictures --------------------------------------------------------- */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * A picture in a post.
 *
 * NOT `@tiptap/extension-image`, and the difference is the whole point: that
 * extension's node is a `src`, and this one has no address of any kind. It
 * carries the id of a `workflow_post_media` row, the filename it was uploaded
 * under, an optional description and an optional display width, and
 * `post_workflow_activity()` refuses the node outright if anything resembling
 * an address is on it.
 *
 * `parseHTML` MATCHES ONLY OUR OWN MARKER, AND ONLY WITH A UUID ON IT. Until
 * this node existed, a pasted `<img>` was dropped because the schema had
 * nothing to parse one into — the safety came for free. It does not any more:
 * a `parseHTML` of `img[src]`, or even `img` unqualified, would turn any image
 * on any web page into a node with a nonsense id the moment someone pasted a
 * page into the composer. Copying WITHIN the editor still works, because
 * `renderHTML` writes the marker back out.
 */
const PostImage = Node.create({
  name: 'image',
  group: 'block',
  atom: true,
  draggable: true,
  selectable: true,

  addAttributes() {
    return {
      id: {
        default: null,
        parseHTML: (el) => el.getAttribute('data-post-media'),
        renderHTML: (attrs) => ({ 'data-post-media': attrs.id }),
      },
      name: {
        default: '',
        parseHTML: (el) => el.getAttribute('data-name') ?? '',
        renderHTML: (attrs) => ({ 'data-name': attrs.name }),
      },
      alt: {
        default: null,
        parseHTML: (el) => el.getAttribute('alt'),
        renderHTML: (attrs) => (attrs.alt ? { alt: attrs.alt } : {}),
      },
      width: {
        default: null,
        parseHTML: (el) => {
          const raw = Number(el.getAttribute('width'))
          return Number.isInteger(raw) && raw > 0 ? raw : null
        },
        renderHTML: (attrs) => (attrs.width ? { width: String(attrs.width) } : {}),
      },
    }
  },

  parseHTML() {
    return [
      {
        tag: 'img[data-post-media]',
        // A marker that is not an id is not one of ours.
        getAttrs: (el) =>
          UUID.test((el as HTMLElement).getAttribute('data-post-media') ?? '') ? null : false,
      },
    ]
  },

  renderHTML({ HTMLAttributes }) {
    return ['img', mergeAttributes(HTMLAttributes)]
  },

  addNodeView() {
    return ReactNodeViewRenderer(ImageNodeView)
  },
})

/**
 * How a picture looks while it is being written about.
 *
 * The local file is shown for the whole writing session — the upload store
 * holds the blob — so nothing flickers when the bytes land and nothing is
 * fetched back from the server that this tab already has. A picture with no
 * store entry is one from a document this composer did not build, and it comes
 * from the serving route like any other.
 *
 * Selecting it reveals the two things worth changing: a description, which is
 * what a screen reader will read and what the post's plain text falls back to,
 * and a width, dragged from the right edge and clamped to what the database
 * will accept.
 */
function ImageNodeView({ node, updateAttributes, deleteNode, selected }: NodeViewProps) {
  const id = String(node.attrs.id ?? '')
  const name = String(node.attrs.name ?? '')
  const alt = (node.attrs.alt as string | null) ?? ''
  const width = node.attrs.width as number | null

  const upload = useSyncExternalStore(
    subscribeUploads,
    () => uploads.get(id),
    () => undefined,
  )
  const frameRef = useRef<HTMLSpanElement>(null)
  const sending = upload?.status === 'sending'

  /* Dragging the right edge. Pointer capture rather than window listeners, so
     a drag that leaves the composer still ends up here, and the width is
     clamped to the same range post_workflow_activity() will check. */
  const onResize = (e: React.PointerEvent<HTMLSpanElement>) => {
    e.preventDefault()
    e.stopPropagation()
    const frame = frameRef.current
    if (!frame) return
    const left = frame.getBoundingClientRect().left
    const ceiling = Math.min(POST_IMAGE_MAX_WIDTH, frame.parentElement?.clientWidth ?? POST_IMAGE_MAX_WIDTH)
    const handle = e.currentTarget
    handle.setPointerCapture(e.pointerId)

    const move = (ev: PointerEvent) => {
      const next = Math.round(Math.max(POST_IMAGE_MIN_WIDTH, Math.min(ceiling, ev.clientX - left)))
      updateAttributes({ width: next })
    }
    const done = () => {
      handle.removeEventListener('pointermove', move)
      handle.removeEventListener('pointerup', done)
      handle.removeEventListener('pointercancel', done)
    }
    handle.addEventListener('pointermove', move)
    handle.addEventListener('pointerup', done)
    handle.addEventListener('pointercancel', done)
  }

  return (
    <NodeViewWrapper as="div" className="my-2">
      <span ref={frameRef} className="relative inline-block max-w-full align-top">
        {/* eslint-disable-next-line @next/next/no-img-element -- the source is
            a blob in this tab or an access-checked route, and next/image would
            try to optimise both through its loader. */}
        <img
          src={upload?.preview ?? postMediaUrl(id)}
          alt={alt || name}
          draggable={false}
          style={width ? { width } : undefined}
          className={`block h-auto max-w-full rounded-md border ${
            selected ? 'border-brand-300 ring-2 ring-brand/25' : 'border-neutral-200'
          } ${sending ? 'opacity-50' : ''}`}
        />
        {sending ? (
          <span className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <span className="rounded bg-neutral-900/70 px-2 py-0.5 text-[11px] text-white">Adding…</span>
          </span>
        ) : null}
        {selected && !sending ? (
          <>
            <button
              type="button"
              aria-label={`Remove ${name || 'picture'}`}
              title="Remove"
              onMouseDown={(e) => {
                e.preventDefault()
                deleteNode()
              }}
              className="absolute right-1 top-1 flex h-6 w-6 items-center justify-center rounded bg-neutral-900/70 text-xs text-white outline-none hover:bg-neutral-900"
            >
              <span aria-hidden>✕</span>
            </button>
            {/* A grip, not a scrollbar: it is the only affordance for width,
                and a keyboard user has the width field below instead. */}
            <span
              role="presentation"
              onPointerDown={onResize}
              className="absolute right-0 top-1/2 h-8 w-2 -translate-y-1/2 translate-x-1/2 cursor-ew-resize rounded-full bg-brand/70"
            />
          </>
        ) : null}
      </span>
      {selected && !sending ? (
        <span className="mt-1 flex flex-wrap items-center gap-2">
          <label className="flex min-w-0 flex-1 items-center gap-1.5 text-[11px] text-neutral-500">
            Description
            <input
              type="text"
              value={alt}
              placeholder={name}
              onChange={(e) => updateAttributes({ alt: e.target.value || null })}
              className="h-6 min-w-0 flex-1 rounded border border-neutral-300 px-1.5 text-xs text-neutral-900 outline-none focus:border-brand-300 focus:ring-2 focus:ring-brand/15"
            />
          </label>
          <label className="flex items-center gap-1.5 text-[11px] text-neutral-500">
            Width
            <input
              type="number"
              min={POST_IMAGE_MIN_WIDTH}
              max={POST_IMAGE_MAX_WIDTH}
              value={width ?? ''}
              placeholder="auto"
              onChange={(e) => {
                const raw = Number(e.target.value)
                updateAttributes({
                  width: Number.isInteger(raw) && raw >= POST_IMAGE_MIN_WIDTH
                    ? Math.min(raw, POST_IMAGE_MAX_WIDTH)
                    : null,
                })
              }}
              className="h-6 w-16 rounded border border-neutral-300 px-1.5 text-xs text-neutral-900 outline-none focus:border-brand-300 focus:ring-2 focus:ring-brand/15"
            />
          </label>
        </span>
      ) : null}
    </NodeViewWrapper>
  )
}

function ImageGlyph() {
  return (
    <svg aria-hidden viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
      <rect x="2" y="3" width="12" height="10" rx="1.5" />
      <circle cx="5.75" cy="6.5" r="1.15" />
      <path d="M2.75 11.5l3.2-3.1 2.3 2.2 1.9-1.7 3.1 2.9" />
    </svg>
  )
}

/** The image files in a paste or a drop, and nothing else. */
function imageFilesFrom(data: DataTransfer | null): File[] {
  if (!data?.files?.length) return []
  return Array.from(data.files).filter((f) => f.type.startsWith('image/'))
}

/**
 * A picture's own pixel dimensions, so the feed can reserve its space and not
 * jump as it loads.
 *
 * Capped rather than awaited indefinitely: decoding a local blob takes
 * milliseconds in a real browser, and a picture whose size we never learn is
 * still perfectly postable — the column is nullable for exactly this reason.
 */
function measure(url: string): Promise<{ width: number; height: number } | null> {
  return new Promise((resolve) => {
    let settled = false
    const finish = (value: { width: number; height: number } | null) => {
      if (settled) return
      settled = true
      resolve(value)
    }
    const timer = setTimeout(() => finish(null), 600)
    const img = new globalThis.Image()
    img.onload = () => {
      clearTimeout(timer)
      finish(
        img.naturalWidth && img.naturalHeight
          ? { width: img.naturalWidth, height: img.naturalHeight }
          : null,
      )
    }
    img.onerror = () => {
      clearTimeout(timer)
      finish(null)
    }
    img.src = url
  })
}

/** Take a picture back out of the document, by the id it names. */
function removeImage(editor: Editor, id: string) {
  let at = -1
  editor.state.doc.descendants((node, pos) => {
    if (at >= 0) return false
    if (node.type.name === 'image' && node.attrs.id === id) {
      at = pos
      return false
    }
    return true
  })
  if (at >= 0) editor.chain().focus().deleteRange({ from: at, to: at + 1 }).run()
}

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
