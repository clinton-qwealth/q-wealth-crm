/**
 * Markdown → the passages a policy is searched and embedded by.
 *
 * Pure, no imports: `kb-prepare` runs it in Deno and `__tests__/kb-chunk.test.ts`
 * runs it in vitest against every real page, and they must be the same code —
 * a chunker's whole value is in its edge cases, and an untested edge case is a
 * recall hole nobody files a bug about.
 *
 * ## Why this is not SQL
 *
 * `regexp_split_to_table(md, E'\n(?=## )')` splits a policy correctly, and it
 * was probed to. It still has no test harness here, cannot tell a `##` inside a
 * fenced code block from a heading, and cannot re-emit a table's header when
 * the table has to be split. And promote() should hold the CRM's rules, not a
 * parser.
 *
 * ## The cap is a token budget wearing a character count
 *
 * gte-small reads 512 tokens and TRUNCATES SILENTLY past them. Prose runs about
 * four characters a token; a markdown table — pipes, dashes, short cells — can
 * run at two and a half. So the cap is 1,100 characters, not 2,000: a 2,000
 * character table chunk would be embedded by its first half and returned by
 * its whole, which is a recall hole precisely on the table-heavy compliance
 * pages that matter most. Every chunk is CHECKED against the cap, and a chunk
 * over it THROWS — failing the run beats a quietly truncated vector.
 *
 * ## Shape
 *
 * Split at `##`, then `###`, then blank lines. Blocks are packed greedily into
 * chunks under the cap; a block that cannot fit alone is split by its own
 * structure — a table on row boundaries with its header re-emitted, a list on
 * items, a paragraph on sentences and finally on words, a fence on lines — and
 * a prose split carries its last sentence into the next piece so a rule that
 * straddles the cut is whole on at least one side. Every chunk is prefixed
 * `"{title} › {heading path}\n\n"`, so the breadcrumb is in the tsvector and
 * the embedding alike, and a heading that heads an empty section heads nothing.
 */

export const CHUNK_CAP = 1100

/** The share of the cap a forced prose split repeats into its neighbour. */
const OVERLAP = Math.floor(CHUNK_CAP * 0.15)

export type Chunk = {
  /** 0-based position within the document. */
  ordinal: number
  /** The headings above this passage, outermost first. Empty above the first heading. */
  headingPath: string[]
  /** The `id` the reader gives the deepest heading, for a deep link. Null above the first heading. */
  anchor: string | null
  /** "{title} › {heading path}" — the line the content begins with, kept apart
   *  so the database can weight it above the passage in the tsvector. */
  breadcrumb: string
  /** The passage, prefixed with its breadcrumb and a blank line. */
  content: string
}

export type ChunkMeta = { title: string }

type Block = { kind: 'para' | 'table' | 'list' | 'fence' | 'quote'; text: string; path: string[] }

export function chunk(markdown: string, meta: ChunkMeta, cap: number = CHUNK_CAP): Chunk[] {
  const blocks = parse(markdown)
  const out: Chunk[] = []

  let path: string[] | null = null
  let buffer: string[] = []
  let bufferLen = 0

  const breadcrumbFor = (p: string[]) => (p.length ? `${meta.title} › ${p.join(' › ')}` : meta.title)
  const prefixFor = (p: string[]) => `${breadcrumbFor(p)}\n\n`

  const flush = () => {
    if (path === null || buffer.length === 0) return
    const content = prefixFor(path) + buffer.join('\n\n')
    out.push({ ordinal: out.length, headingPath: path, anchor: anchorFor(path), breadcrumb: breadcrumbFor(path), content })
    buffer = []
    bufferLen = 0
  }

  for (const b of blocks) {
    if (path === null || !samePath(path, b.path)) {
      flush()
      path = b.path
    }
    const budget = cap - prefixFor(b.path).length
    // A short lead — "Ensure your advice process captures the following:" —
    // belongs with the list it introduces. When the buffer is only such a
    // lead and the next block must be split anyway, the split is made to a
    // budget that leaves room for the lead, so it heads the first piece
    // rather than standing alone as a chunk that says nothing.
    const leadLen = buffer.length ? bufferLen + 2 : 0
    const shortLead = buffer.length > 0 && bufferLen < budget * 0.25
    const pieces =
      b.text.length <= budget - leadLen
        ? [b.text]
        : balanced(b, shortLead ? budget - leadLen : budget)
    for (const piece of pieces) {
      const sep = buffer.length ? 2 : 0
      if (buffer.length && bufferLen + sep + piece.length > budget) flush()
      buffer.push(piece)
      bufferLen += (buffer.length > 1 ? 2 : 0) + piece.length
    }
  }
  flush()

  for (const c of out) {
    if (c.content.length > cap) {
      throw new Error(`chunk ${c.ordinal} of "${meta.title}" is ${c.content.length} characters, over the cap of ${cap}`)
    }
  }
  return out
}

