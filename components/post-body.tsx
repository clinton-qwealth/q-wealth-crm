import type { ReactNode } from 'react'
import type { PostDoc, PostMark, PostMention, PostNode } from '@/lib/workflow-board'

/**
 * Draws a post's document.
 *
 * This is the whole reason the body is a document and not HTML: the renderer
 * walks a known shape and emits known elements, so nothing a person typed —
 * or pasted, or a connector sent — is ever handed to the browser as markup.
 * A node type it does not know is simply not drawn (the database refuses them
 * anyway), and a link whose scheme is not http(s) is drawn as plain text.
 *
 * Mentions show the person's CURRENT name where the view supplies it, falling
 * back to the label as typed. The document keeps what was written; the screen
 * says who that is today.
 *
 * A post's headings are drawn as h4, h5 and h6. A post sits inside a panel
 * whose own headings are h2 and h3, and a comment must not be able to insert
 * itself above them in the page's outline: "Heading 1" in a post is the
 * largest of three sizes of emphasis, not the page's title.
 */
export function PostBody({ doc, mentioned = [] }: { doc: PostDoc; mentioned?: PostMention[] }) {
  const names = new Map(mentioned.map((m) => [m.staff_id, m.full_name]))
  return (
    <div className="qw-post text-sm leading-relaxed text-neutral-800">
      {(doc.content ?? []).map((n, i) => renderNode(n, i, names))}
    </div>
  )
}

const SAFE_HREF = /^https?:\/\//i

/** Post level 1–3 → h4–h6, beneath the panel's h2 and its boxes' h3. */
function headingTag(level: unknown): 'h4' | 'h5' | 'h6' {
  const n = typeof level === 'number' ? level : Number(level)
  if (n === 2) return 'h5'
  if (n === 3) return 'h6'
  return 'h4'
}

function renderNode(node: PostNode, key: number, names: Map<string, string>): ReactNode {
  const children = (node.content ?? []).map((c, i) => renderNode(c, i, names))
  switch (node.type) {
    case 'paragraph':
      return <p key={key}>{children.length ? children : <br />}</p>
    case 'text':
      return <span key={key}>{applyMarks(node.text ?? '', node.marks ?? [])}</span>
    case 'hardBreak':
      return <br key={key} />
    case 'bulletList':
      return <ul key={key}>{children}</ul>
    case 'orderedList':
      return <ol key={key}>{children}</ol>
    case 'listItem':
      return <li key={key}>{children}</li>
    case 'heading': {
      const Tag = headingTag(node.attrs?.level)
      return <Tag key={key}>{children}</Tag>
    }
    case 'blockquote':
      return <blockquote key={key}>{children}</blockquote>
    case 'codeBlock':
      // The language attribute is not drawn: it is a hint for a highlighter
      // this feed does not have, and there is no reason to echo it as a class.
      return (
        <pre key={key}>
          <code>{children}</code>
        </pre>
      )
    case 'horizontalRule':
      return <hr key={key} />
    case 'mention': {
      const id = typeof node.attrs?.id === 'string' ? node.attrs.id : ''
      const label = names.get(id) ?? (typeof node.attrs?.label === 'string' ? node.attrs.label : 'someone')
      return (
        <span
          key={key}
          data-mention={id}
          className="rounded bg-brand-50 px-1 font-medium text-brand-700"
        >
          @{label}
        </span>
      )
    }
    default:
      return null
  }
}

/** Marks nest from the inside out, so a bold link is a link around bold text. */
function applyMarks(text: string, marks: PostMark[]): ReactNode {
  let out: ReactNode = text
  for (const mark of marks) {
    switch (mark.type) {
      case 'bold':
        out = <strong>{out}</strong>
        break
      case 'italic':
        out = <em>{out}</em>
        break
      case 'underline':
        out = <u>{out}</u>
        break
      case 'strike':
        out = <s>{out}</s>
        break
      case 'code':
        out = <code>{out}</code>
        break
      case 'link': {
        const href = mark.attrs?.href ?? ''
        // Defence in depth: the database already refuses these, and the
        // renderer still will not draw one as a link.
        out = SAFE_HREF.test(href) ? (
          <a href={href} target="_blank" rel="noopener noreferrer" className="text-brand-700 underline">
            {out}
          </a>
        ) : (
          out
        )
        break
      }
    }
  }
  return out
}
