// kb-ask — a question about the firm's policies, answered from the policies.
//
// The browser calls this directly with the person's session token; one turn
// of a conversation per call, streamed back as newline-delimited JSON. Every
// read and write runs AS THAT PERSON under RLS — the function holds no
// database privilege of its own. What it does hold is ANTHROPIC_API_KEY, as a
// function secret, in no file and nowhere else, exactly as identity-verify
// holds Twilio's.
//
// THIS IS THE FIRST PLACE THE CRM SENDS TEXT TO AN EXTERNAL AI SERVICE, so what
// leaves is stated precisely and enforced by construction: the question as
// typed, the conversation so far, and the retrieved POLICY passages. The
// knowledge base holds no client data, so none can go — unless a person types
// a client's details into a question, which the box's own copy tells them not
// to do. The exact request body is logged at debug level on a branch and read
// once (verification step 11), never in production.
//
// One turn, in order:
//   1. Authenticate as the caller; require aal2 from the token's claims, as
//      /api/search does — a new front door does not inherit the locks.
//   2. kb_begin_turn(): the database records the question and applies the
//      hourly cap. A limit inside a stateless function never accumulates.
//   3. Embed the question in-process (no hop) and retrieve as the caller.
//   4. Refuse before spending a token: if nothing retrieved is close enough,
//      the fixed sentence is the answer, recorded with refused=true and null
//      token counts. Deterministic, free, and the most common honest answer
//      to a question outside the folder.
//   5. Otherwise call Claude with the passages numbered [1]…[n], streaming.
//   6. Record the answer, its model, its token counts and the citations that
//      actually appear in it.
//
// WHY THERE IS A SIMILARITY FLOOR AND NOT ONLY THE FUSED SCORE. Vector search
// has no notion of "no match": the forty nearest chunks exist for every
// question, however irrelevant, so a rank-based score alone cannot tell
// "office wifi password" from "complaints timeframe". The function therefore
// returns the raw similarity too, and a turn proceeds to the model only when
// the best passage was found by keyword OR is within the floor by meaning.
// The floor is tuned on the branch against real questions (verification 6/9).
import 'jsr:@supabase/functions-js/edge-runtime.d.ts'

import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!
const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY') ?? ''
const MODEL = Deno.env.get('KB_ASK_MODEL') ?? 'claude-sonnet-5'
const SIMILARITY_FLOOR = Number(Deno.env.get('KB_ASK_SIMILARITY_FLOOR') ?? '0.80')
const APP_BASE = (Deno.env.get('APP_BASE_URL') ?? 'https://crm.qwealth.com.au').replace(/\/+$/, '')
const PASSAGES = 8
const MAX_TOKENS = 800
const HISTORY_TURNS = 10

const REFUSAL = "Our policies don't appear to cover this. Ask the compliance manager."

const SYSTEM_PROMPT = `You are the policy assistant inside Q Wealth's CRM. Staff ask you what the firm's written policies and procedures say.

Rules:
- Answer ONLY from the numbered passages in the user's message. They are extracts from the firm's own policy pages.
- Write briefly, in plain Australian English — usually under 150 words — as a summary of what the policy says, not as advice.
- Cite every statement with the passage number in square brackets, like [2]. Use several when several apply.
- If the passages do not answer the question, say exactly: "${REFUSAL}" Do not answer from general knowledge, however confident you are.
- Never give financial, legal or tax advice, never speculate about a specific client, and if a client is named do not repeat the name.
- Keep the passages' own terms (SOA, ROA, TMD, FSG). Do not invent timeframes, thresholds or section numbers that are not in the passages.`

const JWT_SHAPE = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/

type Passage = {
  chunk_id: string
  document_id: string
  page_id: string
  title: string
  section: string
  heading_path: string[]
  anchor: string | null
  content: string
  version: number
  score: number
  lexical_rank: number | null
  semantic_rank: number | null
  similarity: number | null
}

type Citation = {
  n: number
  document_id: string
  page_id: string
  title: string
  heading_path: string[]
  anchor: string | null
  version: number
  excerpt: string
}

// ---------------------------------------------------------------------------
// Plumbing
// ---------------------------------------------------------------------------

function corsHeaders(origin: string | null): Record<string, string> {
  const allowed = new Set([APP_BASE, 'http://localhost:3000', 'http://127.0.0.1:3000'])
  const allow = origin && allowed.has(origin) ? origin : APP_BASE
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Headers': 'authorization, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    Vary: 'Origin',
  }
}

function json(data: unknown, status: number, origin: string | null) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) },
  })
}

function logRejection(reason: string, detail: Record<string, unknown> = {}) {
  console.warn(JSON.stringify({ event: 'kb_ask_rejected', reason, ...detail }))
}

