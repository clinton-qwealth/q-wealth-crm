import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import { adfToMarkdown, escapeText, type AdfNode } from '../supabase/functions/_shared/adf'
import { CHUNK_CAP, chunk, slugify } from '../supabase/functions/_shared/chunk'

/**
 * The knowledge base's converter and chunker, against every real page.
 *
 * The fixtures are the 28 pages of the OPERATIONS space as Confluence serves
 * them in `atlas_doc_format`, fetched 22 Sep 2026 — 27 in scope for the
 * knowledge base plus the MCP Server page, which is out of scope and here
 * because it is the one page with code fences, a rule, a blockquote and a
 * macro. Beside each is the markdown the converter produced, committed as a
 * golden file: a converter change is a diff to read. `UPDATE_KB_GOLDENS=1`
 * rewrites them.
 */
const dir = join(__dirname, 'fixtures', 'kb')
const fixtures = readdirSync(dir)
  .filter((f) => f.endsWith('.adf.json'))
  .map((f) => {
    const raw = JSON.parse(readFileSync(join(dir, f), 'utf8')) as { id: string; title: string; body: AdfNode }
    return { file: f, ...raw }
  })

const byTitle = (title: string) => {
  const f = fixtures.find((x) => x.title === title)
  if (!f) throw new Error(`no fixture titled ${title}`)
  return f
}
const md = (title: string) => adfToMarkdown(byTitle(title).body).markdown

describe('the fixtures', () => {
  test('all 28 pages of the space are here', () => {
    expect(fixtures).toHaveLength(28)
    expect(fixtures.map((f) => f.title)).toContain('Best Interests Policy')
    expect(fixtures.map((f) => f.title)).toContain('Service Agreements and Review Services Policy')
  })
})

