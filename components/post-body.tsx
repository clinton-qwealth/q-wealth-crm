import type { ReactNode } from 'react'
import { postMediaUrl, type PostDoc, type PostMark, type PostMedia, type PostMention, type PostNode } from '@/lib/workflow-board'

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
 * An image is the same idea taken further: the document holds ONLY an upload's
 * id, and everything drawn — the filename, the dimensions to reserve, whether
 * it has since been removed — comes from `media`. So a post that cannot itself
 * be edited still shows a corrected filename, and a redacted picture becomes a
 * sentence rather than a broken image and a request that would fail.
 *
 * A post's headings are drawn as h4, h5 and h6. A post sits inside a panel
 * whose own headings are h2 and h3, and a comment must not be able to insert
 * itself above them in the page's outline: "Heading 1" in a post is the
 * largest of three sizes of emphasis, not the page's title.
 */
export function PostBody({
  doc,
  mentioned = [],
  media = [],
}: {
  doc: PostDoc
  mentioned?: PostMention[]
  media?: PostMedia[]
}) {
  const ctx: Context = {
    names: new Map(mentioned.map((m) => [m.staff_id, m.full_name])),
    media: new Map(media.map((m) => [m.id, m])),
  }
  return (
    <div className="qw-post text-sm leading-relaxed text-neutral-800">
      {(doc.content ?? []).map((n, i) => renderNode(n, i, ctx))}
    </div>
  )
}

/**
 * What the walk needs beyond the node itself: the people a post names and the
 * files it carries, both resolved to what they are TODAY. One object rather
 * than a growing parameter list, because the document model grows.
 */
type Context = { names: Map<string, string>; media: Map<string, PostMedia> }

const SAFE_HREF = /^https?:\/\//i

/** Post level 1–3 → h4–h6, beneath the panel's h2 and its boxes' h3. */
function headingTag(level: unknown): 'h4' | 'h5' | 'h6' {
  const n = typeof level === 'number' ? level : Number(level)
  if (n === 2) return 'h5'
  if (n === 3) return 'h6'
  return 'h4'
}

function renderNode(node: PostNode, key: number, ctx: Context): ReactNode {
  const { names } = ctx
  const children = (node.content ?? []).map((c, i) => renderNode(c, i, ctx))
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
    case 'image':
      return renderImage(node, key, ctx)
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

/**
 * A picture.
 *
 * The document says which upload, and only that. Everything else is the row:
 * the filename to fall back on for a description, the pixel dimensions so the
 * browser reserves the right shape before the bytes arrive, and the redaction.
 *
 * A row that is not there is not an error — it is a post the server has not
 * accepted yet, drawn optimistically from the document alone — so the picture
 * is still drawn, just without a reserved shape.
 */
function renderImage(node: PostNode, key: number, ctx: Context): ReactNode {
  const id = typeof node.attrs?.id === 'string' ? node.attrs.id : ''
  if (!id) return null
  const row = ctx.media.get(id)
  const name = typeof node.attrs?.name === 'string' ? node.attrs.name : ''
  const alt = typeof node.attrs?.alt === 'string' && node.attrs.alt ? node.attrs.alt : row?.name || name
  const width = typeof node.attrs?.width === 'number' ? node.attrs.width : null

  /* Removed, and the post left exactly as it was written. Nothing is
     requested: the bytes are gone, and a broken image icon would say only that
     something failed rather than that someone decided. */
  if (row?.redacted_at) {
    return (
      <p
        key={key}
        className="my-2 rounded-md border border-dashed border-neutral-300 bg-neutral-50 px-3 py-2 text-xs text-neutral-500"
      >
        Image removed{row.redacted_by_name ? ` by ${row.redacted_by_name}` : ''}
      </p>
    )
  }

  return (
    <span key={key} className="my-2 block">
      {/* eslint-disable-next-line @next/next/no-img-element -- the route this
          points at re-checks access and redirects to a short-lived signed URL,
          which next/image's loader cannot follow on the client's behalf. */}
      <img
        src={postMediaUrl(id)}
        alt={alt}
        // The natural size, so the aspect ratio is known before the bytes
        // land and the feed does not jump as pictures fill in.
        width={row?.width ?? undefined}
        height={row?.height ?? undefined}
        loading="lazy"
        decoding="async"
        style={width ? { width } : undefined}
        className="block h-auto max-w-full rounded-md border border-neutral-200"
      />
    </span>
  )
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