/**
 * The `id` the reader puts on a heading: lower-cased words joined by hyphens,
 * so `/help/{page}#the-seven-steps` lands on "## The seven steps". Shared with
 * the reader by import, not by a second copy.
 */
export function slugify(heading: string): string {
  return heading
    .toLowerCase()
    .replace(/[*_`\\]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
}

function anchorFor(path: string[]): string | null {
  return path.length ? slugify(path[path.length - 1]) : null
}

function samePath(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((s, i) => s === b[i])
}

// ---------------------------------------------------------------------------
// Parsing: lines → blocks with a heading path
// ---------------------------------------------------------------------------

const HEADING = /^(#{1,6})\s+(.*\S)\s*$/
const FENCE = /^(`{3,}|~{3,})/
const TABLE_ROW = /^\|.*\|\s*$/
const TABLE_SEP = /^\|(\s*:?-{3,}:?\s*\|)+\s*$/
const LIST_ITEM = /^(\s*)([-*+]|\d+[.)])\s+/
const QUOTE = /^>/

function parse(md: string): Block[] {
  const lines = md.replace(/\r\n?/g, '\n').split('\n')
  const blocks: Block[] = []
  // One slot per heading level; a level-2 heading clears levels 3–6.
  const stack: string[] = []
  const path = () => stack.filter((s) => s !== undefined && s !== '')

  let i = 0
  while (i < lines.length) {
    const line = lines[i]

    if (line.trim() === '') {
      i += 1
      continue
    }

    const fence = line.match(FENCE)
    if (fence) {
      const open = fence[1]
      const start = i
      i += 1
      while (i < lines.length && !(lines[i].startsWith(open[0].repeat(open.length)) && lines[i].trim().length === open.length)) i += 1
      i = Math.min(i + 1, lines.length)
      blocks.push({ kind: 'fence', text: lines.slice(start, i).join('\n'), path: path() })
      continue
    }

    const h = line.match(HEADING)
    if (h) {
      const level = h[1].length
      stack.length = level - 1
      stack[level - 1] = stripInline(h[2])
      i += 1
      continue
    }

    if (TABLE_ROW.test(line)) {
      const start = i
      while (i < lines.length && TABLE_ROW.test(lines[i])) i += 1
      blocks.push({ kind: 'table', text: lines.slice(start, i).join('\n'), path: path() })
      continue
    }

    if (LIST_ITEM.test(line)) {
      const start = i
      i += 1
      // A list runs until a blank line followed by a non-indented, non-item
      // line; continuation lines are indented under their marker.
      while (i < lines.length) {
        if (lines[i].trim() === '') {
          if (i + 1 < lines.length && (LIST_ITEM.test(lines[i + 1]) || /^\s{2,}\S/.test(lines[i + 1]))) {
            i += 1
            continue
          }
          break
        }
        if (LIST_ITEM.test(lines[i]) || /^\s+\S/.test(lines[i])) {
          i += 1
          continue
        }
        break
      }
      blocks.push({ kind: 'list', text: lines.slice(start, i).join('\n').replace(/\n+$/, ''), path: path() })
      continue
    }

    if (QUOTE.test(line)) {
      const start = i
      while (i < lines.length && QUOTE.test(lines[i])) i += 1
      blocks.push({ kind: 'quote', text: lines.slice(start, i).join('\n'), path: path() })
      continue
    }

    // A paragraph: up to the next blank line or the start of another structure.
    const start = i
    i += 1
    while (
      i < lines.length &&
      lines[i].trim() !== '' &&
      !HEADING.test(lines[i]) &&
      !FENCE.test(lines[i]) &&
      !TABLE_ROW.test(lines[i]) &&
      !LIST_ITEM.test(lines[i]) &&
      !QUOTE.test(lines[i])
    ) i += 1
    blocks.push({ kind: 'para', text: lines.slice(start, i).join('\n'), path: path() })
  }
  return blocks
}

/** A heading's words, without the emphasis marks the converter may have put on them. */
function stripInline(s: string): string {
  return s
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/(\*\*|__|\*|_|`|~~)/g, '')
    .replace(/\\([*_`[\]<>#+.)-])/g, '$1')
    .trim()
}

// ---------------------------------------------------------------------------
// Splitting a block that cannot fit
// ---------------------------------------------------------------------------

/**
 * Split, then even out. A greedy split fills every piece to the budget and
 * leaves the remainder — "- File notes to record all conversations." alone in
 * a chunk of eighty characters. If the same number of pieces can be had at a
 * smaller budget, they are taken, so the pieces are of a size; if it cannot,
 * the greedy split stands.
 */
function balanced(b: Block, budget: number): string[] {
  const first = split(b, budget)
  if (first.length < 2) return first
  const target = Math.min(budget, Math.max(Math.floor(budget * 0.6), Math.ceil(b.text.length / first.length) + 80))
  if (target >= budget) return first
  const again = split(b, target)
  return again.length === first.length ? again : first
}

function split(b: Block, budget: number): string[] {
  switch (b.kind) {
    case 'table':
      return splitTable(b.text, budget)
    case 'list':
      return splitList(b.text, budget)
    case 'fence':
      return splitLines(b.text, budget)
    case 'quote':
      return splitLines(b.text, budget)
    default:
      return splitProse(b.text, budget)
  }
}

/**
 * A table on row boundaries, the header and separator re-emitted at the top
 * of every piece, so no piece is a run of cells with nothing to say what the
 * columns are.
 *
 * A single row wider than the budget on its own — the Best Interests Policy's
 * "Step 5" cell is 1,400 characters of prose — cannot stay a row. It becomes
 * labelled prose, `**Column:** cell text` a paragraph per cell with the row's
 * bullets restored to lines, and is then split as prose. The words are all
 * kept and each carries its column's name; only the grid is given up, for that
 * row, in the passage. The reader still shows the table whole.
 */
function splitTable(text: string, budget: number): string[] {
  const lines = text.split('\n')
  const hasHeader = lines.length >= 2 && TABLE_SEP.test(lines[1])
  const header = hasHeader ? lines.slice(0, 2) : []
  const rows = hasHeader ? lines.slice(2) : lines
  const headerCells = hasHeader ? cells(lines[0]) : []
  const pieces: string[] = []
  let cur: string[] = []
  const len = (ls: string[]) => ls.join('\n').length
  const flush = () => {
    if (cur.length) pieces.push([...header, ...cur].join('\n'))
    cur = []
  }
  for (const row of rows) {
    if (len([...header, row]) > budget) {
      flush()
      pieces.push(...splitProse(rowAsProse(headerCells, cells(row)), budget))
      continue
    }
    if (cur.length && len([...header, ...cur, row]) > budget) flush()
    cur.push(row)
  }
  flush()
  return pieces
}

/** The cells of a `| a | b |` line, unescaped. */
function cells(line: string): string[] {
  return line
    .replace(/^\|/, '')
    .replace(/\|\s*$/, '')
    .split(/(?<!\\)\|/)
    .map((c) => c.replace(/\\\|/g, '|').trim())
}

function rowAsProse(headerCells: string[], rowCells: string[]): string {
  const paras: string[] = []
  rowCells.forEach((cell, i) => {
    if (!cell) return
    const body = cell
      .split('<br>')
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s) => (s.startsWith('• ') ? `- ${s.slice(2)}` : s))
      .join('\n')
    const label = headerCells[i]?.replace(/^\*\*|\*\*$/g, '').trim()
    paras.push(label ? `**${label}:** ${body}` : body)
  })
  return paras.join('\n\n')
}

