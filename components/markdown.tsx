import type { ReactNode } from 'react'
import { slugify } from '@/supabase/functions/_shared/chunk'

/**
 * The reader for a knowledge-base page: the stored markdown, drawn as React
 * elements and NEVER as raw HTML. Every string from the document lands in a
 * text node; a policy that contained `<img onerror=…>` would show those
 * characters, as the audit trail does for a payload.
 *
 * It understands exactly what the converter writes (`_shared/adf.ts`) —
 * headings, paragraphs, nested lists, GFM tables with `<br>` inside cells,
 * blockquotes, fences, rules, and the inline marks — and nothing more. Not a
 * general markdown engine: the one producer is in this repo.
 *
 * Heading ids come from the same `slugify` the chunker uses, so a search hit's
 * `#anchor` lands on its heading.
 */
export function Markdown({ source }: { source: string }) {
  return <div data-slot="markdown" className="kb-reader">{renderBlocks(source)}</div>
}

const HEADING = /^(#{1,6})\s+(.*\S)\s*$/
const FENCE = /^(`{3,}|~{3,})(\w*)\s*$/
const TABLE_ROW = /^\|.*\|\s*$/
const TABLE_SEP = /^\|(\s*:?-{3,}:?\s*\|)+\s*$/
const LIST_ITEM = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/
const QUOTE = /^>\s?(.*)$/

function renderBlocks(md: string): ReactNode[] {
  const lines = md.replace(/\r\n?/g, '\n').split('\n')
  const out: ReactNode[] = []
  let i = 0
  let key = 0
  while (i < lines.length) {
    const line = lines[i]
    if (line.trim() === '') {
      i += 1
      continue
    }
    const fence = line.match(FENCE)
    if (fence) {
      const open = fence[1]
      const start = i + 1
      i += 1
      while (i < lines.length && !(lines[i].startsWith(open) && lines[i].trim().length === open.length)) i += 1
      out.push(
        <pre key={key++} className="my-3 overflow-x-auto rounded-md bg-neutral-900 p-3 text-[12px] leading-relaxed text-neutral-100">
          <code>{lines.slice(start, i).join('\n')}</code>
        </pre>,
      )
      i += 1
      continue
    }
    const h = line.match(HEADING)
    if (h) {
      const level = h[1].length
      const text = h[2]
      const id = slugify(stripMarks(text))
      const Tag = (`h${Math.min(6, level + 1)}`) as 'h2' | 'h3' | 'h4' | 'h5' | 'h6'
      const cls =
        level <= 2
          ? 'mt-8 mb-3 text-lg font-semibold text-neutral-900 first:mt-0'
          : 'mt-6 mb-2 text-base font-semibold text-neutral-800'
      out.push(
        <Tag key={key++} id={id} className={`${cls} scroll-mt-24`}>
          {renderInline(text)}
        </Tag>,
      )
      i += 1
      continue
    }
    if (line === '---') {
      out.push(<hr key={key++} className="my-6 border-neutral-200" />)
      i += 1
      continue
    }
    if (TABLE_ROW.test(line)) {
      const start = i
      while (i < lines.length && TABLE_ROW.test(lines[i])) i += 1
      out.push(renderTable(lines.slice(start, i), key++))
      continue
    }
    if (LIST_ITEM.test(line)) {
      const start = i
      i += 1
      while (i < lines.length && (LIST_ITEM.test(lines[i]) || /^\s+\S/.test(lines[i]) || (lines[i].trim() === '' && i + 1 < lines.length && LIST_ITEM.test(lines[i + 1])))) i += 1
      out.push(renderList(lines.slice(start, i).filter((l) => l.trim() !== ''), key++))
      continue
    }
    if (QUOTE.test(line)) {
      const start = i
      while (i < lines.length && QUOTE.test(lines[i])) i += 1
      const inner = lines.slice(start, i).map((l) => l.match(QUOTE)![1]).join('\n')
      out.push(
        <blockquote key={key++} className="my-3 rounded-md border-l-2 border-brand/40 bg-brand-50/40 px-4 py-2 text-sm text-neutral-800">
          {renderBlocks(inner)}
        </blockquote>,
      )
      continue
    }
    const start = i
    i += 1
    while (i < lines.length && lines[i].trim() !== '' && !HEADING.test(lines[i]) && !FENCE.test(lines[i]) && !TABLE_ROW.test(lines[i]) && !LIST_ITEM.test(lines[i]) && !QUOTE.test(lines[i])) i += 1
    const text = lines.slice(start, i).join('\n')
    out.push(
      <p key={key++} className="my-3 text-sm leading-relaxed text-neutral-800">
        {renderInline(text)}
      </p>,
    )
  }
  return out
}

type Item = { marker: string; text: string; children: string[] }

/** Items at the shallowest indent, each carrying its indented lines. */
function renderList(lines: string[], key: number): ReactNode {
  const items: Item[] = []
  const base = Math.min(...lines.map((l) => l.match(/^\s*/)![0].length))
  for (const l of lines) {
    const m = l.match(LIST_ITEM)
    if (m && m[1].length === base) items.push({ marker: m[2], text: m[3], children: [] })
    else if (items.length) items[items.length - 1].children.push(l)
  }
  const ordered = /^\d/.test(items[0]?.marker ?? '-')
  const Tag = ordered ? 'ol' : 'ul'
  return (
    <Tag key={key} className={`my-3 flex flex-col gap-1 pl-5 text-sm leading-relaxed text-neutral-800 ${ordered ? 'list-decimal' : 'list-disc'}`}>
      {items.map((it, i) => {
        const task = it.text.match(/^\[( |x)\]\s+(.*)$/)
        return (
          <li key={i}>
            {task ? (
              <span className="inline-flex items-start gap-1.5">
                <span aria-hidden className="select-none text-neutral-400">{task[1] === 'x' ? '☑' : '☐'}</span>
                <span>{renderInline(task[2])}</span>
              </span>
            ) : (
              renderInline(it.text)
            )}
            {it.children.length ? renderBlocks(it.children.map((c) => c.replace(new RegExp(`^\\s{0,${base + it.marker.length + 1}}`), '')).join('\n')) : null}
          </li>
        )
      })}
    </Tag>
  )
}

function cells(line: string): string[] {
  return line
    .replace(/^\|/, '')
    .replace(/\|\s*$/, '')
    .split(/(?<!\\)\|/)
    .map((c) => c.replace(/\\\|/g, '|').trim())
}

function renderTable(lines: string[], key: number): ReactNode {
  const hasHeader = lines.length >= 2 && TABLE_SEP.test(lines[1])
  const header = hasHeader ? cells(lines[0]) : null
  const rows = (hasHeader ? lines.slice(2) : lines).map(cells)
  const blankHeader = header !== null && header.every((h) => h === '')
  return (
    <div key={key} className="my-4 overflow-x-auto">
      <table className="w-full border-collapse text-sm">
        {header && !blankHeader ? (
          <thead>
            <tr>
              {header.map((h, i) => (
                <th key={i} className="border border-neutral-200 bg-neutral-50 px-3 py-1.5 text-left align-top text-xs font-semibold text-neutral-700">
                  {renderCell(h)}
                </th>
              ))}
            </tr>
          </thead>
        ) : null}
        <tbody>
          {rows.map((r, ri) => (
            <tr key={ri}>
              {r.map((c, ci) => (
                <td key={ci} className="border border-neutral-200 px-3 py-1.5 align-top leading-relaxed text-neutral-800">
                  {renderCell(c)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/** A cell's lines, `<br>`-separated by the converter; bullets stay as text. */
function renderCell(text: string): ReactNode {
  const parts = text.split('<br>')
  return parts.map((p, i) => (
    <span key={i}>
      {i > 0 ? <br /> : null}
      {renderInline(p)}
    </span>
  ))
}

function stripMarks(s: string): string {
  return s.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/(\*\*|\*|`|~~)/g, '').replace(/\\(.)/g, '$1')
}

