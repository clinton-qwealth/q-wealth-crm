/**
 * The knowledge base, as the /help screen reads it.
 *
 * Pure: types and small helpers, no Supabase and no `next/headers`, so the
 * client component that streams an answer can import it — the same split
 * `lib/audit.ts` keeps for the trail.
 */

/** A passage an answer drew on, as `kb-ask` numbered it. */
export type KbCitation = {
  n: number
  document_id: string
  page_id: string
  title: string
  heading_path: string[]
  anchor: string | null
  version: number
  excerpt: string
}

export type KbMessage = {
  id: string
  role: 'user' | 'assistant'
  content: string
  /** The fixed sentence given without a model call. */
  refused: boolean
  model: string | null
  /** Only the passages the answer actually cited, in citation order. */
  citations: KbCitation[]
  /** Still streaming in. */
  pending?: boolean
}

export type KbConversationSummary = { id: string; title: string; updated_at: string }

/** What `kb-ask` streams back, one JSON object per line. */
export type KbAskEvent =
  | { type: 'meta'; conversation_id: string; citations: KbCitation[] }
  | { type: 'delta'; text: string }
  | { type: 'done'; message_id: string | null; refused: boolean; cited: number[]; model?: string }
  | { type: 'error'; message: string }

export const REFUSAL = "Our policies don't appear to cover this. Ask the compliance manager."

/**
 * What the box says above the question. Load-bearing rather than decorative:
 * this is the first place the CRM sends text to an external AI service, and the
 * knowledge base holds no client data — so the only way a client's details
 * could leave is by somebody typing them here.
 */
export const ASK_NOTE =
  'Ask what the firm’s policies and procedures say. The question and the passages it matches are ' +
  'sent to Claude, so don’t include client names or details. Answers summarise written policy; ' +
  'they are not advice.'

/** Into the CRM's own reader, at the heading the passage sits under. */
export function citationHref(c: Pick<KbCitation, 'page_id' | 'anchor'>): string {
  return `/help/${encodeURIComponent(c.page_id)}${c.anchor ? `#${c.anchor}` : ''}`
}

/** "Complaints Policy › Timeframes" */
export function citationLabel(c: Pick<KbCitation, 'title' | 'heading_path'>): string {
  return c.heading_path.length ? `${c.title} › ${c.heading_path.join(' › ')}` : c.title
}

export type AnswerPart = { kind: 'text'; text: string } | { kind: 'cite'; n: number }

/**
 * An answer split into text and its `[n]` markers, so the markers can be drawn
 * as links and everything else as TEXT — never as markup. `[1, 3]` is two
 * markers; a number with no passage behind it stays as typed.
 */
export function splitCitations(answer: string, known: number): AnswerPart[] {
  const parts: AnswerPart[] = []
  let last = 0
  for (const m of answer.matchAll(/\[(\d+(?:\s*,\s*\d+)*)\]/g)) {
    const numbers = m[1].split(',').map((s) => Number(s.trim()))
    if (!numbers.every((n) => Number.isInteger(n) && n >= 1 && n <= known)) continue
    if (m.index! > last) parts.push({ kind: 'text', text: answer.slice(last, m.index) })
    for (const n of numbers) parts.push({ kind: 'cite', n })
    last = m.index! + m[0].length
  }
  if (last < answer.length) parts.push({ kind: 'text', text: answer.slice(last) })
  return parts
}

/** "Written from 3 passages · Complaints Policy v7, Privacy Policy v3" */
export function summaryLine(citations: KbCitation[]): string {
  if (citations.length === 0) return ''
  const docs = new Map<string, string>()
  for (const c of citations) docs.set(c.document_id, `${c.title} v${c.version}`)
  const n = citations.length
  return `Written from ${n} passage${n === 1 ? '' : 's'} · ${[...docs.values()].join(', ')}`
}

/**
 * Newline-delimited JSON, arriving in arbitrary pieces. Returns the complete
 * events and whatever partial line is left to carry into the next piece.
 */
export function parseNdjson(buffer: string): { events: KbAskEvent[]; rest: string } {
  const lines = buffer.split('\n')
  const rest = lines.pop() ?? ''
  const events: KbAskEvent[] = []
  for (const line of lines) {
    if (!line.trim()) continue
    try {
      events.push(JSON.parse(line) as KbAskEvent)
    } catch {
      /* A torn line is not an event; the stream continues. */
    }
  }
  return { events, rest }
}
