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
