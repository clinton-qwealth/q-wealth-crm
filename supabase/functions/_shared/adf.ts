/**
 * Atlassian Document Format → Markdown.
 *
 * Confluence's REST API does not serve markdown. `body-format` may be
 * `storage` (XHTML), `atlas_doc_format` (this), `view`, `export_view`,
 * `editor` or `wiki` — the markdown the Atlassian MCP hands Claude is that
 * server's own conversion, and n8n's Confluence node offers only
 * `atlas_doc_format | plainText | storage`. So the conversion is ours, and it
 * lives here: a pure module with no imports, so the edge function that runs it
 * and the vitest suite that pins it against the real pages import one file.
 *
 * What it is for decides what it keeps. The output is indexed (tsvector),
 * embedded (gte-small, 512 tokens) and shown in the CRM's own reader — so it
 * favours plain prose over faithful markup: an image becomes a note, a status
 * lozenge its word, a panel a blockquote. Nothing is dropped silently: a node
 * type this file does not know is rendered as its children plus a marker, and
 * named in `unsupported`, so the sync can record it rather than nobody noticing
 * that a new Confluence macro has been eating a policy's text.
 *
 * The vocabulary handled below is the one measured across all 28 pages of the
 * OPERATIONS space on 22 Sep 2026 (`__tests__/fixtures/kb/*.adf.json`), plus
 * the common ADF nodes those pages happen not to use yet.
 */

export type AdfMark = { type: string; attrs?: Record<string, unknown> }
export type AdfNode = {
  type: string
  attrs?: Record<string, unknown>
  content?: AdfNode[]
  marks?: AdfMark[]
  text?: string
}

export type AdfConversion = {
  markdown: string
  /** Node types met that this converter has no rule for, deduplicated. */
  unsupported: string[]
}

type Ctx = {
  unsupported: Set<string>
  /** Inside a table cell: no block structure, so breaks become `<br>` and
   *  blocks are joined on one line. */
  inCell: boolean
}

export function adfToMarkdown(doc: AdfNode): AdfConversion {
  const ctx: Ctx = { unsupported: new Set(), inCell: false }
  const body = blocks(doc.content ?? [], ctx)
  return { markdown: body.trim() + '\n', unsupported: [...ctx.unsupported].sort() }
}

// ---------------------------------------------------------------------------
// Blocks
// ---------------------------------------------------------------------------

/** Render sibling blocks, one blank line between them, dropping the empties. */
function blocks(nodes: AdfNode[], ctx: Ctx): string {
  const out: string[] = []
  for (const n of nodes) {
    const s = block(n, ctx)
    if (s.trim().length > 0) out.push(s.replace(/\s+$/, ''))
  }
  return out.join(ctx.inCell ? '<br>' : '\n\n')
}