/**
 * Inline marks, by a small tokenizer rather than nested regex replacement, so
 * an escaped character is exactly that character and a `*` inside a code span
 * is a star. Recognised, in order: escape, line break, code span, link, then
 * the paired marks `**`, `~~`, `*`; a mark with no closing partner is text.
 */
export function renderInline(text: string): ReactNode[] {
  const out: ReactNode[] = []
  let buf = ''
  let key = 0
  const flush = () => {
    if (buf) out.push(buf)
    buf = ''
  }
  let i = 0
  while (i < text.length) {
    const ch = text[i]
    if (ch === '\\' && i + 1 < text.length) {
      buf += text[i + 1]
      i += 2
      continue
    }
    if (ch === '\n') {
      flush()
      out.push(<br key={key++} />)
      i += 1
      continue
    }
    if (ch === '`') {
      const end = text.indexOf('`', i + 1)
      if (end > i) {
        flush()
        out.push(
          <code key={key++} className="rounded bg-neutral-100 px-1 py-0.5 font-mono text-[12px] text-neutral-800">
            {text.slice(i + 1, end)}
          </code>,
        )
        i = end + 1
        continue
      }
    }
    if (ch === '[') {
      const m = text.slice(i).match(/^\[((?:\\.|[^\]\\])*)\]\(([^)\s]+)\)/)
      if (m) {
        flush()
        const href = m[2]
        const external = /^https?:\/\//i.test(href) || /^mailto:/i.test(href)
        out.push(
          <a
            key={key++}
            href={href}
            {...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
            className="text-brand underline decoration-brand/30 underline-offset-2 hover:decoration-brand"
          >
            {renderInline(m[1])}
          </a>,
        )
        i += m[0].length
        continue
      }
    }
    const paired = pairedMark(text, i)
    if (paired) {
      flush()
      const { mark, end } = paired
      const Tag = mark === '**' ? 'strong' : mark === '~~' ? 's' : 'em'
      const cls = mark === '**' ? 'font-semibold text-neutral-900' : mark === '*' ? 'italic' : ''
      out.push(
        <Tag key={key++} className={cls}>
          {renderInline(text.slice(i + mark.length, end))}
        </Tag>,
      )
      i = end + mark.length
      continue
    }
    buf += ch
    i += 1
  }
  flush()
  return out
}

