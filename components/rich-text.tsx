'use client'

import { useState, type ReactNode } from 'react'
import type { Editor } from '@tiptap/react'
import Heading from '@tiptap/extension-heading'
import { mergeAttributes } from '@tiptap/core'

/**
 * The parts of a rich-text toolbar that two editors share.
 *
 * Extracted 9 September, when the Email tool needed a composer of its own.
 * There are now two rich-text editors in the app — the feed's `PostComposer`
 * and the email modal's `MessageEditor` — and these are the pieces that must
 * not be copied between them, because each encodes a defect already paid for:
 *
 *  - `Tool` acts on **mousedown**, not click. A click blurs the editor first
 *    and loses the selection the command applies to.
 *  - `LinkRow` applies the same `http(s)` rule the database enforces, so a bad
 *    scheme is a sentence in the row rather than a refusal after sending.
 *  - `messageHeading` paints **h4**, never h1, so a message can never write
 *    into the page's own outline — and parses both tags back, so text copied
 *    within the editor stays a heading.
 *
 * The editors themselves are deliberately NOT shared. A post can name a
 * colleague, carry a picture and claim uploaded bytes; an email can do none of
 * those, and the database enforces a narrower node list for it. One component
 * doing both would have to be told which half of itself to switch off.
 */

export function Divider() {
  return <span aria-hidden className="mx-0.5 h-4 w-px bg-neutral-200" />
}

export function Tool({
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

export function LinkGlyph() {
  return (
    <svg aria-hidden viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
      <path d="M6.5 9.5l3-3" />
      <path d="M7 4.5l1.2-1.2a2.6 2.6 0 013.7 3.7L10.7 8.2" />
      <path d="M9 11.5l-1.2 1.2a2.6 2.6 0 01-3.7-3.7L5.3 7.8" />
    </svg>
  )
}

export const SAFE_HREF = /^https?:\/\//i

/**
 * A URL is typed here, not prompted for. The row opens under the toolbar with
 * the selection's current link, if any, and applies on Enter or Apply. The
 * same http(s) rule the database enforces is checked here first, so a bad
 * scheme is a sentence in the row rather than a refusal after posting.
 */
export function LinkRow({ editor, onDone }: { editor: Editor; onDone: () => void }) {
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
    <div className="flex flex-wrap items-center gap-2 border-b border-neutral-100 px-2 py-1.5">
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
        <p role="alert" className="w-full text-[11px] text-red-600">
          {problem}
        </p>
      ) : null}
    </div>
  )
}

/**
 * A heading extension that paints h4–h6 rather than h1–h3.
 *
 * A message's heading is emphasis inside a message, not the page's structure.
 * TipTap's own Heading renders `h1` for level 1, which put an `<h1>` into the
 * task panel's outline while a heading was being typed — found by a probe that
 * reads the dialog's heading outline, not by any test. Both tags parse back, so
 * text copied within the editor stays a heading.
 *
 * `levels` is passed by the caller, because the post's set and the email's are
 * configured from their own constants.
 */
export function messageHeading(levels: readonly number[]) {
  return Heading.extend({
    parseHTML() {
      return levels.flatMap((level) => [
        { tag: `h${level}`, attrs: { level } },
        { tag: `h${level + 3}`, attrs: { level } },
      ])
    },
    renderHTML({ node, HTMLAttributes }) {
      const level = levels.includes(node.attrs.level) ? node.attrs.level : levels[0]
      return [`h${level + 3}`, mergeAttributes(this.options.HTMLAttributes, HTMLAttributes), 0]
    },
  })
}