/** The token's claims, base64url-decoded. Read only AFTER getUser verified it. */
function claimsOf(token: string): Record<string, unknown> {
  const payload = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')
  const padded = payload + '='.repeat((4 - (payload.length % 4)) % 4)
  return JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(padded), (c) => c.charCodeAt(0))))
}

async function authenticate(authz: string, origin: string | null): Promise<{ db: SupabaseClient; userId: string } | Response> {
  if (!authz.startsWith('Bearer ')) {
    logRejection('Missing bearer token')
    return json({ error: 'Sign in to ask the assistant.' }, 401, origin)
  }
  const token = authz.slice(7)
  if (!JWT_SHAPE.test(token)) {
    logRejection('Not a user token', { token_length: token.length })
    return json({ error: 'A user session is required.' }, 401, origin)
  }
  const db = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { data, error } = await db.auth.getUser(token)
  if (error || !data?.user) {
    logRejection('Invalid or expired token', { upstream: error?.message ?? 'no user' })
    return json({ error: 'Your session has expired. Sign in again.' }, 401, origin)
  }
  // `aal === 'aal2'`, not "step-up not required": somebody with no factor at
  // all is single-factor and is refused, as /api/search refuses them.
  if (claimsOf(token).aal !== 'aal2') {
    logRejection('Second factor missing', { user: data.user.id })
    return json({ error: 'A verified second factor is required.' }, 403, origin)
  }
  return { db, userId: data.user.id }
}

const model = new Supabase.ai.Session('gte-small')

async function embed(text: string): Promise<number[]> {
  const out = (await model.run(text, { mean_pool: true, normalize: true })) as ArrayLike<number>
  return Array.from(out)
}

/** `[3]`, `[1][4]`, `[2, 5]` — the passage numbers an answer actually cites. */
export function citedNumbers(answer: string, max: number): number[] {
  const seen = new Set<number>()
  for (const m of answer.matchAll(/\[(\d+(?:\s*,\s*\d+)*)\]/g)) {
    for (const part of m[1].split(',')) {
      const n = Number(part.trim())
      if (Number.isInteger(n) && n >= 1 && n <= max) seen.add(n)
    }
  }
  return [...seen].sort((a, b) => a - b)
}

function excerptOf(p: Passage): string {
  const body = p.content.slice(p.content.indexOf('\n\n') + 2).replace(/\s+/g, ' ').trim()
  return body.length > 320 ? body.slice(0, 317).replace(/\s+\S*$/, '') + '…' : body
}

function passagesBlock(passages: Passage[]): string {
  return passages
    .map((p, i) => `[${i + 1}] ${p.title}${p.heading_path.length ? ' › ' + p.heading_path.join(' › ') : ''} (v${p.version})\n${p.content.slice(p.content.indexOf('\n\n') + 2)}`)
    .join('\n\n---\n\n')
}

// ---------------------------------------------------------------------------
// The turn
// ---------------------------------------------------------------------------