/** A list on its top-level items, a nested item staying with its parent. */
function splitList(text: string, budget: number): string[] {
  const lines = text.split('\n')
  const items: string[][] = []
  for (const line of lines) {
    const m = line.match(LIST_ITEM)
    if (m && m[1].length === 0) items.push([line])
    else if (items.length) items[items.length - 1].push(line)
    else items.push([line])
  }
  const pieces: string[] = []
  let cur: string[] = []
  for (const item of items) {
    const itemText = item.join('\n')
    const candidate = [...cur, itemText].join('\n')
    if (cur.length && candidate.length > budget) {
      pieces.push(cur.join('\n'))
      cur = []
    }
    if (itemText.length > budget) {
      // One item longer than a chunk: prose-split its text.
      if (cur.length) {
        pieces.push(cur.join('\n'))
        cur = []
      }
      pieces.push(...splitProse(itemText, budget))
      continue
    }
    cur.push(itemText)
  }
  if (cur.length) pieces.push(cur.join('\n'))
  return pieces
}

function splitLines(text: string, budget: number): string[] {
  const pieces: string[] = []
  let cur = ''
  for (const line of text.split('\n')) {
    const candidate = cur ? `${cur}\n${line}` : line
    if (cur && candidate.length > budget) {
      pieces.push(cur)
      cur = line
    } else {
      cur = candidate
    }
  }
  if (cur) pieces.push(cur)
  return pieces
}

