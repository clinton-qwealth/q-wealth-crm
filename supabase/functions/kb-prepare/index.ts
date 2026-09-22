// kb-prepare — a Confluence page in, its markdown, passages and vectors out.
//
// n8n POSTs each changed page here (as ADF, exactly as Confluence served it)
// and lands what comes back in ingest.confluence_pages. The conversion and the
// chunking are `../_shared/adf.ts` and `../_shared/chunk.ts`, pure modules the
// vitest suite runs against every real page; this file adds only the embedding
// and the door.
//
// THE DOOR IS A SHARED SECRET, NOT A JWT. n8n holds no user token and must
// not: the feed writes as a Postgres role, and this function writes nothing at
// all — it computes. But an embedding endpoint with no lock is a free GPU for
// anyone who finds the URL, so the header `x-kb-secret` (or a bearer token)
// must equal the KB_PREPARE_SECRET function secret, compared in constant time. Deployed with
// verify_jwt=false for that reason and no other.
//
// EMBEDDING HAPPENS HERE, BEFORE THE ROW LANDS. The feed role holds nothing on
// public, so it cannot write vectors back after promotion; carrying them in
// the landing row is what lets kb_chunks.embedding be NOT NULL. gte-small runs
// natively in the edge runtime — 384 dimensions, 512 tokens, unit-normalised —
// and the chunker's 1,100-character cap is that token budget in characters.
//
// IT EMBEDS A SLICE, NOT A PAGE, AND THAT IS NOT A PREFERENCE. A hosted edge
// worker gets TWO SECONDS OF CPU per request, fixed — not configurable on any
// plan, only by self-hosting — and exceeding it kills the worker with a 546
// before it can answer. Measured on the real corpus, 22 Sep 2026: a 19-chunk
// page took 2073ms and scraped through; every page of 21 chunks or more died,
// deterministically, retries included. Fifteen of the twenty-eight policies
// were on the wrong side of that line, including every one worth reading.
//
// So the caller asks for `offset` and `limit` and calls again until it has
// `chunk_count` of them. Converting and chunking is pure string work costing
// single-digit milliseconds, so it is simply redone on each slice rather than
// cached — statelessness is worth more here than the milliseconds.
//
// EMBED_BATCH is 8 because the worst case has to fit, not the average: eight
// chunks at the 1,100-character cap is 8,800 characters, and the measured rate
// of ~5.8 chars/ms puts that at ~1,500ms, inside the budget with room. Counting
// average-sized chunks instead would pass the average page and kill the
// table-heavy ones, which is the failure this replaces.
//
// DEPLOY NOTE. The Supabase CLI resolves `../_shared/` by bundling the whole
// functions directory. The dashboard/MCP deploy takes a flat file list, so the
// deploy step ships `_shared/adf.ts` and `_shared/chunk.ts` INSIDE this
// function's bundle and rewrites the two import paths below to `./_shared/`.
// The source of truth is the file in `_shared/`; there is no second copy.
import 'jsr:@supabase/functions-js/edge-runtime.d.ts'

import { adfToMarkdown, type AdfNode } from '../_shared/adf.ts'
import { chunk, CHUNK_CAP } from '../_shared/chunk.ts'

const SECRET = Deno.env.get('KB_PREPARE_SECRET') ?? ''

/** Chunks embedded per request. See the header: the worst case must fit 2s of CPU. */
const EMBED_BATCH = 8

type PrepareRequest = {
  title?: unknown
  /** The ADF document — an object, or the JSON string Confluence's REST API
   *  returns in body.atlas_doc_format.value. */
  body?: unknown
  page_id?: unknown
  version?: unknown
  /** First chunk to embed, 0-based. */
  offset?: unknown
  /** How many to embed. 0 asks only for the shape: chunk_count and the markdown. */
  limit?: unknown
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

/** Equal length and equal bytes, without an early exit that would time the answer. */
function constantTimeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder()
  const x = enc.encode(a)
  const y = enc.encode(b)
  if (x.length !== y.length) return false
  let diff = 0
  for (let i = 0; i < x.length; i += 1) diff |= x[i] ^ y[i]
  return diff === 0
}

// One model session per isolate. Constructing it is the slow part; a warm
// isolate reuses it across pages within a run.
const model = new Supabase.ai.Session('gte-small')