Deno.serve(async (req: Request) => {
  const origin = req.headers.get('Origin')
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(origin) })
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405, origin)

  const who = await authenticate(req.headers.get('Authorization') ?? '', origin)
  if (who instanceof Response) return who
  const { db } = who

  let input: { conversation_id?: unknown; question?: unknown }
  try {
    input = (await req.json()) as typeof input
  } catch {
    return json({ error: 'The body must be JSON.' }, 400, origin)
  }
  const question = typeof input.question === 'string' ? input.question.trim() : ''
  const conversationIn = typeof input.conversation_id === 'string' && input.conversation_id ? input.conversation_id : null

  // 2. The database records the question and applies the cap.
  const { data: turn, error: turnErr } = await db
    .rpc('kb_begin_turn', { p_conversation_id: conversationIn, p_question: question })
    .maybeSingle()
  if (turnErr || !turn) {
    const message = turnErr?.message ?? 'The question could not be recorded.'
    const status = /thirty questions/.test(message) ? 429 : /not yours|active staff/.test(message) ? 403 : 400
    return json({ error: message.replace(/^[^:]*: /, '') }, status, origin)
  }
  const conversationId = (turn as { conversation_id: string }).conversation_id

  // 3. Retrieve, as the caller.
  const vector = await embed(question)
  const { data: found, error: searchErr } = await db.rpc('search_knowledge_base', {
    p_query: question,
    p_embedding: JSON.stringify(vector),
    p_limit: PASSAGES,
  })
  if (searchErr) return json({ error: 'The policies could not be searched right now.' }, 500, origin)
  const passages = (found ?? []) as Passage[]

  const stream = new TransformStream<Uint8Array, Uint8Array>()
  const writer = stream.writable.getWriter()
  const enc = new TextEncoder()
  const send = (event: Record<string, unknown>) => writer.write(enc.encode(JSON.stringify(event) + '\n'))

  const citations: Citation[] = passages.map((p, i) => ({
    n: i + 1,
    document_id: p.document_id,
    page_id: p.page_id,
    title: p.title,
    heading_path: p.heading_path,
    anchor: p.anchor,
    version: p.version,
    excerpt: excerptOf(p),
  }))

  const record = async (content: string, opts: { model: string | null; input: number | null; output: number | null; refused: boolean; cited: number[] }) => {
    const { data, error } = await db.rpc('kb_record_answer', {
      p_conversation_id: conversationId,
      p_content: content,
      p_model: opts.model,
      p_input_tokens: opts.input,
      p_output_tokens: opts.output,
      p_refused: opts.refused,
      p_citations: opts.cited.map((n) => {
        const c = citations[n - 1]
        return { document_id: c.document_id, title: c.title, heading_path: c.heading_path, anchor: c.anchor, version: c.version, excerpt: c.excerpt }
      }),
    })
    if (error) console.error(JSON.stringify({ event: 'kb_ask_record_failed', message: error.message }))
    return (data as string | null) ?? null
  }

  const best = passages[0]
  const covered = Boolean(best) && (best.lexical_rank !== null || (best.similarity ?? 0) >= SIMILARITY_FLOOR)

  ;(async () => {
    try {
      await send({ type: 'meta', conversation_id: conversationId, citations })

      // 4. Refuse before spending a token.
      if (!covered || !ANTHROPIC_API_KEY) {
        if (!ANTHROPIC_API_KEY) console.error(JSON.stringify({ event: 'kb_ask_misconfigured', reason: 'ANTHROPIC_API_KEY unset' }))
        await send({ type: 'delta', text: REFUSAL })
        const id = await record(REFUSAL, { model: null, input: null, output: null, refused: true, cited: [] })
        await send({ type: 'done', message_id: id, refused: true, cited: [] })
        return
      }

      // The conversation so far, as the caller may read it: the earlier turns
      // of this conversation, oldest first, without the question just recorded.
      const { data: history } = await db
        .from('kb_messages')
        .select('role, content, created_at')
        .eq('conversation_id', conversationId)
        .order('created_at', { ascending: false })
        .limit(HISTORY_TURNS + 1)
      const earlier = ((history ?? []) as { role: 'user' | 'assistant'; content: string }[]).slice(1).reverse()

      const messages = [
        ...earlier.map((m) => ({ role: m.role, content: m.content })),
        {
          role: 'user' as const,
          content: `Passages from the firm's policies:\n\n${passagesBlock(passages)}\n\n---\n\nQuestion: ${question}`,
        },
      ]

      // 5. Claude, streaming.
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({ model: MODEL, max_tokens: MAX_TOKENS, stream: true, system: SYSTEM_PROMPT, messages }),
      })
      if (!res.ok || !res.body) {
        const detail = await res.text().catch(() => '')
        console.error(JSON.stringify({ event: 'kb_ask_model_failed', status: res.status, detail: detail.slice(0, 300) }))
        await send({ type: 'error', message: 'The assistant is unavailable right now. The policies themselves are still searchable.' })
        return
      }

      let answer = ''
      let inputTokens: number | null = null
      let outputTokens: number | null = null
      const reader = res.body.getReader()
      const dec = new TextDecoder()
      let buf = ''
      for (;;) {
        const { value, done } = await reader.read()
        if (done) break
        buf += dec.decode(value, { stream: true })
        const lines = buf.split('\n')
        buf = lines.pop() ?? ''
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          let ev: Record<string, unknown>
          try {
            ev = JSON.parse(line.slice(6))
          } catch {
            continue
          }
          if (ev.type === 'message_start') {
            inputTokens = ((ev.message as { usage?: { input_tokens?: number } })?.usage?.input_tokens) ?? null
          } else if (ev.type === 'content_block_delta') {
            const text = (ev.delta as { type?: string; text?: string })?.text
            if (typeof text === 'string' && text) {
              answer += text
              await send({ type: 'delta', text })
            }
          } else if (ev.type === 'message_delta') {
            outputTokens = ((ev.usage as { output_tokens?: number })?.output_tokens) ?? outputTokens
          }
        }
      }

      // 6. Record: the answer, its cost, and the passages it actually cited.
      const cited = citedNumbers(answer, passages.length)
      const refused = answer.includes(REFUSAL) && cited.length === 0
      const id = await record(answer, { model: MODEL, input: inputTokens, output: outputTokens, refused, cited })
      await send({ type: 'done', message_id: id, refused, cited, model: MODEL })
    } catch (e) {
      console.error(JSON.stringify({ event: 'kb_ask_failed', message: e instanceof Error ? e.message : String(e) }))
      await send({ type: 'error', message: 'Something went wrong while answering.' }).catch(() => {})
    } finally {
      await writer.close().catch(() => {})
    }
  })()

  return new Response(stream.readable, {
    status: 200,
    headers: { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-store', ...corsHeaders(origin) },
  })
})