describe('the converter', () => {
  test('every page matches its golden file', () => {
    for (const f of fixtures) {
      const { markdown } = adfToMarkdown(f.body)
      const golden = join(dir, f.file.replace(/\.adf\.json$/, '.md'))
      if (process.env.UPDATE_KB_GOLDENS === '1' || !existsSync(golden)) writeFileSync(golden, markdown)
      expect(markdown, f.title).toBe(readFileSync(golden, 'utf8'))
    }
  })

  test('nothing in the policies is unsupported; the MCP page names its one macro', () => {
    for (const f of fixtures) {
      const { unsupported } = adfToMarkdown(f.body)
      if (f.title === 'Q Wealth CRM — MCP Server') expect(unsupported).toEqual(['extension:legacy-content'])
      else expect(unsupported, f.title).toEqual([])
    }
  })

  test('headings keep their level and lose their trailing space', () => {
    const out = md('Best Interests Policy')
    expect(out).toContain('\n## Background\n')
    expect(out).toContain('\n## The seven steps\n')
    expect(out).not.toMatch(/^#+ .*[ \t]$/m)
    /* Level 3 under level 2, as the page has it. */
    expect(md('Data Collection Policy')).toContain('\n### Gearing\n')
  })

  test('emphasis closes on the word, not on the space Confluence put inside the mark', () => {
    /* ADF: {"text":"Financial Advice Co Pty Ltd ","marks":[strong]} */
    const out = md('Best Interests Policy')
    expect(out).toContain('**Financial Advice Co Pty Ltd**')
    expect(out).not.toContain('Ltd **')
    /* Mutation: drop the lift in marked() → "**Step 1:** You" still passes but
       the licence line fails. */
    expect(out).toContain('**Step 1:** You must identify')
  })

  test('a link is a link, an email a mailto', () => {
    expect(md('Best Interests Policy')).toContain(
      '[contact@financialadviceco.com.au](mailto:contact@financialadviceco.com.au)',
    )
    expect(md('Data Breaches')).toContain('[Privacy fact sheet 17](https://www.oaic.gov.au/')
  })

  test('the licence panel is a blockquote and its hard breaks are line breaks', () => {
    const out = md('Best Interests Policy')
    expect(out).toContain('> **Financial Advice Co Pty Ltd**\n> ABN 37 660 747 366;\n> Australian Financial Services Licence Number 543 023')
    /* The paragraph after it BEGINS with a hardBreak in ADF; the markdown does not. */
    expect(out).not.toMatch(/\n\n\n+This policy is a subset/)
    expect(out).toContain('\n\nThis policy is a subset of Financial Advice Co Pty Ltd compliance framework')
  })

  test('lists nest by indentation', () => {
    const out = md('Best Interests Policy')
    expect(out).toContain('- Good communication with the client. This includes:\n  - Providing advice documents')
  })

  test('a table has a header row when the page has one, a blank one when it does not', () => {
    const out = md('Best Interests Policy')
    expect(out).toContain('| **Version** | **Last Updated** | **Updated By** |\n| --- | --- | --- |\n| 1.1 | 30 June 2026 | Clinton Hatcher |')
    /* The Referrals appendix tables have no tableHeader cells. Mutation: treat
       the first row as the header regardless → this fails. */
    const ref = md('Referrals Policy')
    expect(ref).toContain('|  |  |\n| --- | --- |\n| Name of Referral partner |  |')
  })

  test('a spanned cell is followed by its span of empty cells so every row is as wide as the table', () => {
    /* Data Breaches: "Day 1 - Data Breach Occurs" spans 3 of 3 columns. */
    const out = md('Data Breaches')
    expect(out).toContain('| **Day 1 - Data Breach Occurs (identification of breach/potential breach)** |  |  |')
    const table = out.slice(out.indexOf('| **Step** | **Action** | **Timeframe** |'))
    const rows = table.split('\n').filter((l) => l.startsWith('|'))
    const widths = new Set(rows.map((r) => r.split('|').length))
    expect(widths.size).toBe(1)
  })

  test('block content inside a cell stays on the row', () => {
    /* A cell with a paragraph, a bold line and a bullet list — the seven steps. */
    const out = md('Best Interests Policy')
    const row = out.split('\n').find((l) => l.includes('**Step 1:** You must identify'))
    expect(row).toBeDefined()
    expect(row).toContain('<br>**Example questions**<br>• Have you identified objectives')
    expect(row!.endsWith('|')).toBe(true)
  })

  test('a status lozenge is its word, a task a checkbox, an inline card its link', () => {
    const sop = md('Step 1 - Prior to Initial Meeting')
    expect(sop).toContain('| **Document ID** | *SOP-001* | **Status** | DRAFT |')
    expect(sop).toContain('• Risk Profile<br>• Client Snapshot')
    expect(sop).toContain('[https://qwealth-team-ak35zu7c.atlassian.net/wiki/spaces/OPERATIONS/folder/14450689')
    /* Task items outside a table are checkboxes. */
    const doc: AdfNode = {
      type: 'doc',
      content: [{ type: 'taskList', content: [
        { type: 'taskItem', attrs: { state: 'DONE' }, content: [{ type: 'text', text: 'Risk Profile' }] },
        { type: 'taskItem', attrs: { state: 'TODO' }, content: [{ type: 'text', text: 'FSG' }] },
      ] }],
    }
    expect(adfToMarkdown(doc).markdown).toBe('- [x] Risk Profile\n- [ ] FSG\n')
  })

  test('code fences, rules and code marks survive', () => {
    const out = md('Q Wealth CRM — MCP Server')
    expect(out).toMatch(/\n```\w*\n[\s\S]+?\n```\n/)
    expect(out).toContain('\n---\n')
    expect(out).toMatch(/`[a-z_]+`/)
  })

  test('an unknown node is rendered by its children and named, never dropped', () => {
    const doc: AdfNode = {
      type: 'doc',
      content: [
        { type: 'newMacro', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'the words' }] }] },
        { type: 'paragraph', content: [{ type: 'text', text: 'after' }] },
      ],
    }
    const { markdown, unsupported } = adfToMarkdown(doc)
    expect(markdown).toContain('the words')
    expect(markdown).toContain('*(unsupported content: newMacro)*')
    expect(unsupported).toEqual(['newMacro'])
  })

  test('text that looks like markup is escaped, and a paragraph line that would start a heading or list is too', () => {
    expect(escapeText('a * b _c_ [d] <e>')).toBe('a \\* b \\_c\\_ \\[d\\] \\<e\\>')
    const para = (text: string) =>
      adfToMarkdown({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] }).markdown.trim()
    expect(para('# not a heading')).toBe('\\# not a heading')
    expect(para('1. not an item')).toBe('1\\. not an item')
    expect(para('1.5 percent')).toBe('1.5 percent')
    /* A heading's own numbering is not a list, and is left alone. Mutation:
       escape in escapeText instead of the paragraph → "## \\7. Procedure". */
    expect(md('Step 1 - Prior to Initial Meeting')).toContain('\n## 7. Procedure — step by step\n')
    /* Inside a cell nothing is a line start. */
    expect(md('Step 1 - Prior to Initial Meeting')).toContain('<br>1) via the website')
  })
})

