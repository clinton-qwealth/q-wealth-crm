import { describe, expect, test } from 'vitest'
import { citationHref, citationLabel, parseNdjson, splitCitations, summaryLine, type KbCitation } from '@/lib/kb'

const cite = (n: number, extra: Partial<KbCitation> = {}): KbCitation => ({
  n,
  document_id: `d${n}`,
  page_id: `1000${n}`,
  title: `Policy ${n}`,
  heading_path: [],
  anchor: null,
  version: n,
  excerpt: '…',
  ...extra,
})

describe('splitCitations', () => {
  test('markers become citation parts, text stays text, in order', () => {
    expect(splitCitations('Acknowledge within a day [1]. Resolve within 30 days [2, 3].', 3)).toEqual([
      { kind: 'text', text: 'Acknowledge within a day ' },
      { kind: 'cite', n: 1 },
      { kind: 'text', text: '. Resolve within 30 days ' },
      { kind: 'cite', n: 2 },
      { kind: 'cite', n: 3 },
      { kind: 'text', text: '.' },
    ])
  })

  /* A number with no passage behind it is left as the model wrote it, so a
     hallucinated [9] is visible rather than linked to nothing. */
  test('a marker past the known passages stays as typed', () => {
    expect(splitCitations('See [9].', 3)).toEqual([{ kind: 'text', text: 'See [9].' }])
  })

  test('markup in an answer is text, not a part of any other kind', () => {
    const parts = splitCitations('<img src=x onerror=alert(1)> [1]', 1)
    expect(parts[0]).toEqual({ kind: 'text', text: '<img src=x onerror=alert(1)> ' })
  })
})

describe('the summary line and links', () => {
  test('counts passages and names each document once with its version', () => {
    expect(summaryLine([cite(1, { document_id: 'd1', title: 'Complaints Policy', version: 7 }), cite(2, { document_id: 'd1', title: 'Complaints Policy', version: 7 }), cite(3, { title: 'Privacy Policy', version: 3 })])).toBe(
      'Written from 3 passages · Complaints Policy v7, Privacy Policy v3',
    )
    expect(summaryLine([cite(1)])).toBe('Written from 1 passage · Policy 1 v1')
    expect(summaryLine([])).toBe('')
  })

  test('a citation links into the reader at its heading', () => {
    expect(citationHref(cite(1, { page_id: '10092549', anchor: 'timeframes' }))).toBe('/help/10092549#timeframes')
    expect(citationHref(cite(1, { page_id: '10092549', anchor: null }))).toBe('/help/10092549')
    expect(citationLabel(cite(1, { title: 'Complaints Policy', heading_path: ['Timeframes', 'IDR'] }))).toBe('Complaints Policy › Timeframes › IDR')
  })
})

describe('parseNdjson', () => {
  test('complete lines are events and the torn tail is carried', () => {
    const { events, rest } = parseNdjson('{"type":"delta","text":"a"}\n{"type":"delta","text":"b"}\n{"type":"do')
    expect(events).toEqual([
      { type: 'delta', text: 'a' },
      { type: 'delta', text: 'b' },
    ])
    expect(rest).toBe('{"type":"do')
  })
  test('a corrupt line is skipped, not fatal', () => {
    expect(parseNdjson('not json\n{"type":"delta","text":"ok"}\n').events).toEqual([{ type: 'delta', text: 'ok' }])
  })
})
