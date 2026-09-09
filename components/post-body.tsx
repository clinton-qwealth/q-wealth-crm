import type { ReactNode } from 'react'
import {
  POST_ENTITY_KINDS,
  entityHref,
  isCalloutTone,
  isEmailColour,
  isEmailFont,
  isEntityKind,
  postMediaUrl,
  type CalloutTone,
  type PostDoc,
  type PostEntity,
  type PostMark,
  type PostMedia,
  type PostMention,
  type PostNode,
} from '@/lib/workflow-board'

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
  entities = [],
}: {
  doc: PostDoc
  mentioned?: PostMention[]
  media?: PostMedia[]
  entities?: PostEntity[]
}) {
  const ctx: Context = {
    names: new Map(mentioned.map((m) => [m.staff_id, m.full_name])),
    media: new Map(media.map((m) => [m.id, m])),
    /* Keyed by kind AND id: the three kinds are separate tables, so the same
       uuid appearing as both a group and a workflow is not impossible. */
    entities: new Map(entities.map((e) => [`${e.kind}:${e.entity_id}`, e])),
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
type Context = {
  names: Map<string, string>
  media: Map<string, PostMedia>
  entities: Map<string, PostEntity>
}

const SAFE_HREF = /^https?:\/\//i

/**
 * The one place a callout's tone becomes a colour, on this side.
 *
 * Deliberately the same tints the composer uses, and deliberately a left
 * border plus a wash rather than a saturated fill: a callout should draw the
 * eye without competing with the app's own status pills, which use full colour
 * and mean something official. The document carries only the key, so these can
 * be changed at any time and every existing post follows.
 */
const CALLOUT_TINTS: Record<CalloutTone, string> = {
  info: 'border-l-brand-300 bg-brand-50/60',
  warning: 'border-l-amber-400 bg-amber-50',
  success: 'border-l-emerald-400 bg-emerald-50',
}

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
    case 'attachment':
      return renderAttachment(node, key, ctx)
    case 'entity':
      return renderEntity(node, key, ctx)
    case 'callout': {
      /* An unknown tone falls back to `info` rather than rendering untinted.
         The database refuses one anyway; this keeps the block meaningful if a
         tone is ever added to the editor before the whitelist catches up. */
      const tone = isCalloutTone(node.attrs?.tone) ? node.attrs.tone : 'info'
      return (
        <div key={key} className={`my-2 rounded-md border-l-4 py-1.5 pl-3 pr-2 ${CALLOUT_TINTS[tone]}`}>
          {children}
        </div>
      )
    }
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

/**
 * A chip naming a client, a group or another workflow.
 *
 * THE ONE PLACE THE STORED LABEL IS NOT A FALLBACK. A staff mention may fall
 * back to the label as typed, because `staff_directory` is readable by every
 * active staff member and a departed colleague must still resolve. A client is
 * group-scoped, so echoing the document's own label for a reader the view
 * would not resolve it for would be a disclosure — the renderer would be
 * publishing a name that RLS had just declined to give it. So an unresolved
 * chip is a neutral word instead.
 *
 * In practice that is nearly unreachable: a chip may only name things in the
 * workflow's own client group, and anyone reading the post can see that group.
 * It is handled because "nearly unreachable" is not "unreachable".
 */
function renderEntity(node: PostNode, key: number, ctx: Context): ReactNode {
  const id = typeof node.attrs?.id === 'string' ? node.attrs.id : ''
  const kind = isEntityKind(node.attrs?.kind) ? node.attrs.kind : null
  if (!id || !kind) return null

  const row = ctx.entities.get(`${kind}:${id}`)
  const resolved = row?.label ?? null
  const noun = POST_ENTITY_KINDS.find((k) => k.kind === kind)?.noun ?? 'something'
  const href = resolved ? entityHref({ kind, entity_id: id, label: resolved }) : null

  const chip = (
    <span
      data-entity={`${kind}:${id}`}
      className={`rounded px-1 font-medium ${
        resolved ? 'bg-neutral-100 text-neutral-700' : 'bg-neutral-100 italic text-neutral-500'
      }`}
    >
      #{resolved ?? noun}
    </span>
  )

  // A client has no page of its own yet; the chip names it without linking.
  return href ? (
    <a key={key} href={href} className="no-underline hover:underline">
      {chip}
    </a>
  ) : (
    <span key={key}>{chip}</span>
  )
}

/**
 * An attached file.
 *
 * A chip, not an inline preview: a PDF or a spreadsheet is something you take
 * away rather than read in a comment thread. The link goes to the same route
 * the images use, which for a file adds `?download=` so it saves under the
 * name it was uploaded with rather than a uuid.
 *
 * The size and type come from the row, so a chip shows what the file actually
 * is rather than what the document claimed. A row that is absent is a post the
 * server has not accepted yet, drawn from the document alone.
 */
function renderAttachment(node: PostNode, key: number, ctx: Context): ReactNode {
  const id = typeof node.attrs?.id === 'string' ? node.attrs.id : ''
  if (!id) return null
  const row = ctx.media.get(id)
  const name = row?.name || (typeof node.attrs?.name === 'string' ? node.attrs.name : 'File')

  if (row?.redacted_at) {
    return (
      <p
        key={key}
        className="my-2 rounded-md border border-dashed border-neutral-300 bg-neutral-50 px-3 py-2 text-xs text-neutral-500"
      >
        File removed{row.redacted_by_name ? ` by ${row.redacted_by_name}` : ''}
      </p>
    )
  }

  return (
    <span key={key} className="my-2 block">
      <a
        href={postMediaUrl(id)}
        // A new tab, and no referrer: the route redirects to a signed storage
        // URL, and the page it lands on has no business knowing where it came
        // from. `download` is deliberately absent — the attribute is ignored
        // cross-origin, and the route sets the filename itself.
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex max-w-full items-center gap-2 rounded-md border border-neutral-300 bg-white px-2.5 py-1.5 text-xs text-neutral-800 no-underline transition-colors hover:border-neutral-400 hover:bg-neutral-50"
      >
        <PaperclipGlyph />
        <span className="min-w-0 truncate font-medium">{name}</span>
        {row ? <span className="shrink-0 text-neutral-500">{describeFile(row)}</span> : null}
      </a>
    </span>
  )
}

function PaperclipGlyph() {
  return (
    <svg aria-hidden viewBox="0 0 16 16" className="h-3.5 w-3.5 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
      <path d="M10.5 5.5L6 10a1.8 1.8 0 002.5 2.5l5-5a3.2 3.2 0 00-4.5-4.5l-5.4 5.4a4.6 4.6 0 006.5 6.5l3.4-3.4" />
    </svg>
  )
}

/** "PDF · 240 kB". The type as a person would say it, and a size they can judge. */
function describeFile(row: PostMedia): string {
  const kb = row.byte_size / 1024
  const size = kb < 1 ? '1 kB' : kb < 1024 ? `${Math.round(kb)} kB` : `${(kb / 1024).toFixed(1)} MB`
  return `${FILE_LABELS[row.mime_type] ?? 'File'} · ${size}`
}

/* Named rather than derived from the mime type: "vnd.openxmlformats-
   officedocument.spreadsheetml.sheet" is not a thing to show anybody, and the
   list of types a post may carry is closed and short. */
const FILE_LABELS: Record<string, string> = {
  'application/pdf': 'PDF',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'Word',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'Excel',
  'text/csv': 'CSV',
  'text/plain': 'Text',
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
      /* A message's font and colour. This is the ONE mark carrying values
         chosen by a writer rather than keys chosen by us, so both are checked
         AGAIN here — the database has already refused anything else, and this
         value is about to reach a `style` attribute, which is exactly where
         defence in depth earns its keep. An unknown font or a malformed
         colour is dropped, not drawn: the text still renders, unstyled. */
      case 'textStyle': {
        const style: { fontFamily?: string; color?: string } = {}
        if (isEmailFont(mark.attrs?.fontFamily)) style.fontFamily = mark.attrs.fontFamily
        if (isEmailColour(mark.attrs?.color)) style.color = mark.attrs.color
        // No attributes worth drawing means no wrapper at all.
        if (Object.keys(style).length) out = <span style={style}>{out}</span>
        break
      }
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
