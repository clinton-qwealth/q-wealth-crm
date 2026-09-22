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
// DEPLOY NOTE. The Supabase CLI resolves `../_shared/` by bundling the whole
// functions directory. The dashboard/MCP deploy takes a flat file list, so the
// deploy step ships `_shared/adf.ts` and `_shared/chunk.ts` INSIDE this
// function's bundle and rewrites the two import paths below to `./_shared/`.
// The source of truth is the file in `_shared/`; there is no second copy.
import 'jsr:@supabase/functions-js/edge-runtime.d.ts'

import { adfToMarkdown, type AdfNode } from '../_shared/adf.ts'
import { chunk, CHUNK_CAP } from '../_shared/chunk.ts'

const SECRET = Deno.env.get('KB_PREPARE_SECRET') ?? ''

type PrepareRequest = {
  title?: unknown
  /** The ADF document — an object, or the JSON string Confluence's REST API
   *  returns in body.atlas_doc_format.value. */
  body?: unknown
  page_id?: unknown
  version?: unknown
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
  // which is what n8n's templated-credential type sends by default. The
  // gateway does not read the bearer (verify_jwt is off), so it reaches here.
  const authz = req.headers.get('Authorization') ?? ''
  const presented = req.headers.get('x-kb-secret') ?? (authz.startsWith('Bearer ') ? authz.slice(7) : '')
  if (!constantTimeEqual(presented, SECRET)) {
    console.warn(JSON.stringify({ event: 'kb_prepare_rejected', header_present: presented.length > 0 }))
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

  const started = Date.now()
  try {
    const { markdown, unsupported } = adfToMarkdown(doc)
    const chunks = chunk(markdown, { title })

    // Sequential on purpose: the session is one model, and a page is fifty
    // passages at most. Parallel calls would contend for it, not overlap.
    const out = []
    for (const c of chunks) {
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
        chunks: out.length,
        unsupported,
        ms: Date.now() - started,
      }),
    )

    return json({
      title,
      markdown,
      chunk_count: out.length,
      chunk_cap: CHUNK_CAP,
      unsupported,
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