/**
 * Prose on sentence ends, then on whitespace. Each piece after the first
 * begins with the tail of the one before it — up to OVERLAP characters, cut at
 * a sentence or word boundary — so a rule split mid-thought is whole somewhere.
 */
function splitProse(text: string, budget: number): string[] {
  const sentences = text.match(/[^.!?\n]+[.!?]+["’”)]?\s*|[^.!?\n]+\n?|\n/g) ?? [text]
  const units: string[] = []
  for (const s of sentences) {
    if (s.length <= budget) units.push(s)
    else units.push(...splitWords(s, budget))
  }
  const pieces: string[] = []
  let cur = ''
  for (const u of units) {
    if (cur && cur.length + u.length > budget) {
      pieces.push(cur.replace(/\s+$/, ''))
      cur = overlapTail(cur) + u
    } else {
      cur += u
    }
  }
  if (cur.trim()) pieces.push(cur.replace(/\s+$/, ''))
  return pieces
}

function overlapTail(s: string): string {
  const tail = s.slice(-OVERLAP)
  const at = tail.search(/(?<=[.!?]["’”)]?)\s+\S/)
  const cut = at >= 0 ? tail.slice(at).replace(/^\s+/, '') : tail.replace(/^\S*\s+/, '')
  return cut ? cut.replace(/\s+$/, '') + ' ' : ''
}

function splitWords(s: string, budget: number): string[] {
  const words = s.split(/(\s+)/)
  const pieces: string[] = []
  let cur = ''
  for (const w of words) {
    if (cur && cur.length + w.length > budget) {
      pieces.push(cur)
      cur = w.trimStart()
    } else {
      cur += w
    }
  }
  if (cur) pieces.push(cur)
  return pieces
}
