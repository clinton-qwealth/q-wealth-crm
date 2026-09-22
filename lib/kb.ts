/**
 * The knowledge base, as the /help screen reads it.
 *
 * Pure: types and small helpers, no Supabase and no `next/headers`, so the
 * client component can import it — the same split `lib/audit.ts` keeps for the
 * trail.
 *
 * ## Why there is no answer here
 *
 * /help searched the policies and wrote an answer from them until 22 Sep 2026,
 * when Clinton moved the answering to Claude. The CRM retrieves and shows; the
 * question goes to Claude, where the connector gives it these passages
 * ALONGSIDE the client tools. What the CRM keeps is the question and what it
 * showed — never what Claude then said, which lives in the asker's own account.
 */

/** A passage of a policy, exactly as `search_knowledge_base` returns it. */
export type KbPassage = {
  chunk_id: string
  document_id: string
  page_id: string
  title: string
  section: string
  heading_path: string[]
  anchor: string | null
  /** Breadcrumb line, a blank line, then the passage. See `passageBody`. */
  content: string
  version: number
  score: number
  /** Null when this passage was found only by meaning. */
  lexical_rank: number | null
  /** Null when only by keyword, and always null for a keyword-only search. */
  semantic_rank: number | null
}

/** A question this person asked, as /help lists it back to them. */
export type KbQuestion = { id: string; title: string; updated_at: string }

/** Below this it is not a question, and the database says so too. */
export const MIN_QUESTION = 3

/**
 * What the box says above the question.
 *
 * Load-bearing rather than decorative. Searching happens here and costs
 * nothing; handing over sends the question — and only the question — out of
 * the CRM, so the line has to be true of both.
 */
export const ASK_NOTE =
  'Search the firm’s policies, or take the question to Claude, where it can also see the client record. ' +
  'Claude answers in your own account, so what it says is not kept here.'

/** Into the CRM's own reader, at the heading the passage sits under. */
export function passageHref(p: Pick<KbPassage, 'page_id' | 'anchor'>): string {
  return `/help/${encodeURIComponent(p.page_id)}${p.anchor ? `#${p.anchor}` : ''}`
}

/** "Complaints Policy › Timeframes" */
export function passageLabel(p: Pick<KbPassage, 'title' | 'heading_path'>): string {
  return p.heading_path.length ? `${p.title} › ${p.heading_path.join(' › ')}` : p.title
}

/** The passage without the breadcrumb line it was embedded with. */
export function passageBody(p: Pick<KbPassage, 'content'>): string {
  const at = p.content.indexOf('\n\n')
  return at < 0 ? p.content : p.content.slice(at + 2)
}

/** How a passage was found, for the small grey line under it. */
export function matchedBy(p: Pick<KbPassage, 'lexical_rank' | 'semantic_rank'>): string {
  if (p.lexical_rank !== null && p.semantic_rank !== null) return 'wording and meaning'
  return p.lexical_rank !== null ? 'wording' : 'meaning'
}

/** A short excerpt of a passage, for the record and for a result line. */
export function excerptOf(p: Pick<KbPassage, 'content'>, max = 320): string {
  const body = passageBody(p).replace(/\s+/g, ' ').trim()
  return body.length > max ? body.slice(0, max - 3).replace(/\s+\S*$/, '') + '…' : body
}

/**
 * Where a handed-over question goes.
 *
 * **Verify this parameter before relying on the button alone.** `?q=` is the
 * prefill claude.ai takes; if it ever changes, the question silently opens an
 * empty conversation, which looks like it worked. The Copy button beside it is
 * the fallback that cannot break, and is why one exists.
 *
 * An https URL rather than a `claude://` scheme on purpose: the desktop app
 * takes claude.ai links when it is installed, and when it is not, the browser
 * opens claude.ai — where the CRM connector is configured just the same,
 * because it is an account-level connector. Either way the connector is there.
 */
export const HANDOFF_BASE = 'https://claude.ai/new'

/**
 * The prompt the question travels in.
 *
 * It does NOT carry the passages. They would be a snapshot taken seconds
 * earlier, and Claude holds `search_knowledge_base` itself — so it is told to
 * go and fetch them, and gets the current version with links back into this
 * reader. The instruction to stay inside firm policy is a request and not a
 * boundary: the CRM's own assistant could not step outside it, and Claude can.
 */
export function handoffPrompt(question: string): string {
  return (
    'Use the Q Wealth CRM connector: search the knowledge base and answer from the firm’s own ' +
    'policies, citing each one by title and version. If the policies do not cover it, say so rather ' +
    'than answering from general knowledge.\n\n' +
    `Question: ${question.trim()}`
  )
}

export function handoffUrl(question: string): string {
  return `${HANDOFF_BASE}?q=${encodeURIComponent(handoffPrompt(question))}`
}

/** What `kb_record_handoff` stores about each passage that was on screen. */
export function handoffCitations(passages: KbPassage[], max = 8) {
  return passages.slice(0, max).map((p) => ({
    document_id: p.document_id,
    title: p.title,
    heading_path: p.heading_path,
    anchor: p.anchor,
    version: p.version,
    excerpt: excerptOf(p),
  }))
}