/** The mark opening at `i` and where it closes, or null when it is just text. */
function pairedMark(text: string, i: number): { mark: string; end: number } | null {
  for (const mark of ['**', '~~', '*']) {
    if (!text.startsWith(mark, i)) continue
    const end = text.indexOf(mark, i + mark.length)
    return end > i + mark.length ? { mark, end } : null
  }
  return null
}

/**
 * The headings of a document, for the reader's "On this page" column.
 *
 * It walks the source with the SAME regexes and the same fence handling as
 * `renderBlocks`, and slugifies through the same `stripMarks`, because the
 * whole value of the list is that every entry's `#id` lands on a heading that
 * exists. A second, looser scanner — `/^#{2,3} /` over the raw string, say —
 * would silently list a `## ` inside a fenced block and link nowhere.
 *
 * Levels 1 and 2 are both top-level: the chunker's breadcrumb treats them that
 * way, and a policy converted from ADF opens at `##` with no `#` above it.
 */
export function outline(md: string): { id: string; text: string; depth: 0 | 1 }[] {
  const lines = md.replace(/\r\n?/g, '\n').split('\n')
  const out: { id: string; text: string; depth: 0 | 1 }[] = []
  let i = 0
  while (i < lines.length) {
    const fence = lines[i].match(FENCE)
    if (fence) {
      const open = fence[1]
      i += 1
      while (i < lines.length && !(lines[i].startsWith(open) && lines[i].trim().length === open.length)) i += 1
      i += 1
      continue
    }
    const h = lines[i].match(HEADING)
    if (h && h[1].length <= 3) {
      const text = stripMarks(h[2]).trim()
      if (text) out.push({ id: slugify(text), text, depth: h[1].length <= 2 ? 0 : 1 })
    }
    i += 1
  }
  return out
}
