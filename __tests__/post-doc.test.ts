import { describe, expect, test } from 'vitest'
import { isPostDoc, postDocText, postMentionIds, type PostDoc } from '@/lib/workflow-board'
import { formatNoteDateTime } from '@/lib/note-date'

/**
 * The database's `activity_doc_text()` is the authority. These are the same
 * inputs it was verified against, so the client's reading agrees with it on
 * the cases the client uses: "is there anything here", and the optimistic entry.
 */
describe('postDocText', () => {
  test('text nodes in order, mentions as @Label, blocks separated by newlines', () => {
    const doc: PostDoc = {
      type: 'doc',
      content: [
        { type: 'paragraph', content: [
          { type: 'text', text: 'Please review ' },
          { type: 'mention', attrs: { id: 'x', label: 'Colleague' } },
          { type: 'text', text: ' today', marks: [{ type: 'bold' }] },
        ] },
        { type: 'bulletList', content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'item one' }] }] }] },
      ],
    }
    expect(postDocText(doc)).toBe('Please review @Colleague today\nitem one')
  })

  test('an empty paragraph, or whitespace only, is nothing — the same answer the database gives', () => {
    expect(postDocText({ type: 'doc', content: [{ type: 'paragraph' }] })).toBe('')
    expect(postDocText({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '   ' }] }] })).toBe('')
    expect(postDocText({ type: 'doc' })).toBe('')
  })

  test('a heading, a quote, a code block and a rule each end a line — the same reading the database gives', () => {
    expect(
      postDocText({ type: 'doc', content: [
        { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Title' }] },
        { type: 'blockquote', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'quoted', marks: [{ type: 'underline' }] }] }] },
        { type: 'codeBlock', attrs: { language: null }, content: [{ type: 'text', text: 'x = 1' }] },
        { type: 'horizontalRule' },
        { type: 'paragraph', content: [{ type: 'text', text: 'end 👍' }] },
      ] }),
    ).toBe('Title\nquoted\nx = 1\nend 👍')
  })

  /**
   * The case that matters: a heading or a code block AFTER a paragraph. A
   * paragraph puts its newline before its own text, so a block that follows
   * one has to supply the boundary itself — the first fixture here had the
   * heading first, and a mutation that dropped it from the block set passed.
   */
  test('a heading or a code block after a paragraph still starts a new line', () => {
    expect(
      postDocText({ type: 'doc', content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'Intro' }] },
        { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'Title' }] },
        { type: 'paragraph', content: [{ type: 'text', text: 'Body' }] },
        { type: 'codeBlock', content: [{ type: 'text', text: 'x = 1' }] },
        { type: 'paragraph', content: [{ type: 'text', text: 'End' }] },
      ] }),
    ).toBe('Intro\nTitle\nBody\nx = 1\nEnd')
  })

  test('a rule alone is nothing — the database refuses it as wordless', () => {
    expect(postDocText({ type: 'doc', content: [{ type: 'horizontalRule' }] })).toBe('')
  })

  test('a hard break is a line, not a space', () => {
    expect(
      postDocText({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'One' }, { type: 'hardBreak' }, { type: 'text', text: 'two' }] }, { type: 'paragraph', content: [{ type: 'text', text: 'Three' }] }] }),
    ).toBe('One\ntwo\nThree')
  })
})

describe('isPostDoc', () => {
  test('accepts a document and refuses everything else', () => {
    expect(isPostDoc({ type: 'doc', content: [] })).toBe(true)
    expect(isPostDoc({ type: 'doc' })).toBe(true)
    expect(isPostDoc({ type: 'paragraph' })).toBe(false)
    expect(isPostDoc('<p>hi</p>')).toBe(false)
    expect(isPostDoc(null)).toBe(false)
    expect(isPostDoc({ type: 'doc', content: 'not an array' })).toBe(false)
  })
})

describe('postMentionIds', () => {
  test('every mentioned id, once, however deep', () => {
    expect(
      postMentionIds({ type: 'doc', content: [
        { type: 'paragraph', content: [{ type: 'mention', attrs: { id: 'a', label: 'A' } }, { type: 'mention', attrs: { id: 'a', label: 'A again' } }] },
        { type: 'bulletList', content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'mention', attrs: { id: 'b', label: 'B' } }] }] }] },
      ] }),
    ).toEqual(['a', 'b'])
  })
})

describe('formatNoteDateTime', () => {
  const withTz = (tz: string, run: () => void) => {
    const original = process.env.TZ
    process.env.TZ = tz
    try { run() } finally { process.env.TZ = original }
  }
  test('an instant with its time, in the reader’s timezone, on a 24-hour clock', () => {
    withTz('Australia/Sydney', () => expect(formatNoteDateTime('2026-09-08T09:30:00Z')).toBe('8 Sep 2026, 19:30'))
    withTz('America/New_York', () => expect(formatNoteDateTime('2026-09-08T09:30:00Z')).toBe('8 Sep 2026, 05:30'))
  })
  test('pads the hour and minute', () => {
    withTz('UTC', () => expect(formatNoteDateTime('2026-01-05T03:07:00Z')).toBe('5 Jan 2026, 03:07'))
  })
  test('an unparseable value is returned rather than rendering “Invalid Date”', () => {
    expect(formatNoteDateTime('nope')).toBe('nope')
  })
})