async function embed(text: string): Promise<number[]> {
  const out = (await model.run(text, { mean_pool: true, normalize: true })) as number[] | Float32Array
  const vec = Array.from(out as ArrayLike<number>)
  if (vec.length !== 384) throw new Error(`the model returned ${vec.length} dimensions, expected 384`)
  return vec
}

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)

  // No secret configured means no door at all — refuse rather than run open.
  if (!SECRET || SECRET.length < 32) {
    console.error(JSON.stringify({ event: 'kb_prepare_misconfigured', reason: 'KB_PREPARE_SECRET unset or short' }))
    return json({ error: 'kb-prepare is not configured' }, 503)
  }
  // Either header carries the secret: `x-kb-secret`, or `Authorization: Bearer`,
  // which is what n8n's templated-credential type sends. The gateway does not
  // read the bearer (verify_jwt is off), so it reaches here.
  const fromHeader = req.headers.get('x-kb-secret')
  const authz = req.headers.get('Authorization') ?? ''
  const fromBearer = authz.startsWith('Bearer ') ? authz.slice(7) : ''
  const presented = fromHeader ?? fromBearer
  if (!constantTimeEqual(presented, SECRET)) {
    // LENGTHS AND SHAPE, NEVER THE VALUE. "A header arrived and it was wrong"
    // is not a diagnosis — it cannot tell a mistyped secret from the two ways
    // this actually goes wrong: an n8n `httpCustomAuth` credential does no
    // template substitution, so a `{{api_key}}` placeholder is sent
    // literally; and a copy-pasted secret picks up a trailing newline. Both
    // are visible in a length and a shape test, and neither needs the secret
    // itself to reach a log.
    const trimmed = presented.trim()
    console.warn(
      JSON.stringify({
        event: 'kb_prepare_rejected',
        source: fromHeader !== null ? 'x-kb-secret' : fromBearer ? 'authorization' : 'none',
        presented_length: presented.length,
        expected_length: SECRET.length,
        looks_like_unsubstituted_placeholder: /^\{\{.*\}\}$/.test(trimmed),
        differs_only_by_whitespace: trimmed !== presented && constantTimeEqual(trimmed, SECRET),
      }),
    )
    return json({ error: 'Not authorised' }, 401)
  }

  let input: PrepareRequest
  try {
    input = (await req.json()) as PrepareRequest
  } catch {
    return json({ error: 'The body must be JSON' }, 400)
  }

  const title = typeof input.title === 'string' ? input.title.trim() : ''
  if (!title) return json({ error: 'title is required' }, 400)

  let doc: AdfNode
  try {
    doc = (typeof input.body === 'string' ? JSON.parse(input.body) : input.body) as AdfNode
  } catch {
    return json({ error: 'body is not valid ADF JSON' }, 400)
  }
  if (!doc || typeof doc !== 'object' || doc.type !== 'doc') {
    return json({ error: 'body must be an ADF document (type "doc")' }, 400)
  }

  const offset = typeof input.offset === 'number' && input.offset >= 0 ? Math.trunc(input.offset) : 0
  const limit = typeof input.limit === 'number' && input.limit >= 0 ? Math.trunc(input.limit) : EMBED_BATCH

  const started = Date.now()
  try {
    const { markdown, unsupported } = adfToMarkdown(doc)
    const chunks = chunk(markdown, { title })
    const slice = chunks.slice(offset, offset + limit)

    // Sequential on purpose: the session is one model, so parallel calls would
    // contend for it rather than overlap. The slice is what keeps this inside
    // the CPU budget; see the header.
    const out = []
    for (const c of slice) {
      out.push({
        ordinal: c.ordinal,
        heading_path: c.headingPath,
        anchor: c.anchor,
        breadcrumb: c.breadcrumb,
        content: c.content,
        embedding: await embed(c.content),
      })
    }

    console.log(
      JSON.stringify({
        event: 'kb_prepare_ok',
        page_id: typeof input.page_id === 'string' || typeof input.page_id === 'number' ? String(input.page_id) : null,
        version: typeof input.version === 'number' ? input.version : null,
        markdown_chars: markdown.length,
        chunk_count: chunks.length,
        offset,
        embedded: out.length,
        embedded_chars: out.reduce((n, c) => n + c.content.length, 0),
        unsupported,
        ms: Date.now() - started,
      }),
    )

    return json({
      title,
      chunk_count: chunks.length,
      offset,
      chunk_cap: CHUNK_CAP,
      // Only with the first slice: the markdown is identical on every call and
      // there is no reason to send 40KB back eight times.
      ...(offset === 0 ? { markdown, unsupported } : {}),
      chunks: out,
    })
  } catch (e) {
    // A chunk over the cap throws in the chunker, by design: this run fails
    // loudly rather than landing a passage the model would silently truncate.
    const message = e instanceof Error ? e.message : String(e)
    console.error(JSON.stringify({ event: 'kb_prepare_failed', title, message }))
    return json({ error: message }, 422)
  }
})
