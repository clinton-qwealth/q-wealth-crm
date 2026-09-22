import { describe, expect, test } from 'vitest'
import {
  ASK_NOTE,
  HANDOFF_BASE,
  excerptOf,
  handoffCitations,
  handoffPrompt,
  handoffUrl,
  matchedBy,
  passageBody,
  passageHref,
  passageLabel,
  type KbPassage,
} from '@/lib/kb'

const passage = (over: Partial<KbPassage> = {}): KbPassage => ({
  chunk_id: 'c1',
  document_id: 'd1',
  page_id: '10092549',
  title: 'Complaints Policy',
  section: 'Policies',
  heading_path: ['Timeframes'],
  anchor: 'timeframes',
  content: 'Complaints Policy › Timeframes\n\nA complaint must be acknowledged within one business day.',
  version: 7,
  score: 0.06,
  lexical_rank: 1,
  semantic_rank: 2,
  ...over,
})

describe('reading a passage', () => {
  test('the breadcrumb is stripped for display but kept in the stored content', () => {
    expect(passageBody(passage())).toBe('A complaint must be acknowledged within one business day.')
    /* A passage above the first heading has a one-line breadcrumb too. */
    expect(passageBody({ content: 'Privacy Policy\n\nWe collect only what is needed.' })).toBe(
      'We collect only what is needed.',
    )
  })

  test('a link goes into the reader at the heading that matched', () => {
    expect(passageHref(passage())).toBe('/help/10092549#timeframes')
    expect(passageHref(passage({ anchor: null }))).toBe('/help/10092549')
    expect(passageLabel(passage({ heading_path: ['Timeframes', 'IDR'] }))).toBe('Complaints Policy › Timeframes › IDR')
    expect(passageLabel(passage({ heading_path: [] }))).toBe('Complaints Policy')
  })

  test('how it was found is said in words, including the keyword-only case', () => {
    expect(matchedBy(passage())).toBe('wording and meaning')
    expect(matchedBy(passage({ semantic_rank: null }))).toBe('wording')
    expect(matchedBy(passage({ lexical_rank: null }))).toBe('meaning')
  })

  test('an excerpt is one line, cut on a word', () => {
    const long = passage({ content: `T\n\n${'word '.repeat(200)}`.trim() })
    const out = excerptOf(long)
    expect(out.length).toBeLessThanOrEqual(320)
    expect(out.endsWith('…')).toBe(true)
    expect(out).not.toMatch(/\bwor…$/)
    expect(excerptOf(passage())).toBe('A complaint must be acknowledged within one business day.')
  })
})

describe('handing the question to Claude', () => {
  test('the prompt tells Claude to fetch the passages rather than carrying them', () => {
    const prompt = handoffPrompt('  what do I do if a client complains?  ')
    expect(prompt).toContain('Q Wealth CRM connector')
    expect(prompt).toContain('search the knowledge base')
    expect(prompt.endsWith('Question: what do I do if a client complains?')).toBe(true)
    /* Mutation: paste the passages into the prompt → this fails. A snapshot
       taken seconds ago is worse than the live lookup Claude can do itself. */
    expect(prompt).not.toContain('acknowledged within one business day')
  })

  test('the prompt asks Claude to stay inside firm policy, and to say when it cannot', () => {
    const prompt = handoffPrompt('anything')
    expect(prompt).toMatch(/answer from the firm’s own\s+policies/)
    expect(prompt).toContain('citing each one by title and version')
    expect(prompt).toMatch(/do not cover it, say so rather\s+than answering from general knowledge/)
  })

  test('the url carries the whole prompt, encoded', () => {
    const url = handoffUrl('what about an SMSF & a trust?')
    expect(url.startsWith(`${HANDOFF_BASE}?q=`)).toBe(true)
    expect(decodeURIComponent(url.slice(`${HANDOFF_BASE}?q=`.length))).toBe(handoffPrompt('what about an SMSF & a trust?'))
    /* An unencoded ampersand would truncate the prompt at "SMSF ". */
    expect(url).not.toContain('& a trust')
  })

  test('an https claude.ai url, not a desktop-only scheme', () => {
    /* The desktop app takes claude.ai links when installed; when it is not,
       the browser opens claude.ai, where the same account connector lives.
       Mutation: claude:// → a person without the app gets nothing. */
    expect(HANDOFF_BASE).toBe('https://claude.ai/new')
  })

  test('what is recorded is the passages that were on screen, capped and excerpted', () => {
    const many = Array.from({ length: 12 }, (_, i) => passage({ chunk_id: `c${i}`, document_id: `d${i}` }))
    const stored = handoffCitations(many)
    expect(stored).toHaveLength(8)
    expect(stored[0]).toEqual({
      document_id: 'd0',
      title: 'Complaints Policy',
      heading_path: ['Timeframes'],
      anchor: 'timeframes',
      version: 7,
      excerpt: 'A complaint must be acknowledged within one business day.',
    })
    /* No chunk_id: chunks are deleted when a policy is retired, and the record
       has to outlive that. The document id points at the soft-retired row. */
    expect(Object.keys(stored[0])).not.toContain('chunk_id')
  })

  test('the note above the box is honest about both halves', () => {
    expect(ASK_NOTE).toContain('Search')
    expect(ASK_NOTE).toContain('client record')
    expect(ASK_NOTE).toMatch(/not kept here/)
  })
})