function block(n: AdfNode, ctx: Ctx): string {
  switch (n.type) {
    case 'paragraph': {
      const text = inlines(n.content ?? [], ctx)
      return ctx.inCell ? text : escapeLineStarts(text)
    }
    case 'heading': {
      const level = Math.min(6, Math.max(1, Number(n.attrs?.level ?? 2)))
      const text = inlines(n.content ?? [], ctx).trim()
      if (!text) return ''
      // A heading inside a table cell cannot be a heading; the emphasis keeps
      // the intent without breaking the row.
      return ctx.inCell ? `**${text}**` : `${'#'.repeat(level)} ${text}`
    }
    case 'bulletList':
      return list(n.content ?? [], ctx, () => '-')
    case 'orderedList': {
      const start = Number(n.attrs?.order ?? 1)
      return list(n.content ?? [], ctx, (i) => `${start + i}.`)
    }
    case 'taskList':
      return list(n.content ?? [], ctx, (_i, item) =>
        `- [${item.attrs?.state === 'DONE' ? 'x' : ' '}]`)
    case 'decisionList':
      return list(n.content ?? [], ctx, () => '- ✓')
    case 'table':
      return table(n, ctx)
    case 'panel':
    case 'blockquote':
      return quote(blocks(n.content ?? [], ctx), ctx)
    case 'expand':
    case 'nestedExpand': {
      const title = typeof n.attrs?.title === 'string' ? n.attrs.title.trim() : ''
      const inner = blocks(n.content ?? [], ctx)
      return title ? `**${escapeText(title)}**\n\n${inner}` : inner
    }
    case 'layoutSection':
    case 'layoutColumn':
    case 'bodiedExtension':
      return blocks(n.content ?? [], ctx)
    case 'rule':
      return ctx.inCell ? '' : '---'
    case 'codeBlock': {
      const lang = typeof n.attrs?.language === 'string' ? n.attrs.language : ''
      const code = (n.content ?? []).map((t) => t.text ?? '').join('')
      if (ctx.inCell) return '`' + code.replace(/\s+/g, ' ').trim() + '`'
      // A fence longer than any run of backticks in the code, so the code can
      // hold a fence of its own.
      const longest = Math.max(2, ...[...code.matchAll(/`+/g)].map((m) => m[0].length))
      const fence = '`'.repeat(longest + 1)
      return `${fence}${lang}\n${code}\n${fence}`
    }
    case 'mediaSingle':
    case 'mediaGroup':
    case 'mediaInline':
      return media(n)
    case 'media':
      return media({ type: 'mediaSingle', content: [n] })
    case 'extension':
    case 'inlineExtension': {
      // A macro. Its `text` attribute, when Confluence supplies one, is the
      // closest thing to what a reader saw.
      const key = typeof n.attrs?.extensionKey === 'string' ? n.attrs.extensionKey : 'macro'
      const text = typeof n.attrs?.text === 'string' ? n.attrs.text.trim() : ''
      ctx.unsupported.add(`extension:${key}`)
      return text ? `${escapeText(text)} *(${key})*` : `*(unsupported content: ${key})*`
    }
    case 'listItem':
    case 'taskItem':
    case 'decisionItem':
      // Reached only outside a list — malformed, but render the content.
      return blocks(n.content ?? [], ctx)
    case 'tableRow':
    case 'tableCell':
    case 'tableHeader':
      return blocks(n.content ?? [], ctx)
    default: {
      // Inline nodes can appear where a block was expected (a bare `text`
      // under `doc` is legal enough for the editor to produce).
      if (isInline(n)) return inlines([n], ctx)
      ctx.unsupported.add(n.type)
      const inner = blocks(n.content ?? [], ctx)
      return inner ? `${inner}\n\n*(unsupported content: ${n.type})*` : `*(unsupported content: ${n.type})*`
    }
  }
}

function quote(inner: string, ctx: Ctx): string {
  if (!inner) return ''
  if (ctx.inCell) return inner
  return inner
    .split('\n')
    .map((line) => (line.length ? `> ${line}` : '>'))
    .join('\n')
}

function media(n: AdfNode): string {
  const first = (n.content ?? []).find((c) => c.type === 'media') ?? n
  const alt = typeof first.attrs?.alt === 'string' ? first.attrs.alt.trim() : ''
  return alt ? `*(image: ${escapeText(alt)})*` : '*(image)*'
}

/**
 * A list. The first paragraph of an item sits on the marker's line; everything
 * else in the item — a nested list, a second paragraph — is indented under it
 * by the marker's width, which is what makes the nesting real in markdown.
 */
function list(items: AdfNode[], ctx: Ctx, marker: (i: number, item: AdfNode) => string): string {
  if (ctx.inCell) {
    // No line structure inside a cell: "• one • two".
    return items
      .map((item) => '• ' + blocks(item.content ?? [], ctx).replace(/<br>/g, ' '))
      .join('<br>')
  }
  const lines: string[] = []
  items.forEach((item, i) => {
    const m = marker(i, item)
    const pad = ' '.repeat(m.length + 1)
    const children = item.content ?? []
    // taskItem / decisionItem hold inline content directly.
    const inlineOnly = children.every(isInline)
    if (inlineOnly) {
      lines.push(`${m} ${inlines(children, ctx).trim()}`)
      return
    }
    const [head, ...rest] = children
    const headText = head?.type === 'paragraph' ? inlines(head.content ?? [], ctx).trim() : ''
    const tail = headText ? rest : children
    lines.push(`${m} ${headText || ''}`.replace(/\s+$/, ''))
    const inner = blocks(tail, ctx)
    if (inner) {
      lines.push(inner.split('\n').map((l) => (l.length ? pad + l : l)).join('\n'))
    }
  })
  return lines.join('\n')
}

/**
 * A GFM table. The header row is the first row when every cell in it is a
 * `tableHeader`; otherwise a blank header is synthesised, because GFM has no
 * table without one and the first data row is not a heading just because it
 * comes first. A spanned cell is followed by its span's worth of empty cells so
 * every row has the same count; rows spanning down are not reproduced.
 */
function table(n: AdfNode, ctx: Ctx): string {
  const rows = (n.content ?? []).filter((r) => r.type === 'tableRow')
  if (rows.length === 0) return ''
  const cellCtx: Ctx = { unsupported: ctx.unsupported, inCell: true }
  const firstIsHeader = (rows[0].content ?? []).length > 0 && (rows[0].content ?? []).every((c) => c.type === 'tableHeader')
  const rendered = rows.map((r, ri) => {
    const cells: string[] = []
    for (const c of r.content ?? []) {
      let text = blocks(c.content ?? [], cellCtx).replace(/\|/g, '\\|').replace(/\n/g, ' ').trim()
      // A header cell in a body row is the row's label — "Document ID | SOP-001"
      // — and reads as one when it is bold.
      if (c.type === 'tableHeader' && !(firstIsHeader && ri === 0) && text && !/^\*\*.*\*\*$/.test(text)) text = `**${text}**`
      cells.push(text)
      const span = Math.max(1, Number(c.attrs?.colspan ?? 1))
      for (let i = 1; i < span; i += 1) cells.push('')
    }
    return cells
  })
  const width = Math.max(...rendered.map((r) => r.length))
  const pad = (r: string[]) => [...r, ...Array(width - r.length).fill('')]
  const line = (r: string[]) => `| ${pad(r).join(' | ')} |`
  const sep = `| ${Array(width).fill('---').join(' | ')} |`
  const out: string[] = []
  if (firstIsHeader) {
    out.push(line(rendered[0]), sep, ...rendered.slice(1).map(line))
  } else {
    out.push(line(Array(width).fill('')), sep, ...rendered.map(line))
  }
  if (ctx.inCell) return out.join(' ')
  return out.join('\n')
}

// ---------------------------------------------------------------------------
// Inlines
// ---------------------------------------------------------------------------

const INLINE = new Set(['text', 'hardBreak', 'mention', 'emoji', 'date', 'status', 'inlineCard', 'placeholder', 'inlineExtension'])

function isInline(n: AdfNode): boolean {
  return INLINE.has(n.type)
}

function inlines(nodes: AdfNode[], ctx: Ctx): string {
  let out = ''
  for (const n of nodes) out += inline(n, ctx)
  // A paragraph that begins with a hard break (the policies do this after the
  // licence panel) begins with nothing.
  return out.replace(/^(\s*<br>\s*|\s*\n\s*)+/, '').replace(/[ \t]+$/gm, '')
}

function inline(n: AdfNode, ctx: Ctx): string {
  switch (n.type) {
    case 'text':
      return marked(n.text ?? '', n.marks ?? [])
    case 'hardBreak':
      return ctx.inCell ? '<br>' : '\n'
    case 'mention':
      return escapeText(String(n.attrs?.text ?? '@someone'))
    case 'emoji':
      return String(n.attrs?.text ?? n.attrs?.shortName ?? '')
    case 'date': {
      const ts = Number(n.attrs?.timestamp)
      return Number.isFinite(ts) ? new Date(ts).toISOString().slice(0, 10) : ''
    }
    case 'status':
      return escapeText(String(n.attrs?.text ?? '').trim())
    case 'inlineCard': {
      const url = typeof n.attrs?.url === 'string' ? n.attrs.url : ''
      return url ? `[${url}](${url})` : ''
    }
    case 'placeholder':
      return ''
    case 'inlineExtension':
      return block(n, ctx)
    default:
      if (n.content) return inlines(n.content, ctx)
      ctx.unsupported.add(n.type)
      return ''
  }
}

/**
 * Text with its marks. Emphasis cannot wrap whitespace in markdown —
 * `**Financial Advice Co Pty Ltd **` renders the asterisks — and Confluence
 * puts the space inside the mark routinely, so the whitespace is lifted out
 * and the mark closes on the word.
 */
function marked(raw: string, marks: AdfMark[]): string {
  const lead = raw.match(/^\s*/)?.[0] ?? ''
  const trail = raw.match(/\s*$/)?.[0] ?? ''
  const core = raw.slice(lead.length, raw.length - trail.length)
  if (!core) return raw
  const isCode = marks.some((m) => m.type === 'code')
  let text = isCode ? '`' + core.replace(/`/g, '’') + '`' : escapeText(core)
  for (const m of marks) {
    switch (m.type) {
      case 'strong':
        text = `**${text}**`
        break
      case 'em':
        text = `*${text}*`
        break
      case 'strike':
        text = `~~${text}~~`
        break
      case 'link': {
        const href = typeof m.attrs?.href === 'string' ? m.attrs.href : ''
        if (href) text = `[${text}](${href.replace(/[()\s]/g, encodeURIComponent)})`
        break
      }
      // underline, textColor, subsup, indentation, alignment, backgroundColor,
      // annotation: presentation only; the words are what is kept.
      default:
        break
    }
  }
  return lead + text + trail
}

/**
 * The characters that would otherwise be read as markup. Kept to the few that
 * occur in prose — the text is also indexed and embedded, and `\_` in a
 * tsvector is a worse outcome than a stray underscore in the reader.
 */
export function escapeText(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/([*_`[\]<>])/g, '\\$1')
}

/**
 * A paragraph line that would otherwise open a heading, rule or list item:
 * `# not a heading`, `- not an item`, `1. not an item`. Applied to a rendered
 * paragraph, not to raw text, so a heading's own "7. Procedure" is left alone
 * and a cell's content — inline by construction — is never touched.
 */
export function escapeLineStarts(s: string): string {
  return s
    .replace(/^(\s*)([#+-])(?=\s)/gm, '$1\\$2')
    .replace(/^(\s*)(\d+)([.)])(?=\s)/gm, '$1$2\\$3')
}