describe('the chunker', () => {
  const all = fixtures.map((f) => ({
    ...f,
    markdown: adfToMarkdown(f.body).markdown,
    chunks: chunk(adfToMarkdown(f.body).markdown, { title: f.title }),
  }))

  test('no chunk is over the cap, and the cap is the 512-token budget in characters', () => {
    expect(CHUNK_CAP).toBe(1100)
    for (const f of all) for (const c of f.chunks) expect(c.content.length, `${f.title} #${c.ordinal}`).toBeLessThanOrEqual(CHUNK_CAP)
  })

  test('a chunk over the cap throws rather than being embedded truncated', () => {
    /* A single table row wider than the cap cannot be split by structure. */
    const row = `| ${'x'.repeat(1200)} |`
    expect(() => chunk(`| h |\n| --- |\n${row}\n`, { title: 'T' })).toThrow(/over the cap/)
  })

  test('every chunk carries its breadcrumb, and none is only a breadcrumb', () => {
    for (const f of all) {
      for (const c of f.chunks) {
        expect(c.content.startsWith(f.title), `${f.title} #${c.ordinal}`).toBe(true)
        const prefix = c.headingPath.length ? `${f.title} › ${c.headingPath.join(' › ')}\n\n` : `${f.title}\n\n`
        expect(c.content.startsWith(prefix), `${f.title} #${c.ordinal}`).toBe(true)
        expect(`${c.breadcrumb}\n\n`, `${f.title} #${c.ordinal} breadcrumb`).toBe(prefix)
        expect(c.content.length, `${f.title} #${c.ordinal} is breadcrumb only`).toBeGreaterThan(prefix.length + 20)
      }
    }
  })

  test('ordinals count from zero without gaps', () => {
    for (const f of all) expect(f.chunks.map((c) => c.ordinal)).toEqual(f.chunks.map((_, i) => i))
  })

  test('boundaries land on headings: a chunk never contains two sections', () => {
    for (const f of all) {
      for (const c of f.chunks) {
        const body = c.content.slice(c.content.indexOf('\n\n') + 2)
        expect(body, `${f.title} #${c.ordinal}`).not.toMatch(/^#{1,6} /m)
      }
    }
  })

  test('the heading path names real headings, deepest last', () => {
    const bi = all.find((f) => f.title === 'Best Interests Policy')!
    const paths = new Set(bi.chunks.map((c) => c.headingPath.join(' › ')))
    expect(paths).toContain('The seven steps')
    expect(paths).toContain('Review')
    const dc = all.find((f) => f.title === 'Data Collection Policy')!
    expect(new Set(dc.chunks.map((c) => c.headingPath.join(' › ')))).toContain(
      'Rules for specific fact-finding circumstances › Gearing',
    )
    /* The version table sits above the first heading. */
    expect(bi.chunks[0].headingPath).toEqual([])
    expect(bi.chunks[0].anchor).toBeNull()
    expect(bi.chunks.find((c) => c.headingPath[0] === 'The seven steps')!.anchor).toBe('the-seven-steps')
  })

  test("a table's header is never orphaned: every table piece has its header and at least one row", () => {
    const sep = /^\|(\s*---\s*\|)+\s*$/m
    for (const f of all) {
      for (const c of f.chunks) {
        const lines = c.content.split('\n')
        const rows = lines.filter((l) => /^\|.*\|$/.test(l))
        if (rows.length === 0) continue
        const sepAt = lines.findIndex((l) => sep.test(l))
        expect(sepAt, `${f.title} #${c.ordinal} has table rows but no separator`).toBeGreaterThan(0)
        expect(lines[sepAt - 1], `${f.title} #${c.ordinal} separator without header`).toMatch(/^\|.*\|$/)
        expect(lines.slice(sepAt + 1).some((l) => /^\|.*\|$/.test(l)), `${f.title} #${c.ordinal} header without rows`).toBe(true)
      }
    }
  })

  test('the seven-steps table is split on rows and its header rides along', () => {
    const bi = all.find((f) => f.title === 'Best Interests Policy')!
    const pieces = bi.chunks.filter((c) => c.content.includes('| **Steps** | **What is needed to satisfy the requirement** |'))
    expect(pieces.length).toBeGreaterThanOrEqual(3)
    /* Mutation: drop the header re-emit in splitTable → only one piece has it. */
  })

  test('the largest page splits into many chunks, none of them a bare fragment', () => {
    const sa = all.find((f) => f.title === 'Service Agreements and Review Services Policy')!
    expect(sa.markdown.length).toBeGreaterThan(30_000)
    expect(sa.chunks.length).toBeGreaterThan(30)
  })

  test('a ## inside a code fence is not a heading', () => {
    const src = '## Real\n\nbefore\n\n```sql\n## not a heading\nselect 1;\n```\n\nafter\n'
    const out = chunk(src, { title: 'T' })
    expect(out).toHaveLength(1)
    expect(out[0].headingPath).toEqual(['Real'])
    expect(out[0].content).toContain('## not a heading')
  })

  test('a paragraph longer than the cap splits on sentences and repeats its last sentence', () => {
    /* Numbered, so the overlap is distinguishable from the next sentence.
       Mutation: `cur = u` instead of `cur = overlapTail(cur) + u` → fails. */
    const src = `## Long\n\n${Array.from({ length: 40 }, (_, i) => `Rule ${i} says the adviser must record the client’s objectives in the fact find. `).join('')}\n`
    const out = chunk(src, { title: 'T' })
    expect(out.length).toBeGreaterThan(1)
    for (const c of out) expect(c.content.length).toBeLessThanOrEqual(CHUNK_CAP)
    const bodies = out.map((c) => c.content.slice(c.content.indexOf('\n\n') + 2))
    /* Each piece ends on a sentence end, and the next begins with a sentence
       (or two — up to 15% of the cap, cut on a sentence boundary) that closed
       the one before. */
    for (const b of bodies) expect(b.trimEnd().endsWith('.')).toBe(true)
    const firstSentenceOfSecond = bodies[1].split('. ')[0]
    expect(firstSentenceOfSecond).toMatch(/^Rule \d+ says/)
    expect(bodies[0]).toContain(firstSentenceOfSecond)
    const overlap = bodies[0].slice(bodies[0].indexOf(firstSentenceOfSecond)).length
    expect(overlap).toBeLessThanOrEqual(Math.floor(CHUNK_CAP * 0.15) + 1)
  })

  test('a level-2 heading closes the level-3 above it', () => {
    /* Data Collection: "### Investments" is the last h3 under "Rules for
       specific fact-finding circumstances"; "## Risk profiling" follows.
       Mutation: drop `stack.length = level - 1` → the path keeps Investments. */
    const dc = all.find((f) => f.title === 'Data Collection Policy')!
    const risk = dc.chunks.filter((c) => c.headingPath[0] === 'Risk profiling')
    expect(risk.length).toBeGreaterThan(0)
    for (const c of risk) expect(c.headingPath).toEqual(['Risk profiling'])
    expect(dc.chunks.some((c) => c.headingPath.join(' › ') === 'Rules for specific fact-finding circumstances › Investments')).toBe(true)
  })

  test('a short lead stays with the list it introduces', () => {
    /* "Ensure your advice process and recommendations capture the following:"
       is 70 characters; the list after it is over the cap. Mutation: split at
       the full budget regardless → the lead is a chunk on its own. */
    const bi = all.find((f) => f.title === 'Best Interests Policy')!
    const first = bi.chunks.find((c) => c.headingPath[0] === 'Advice obligations')!
    expect(first.content).toContain('Ensure your advice process and recommendations capture the following:')
    expect(first.content).toContain('- A clearly defined scope')
  })

  test('a split is evened out: no piece is a bare remainder when the same count fits smaller', () => {
    /* Mutation: `return first` in balanced() → the last piece is one item. */
    const item = (i: number) => `- Item ${i} ${'word '.repeat(40)}`
    const src = `## L\n\n${Array.from({ length: 11 }, (_, i) => item(i)).join('\n')}\n`
    const out = chunk(src, { title: 'T' })
    expect(out.length).toBeGreaterThan(1)
    const sizes = out.map((c) => c.content.length)
    expect(Math.min(...sizes)).toBeGreaterThan(Math.max(...sizes) * 0.5)
  })

  test('a list longer than the cap splits on items, a nested item staying with its parent', () => {
    const item = (i: number) => `- Item ${i} ${'word '.repeat(30)}\n  - nested under ${i}`
    const src = `## L\n\n${Array.from({ length: 12 }, (_, i) => item(i)).join('\n')}\n`
    const out = chunk(src, { title: 'T' })
    expect(out.length).toBeGreaterThan(1)
    for (const c of out) {
      const body = c.content.slice(c.content.indexOf('\n\n') + 2)
      expect(body.startsWith('- Item')).toBe(true)
      for (const m of body.matchAll(/nested under (\d+)/g)) expect(body).toContain(`- Item ${m[1]} `)
    }
  })

  test('the corpus is the size the design assumed', () => {
    const inScope = all.filter((f) => f.title !== 'Q Wealth CRM — MCP Server')
    const total = inScope.reduce((n, f) => n + f.chunks.length, 0)
    /* ~600 was the estimate at a 1,100 cap. Pinned to a band so a chunker
       change that doubles or halves the corpus is a failing test, not a
       surprise on the embedding bill. */
    expect(total).toBeGreaterThan(350)
    expect(total).toBeLessThan(900)
  })

  test('slugify matches what the reader will put on a heading', () => {
    expect(slugify('The seven steps')).toBe('the-seven-steps')
    expect(slugify('Initial Public Offerings (IPO’s) – ≥$250 million')).toBe('initial-public-offerings-ipo-s-250-million')
    expect(slugify('**Bold** heading')).toBe('bold-heading')
  })
})
