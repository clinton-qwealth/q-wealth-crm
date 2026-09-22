// kb-search — a question in, the policy passages that answer it out.
//
// /help's search box. It exists as an edge function for exactly one reason:
// the semantic arm needs the question embedded, gte-small runs only inside the
// Supabase edge runtime, and a Next.js route handler has no model. Everything
// else it does could have lived in the app.
//
// IT HOLDS NO KEY AND NO PRIVILEGE. The browser calls it with the person's
// session token; it validates that token, requires a second factor as
// /api/search does — a new front door does not inherit the locks — and then
// runs `search_knowledge_base` AS THAT PERSON, under RLS. There is nothing
// here a staff member could not do themselves.
//
// It replaced kb-ask on 22 Sep 2026, when the answering moved to Claude.
// kb-ask called Anthropic, applied a refusal floor and recorded the turn; none
// of that exists now. The record of a question is written by the app through
// `kb_record_handoff` when the person takes it to Claude, not here — searching
// is not an event worth recording, and rate-limiting a search that costs
// nothing would only get in the way.
import 'jsr:@supabase/functions-js/edge-runtime.d.ts'

import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!
const APP_BASE = (Deno.env.get('APP_BASE_URL') ?? 'https://crm.qwealth.com.au').replace(/\/+$/, '')
const PASSAGES = 8
const MAX_QUESTION = 2000

const JWT_SHAPE = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/

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
  console.warn(JSON.stringify({ event: 'kb_search_rejected', reason, ...detail }))
}

/** The token's claims, base64url-decoded. Read only AFTER getUser verified it. */
function claimsOf(token: string): Record<string, unknown> {
  const payload = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')
  const padded = payload + '='.repeat((4 - (payload.length % 4)) % 4)
  return JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(padded), (c) => c.charCodeAt(0))))
}

async function authenticate(authz: string, origin: string | null): Promise<SupabaseClient | Response> {
  if (!authz.startsWith('Bearer ')) {
    logRejection('Missing bearer token')
    return json({ error: 'Sign in to search the policies.' }, 401, origin)
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
  return db
}

// One session per isolate; constructing it is the slow part.
const model = new Supabase.ai.Session('gte-small')

Deno.serve(async (req: Request) => {
  const origin = req.headers.get('Origin')
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(origin) })
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405, origin)

  const db = await authenticate(req.headers.get('Authorization') ?? '', origin)
  if (db instanceof Response) return db

  let input: { question?: unknown; limit?: unknown }
  try {
    input = (await req.json()) as typeof input
  } catch {
    return json({ error: 'The body must be JSON.' }, 400, origin)
  }
  const question = typeof input.question === 'string' ? input.question.trim() : ''
  if (question.length < 3) return json({ error: 'Type a question first.' }, 400, origin)
  if (question.length > MAX_QUESTION) return json({ error: 'Keep a question under 2,000 characters.' }, 400, origin)
  const limit = typeof input.limit === 'number' ? Math.max(1, Math.min(20, Math.trunc(input.limit))) : PASSAGES

  // The embedding is why this function exists. If the model fails, the search
  // still runs on the keyword arm alone rather than the page showing nothing —
  // degraded and honest, like the palette, which never has an embedding.
  let embedding: string | null = null
  try {
    const out = (await model.run(question, { mean_pool: true, normalize: true })) as ArrayLike<number>
    embedding = JSON.stringify(Array.from(out))
  } catch (e) {
    console.warn(JSON.stringify({ event: 'kb_embed_failed', message: e instanceof Error ? e.message : String(e) }))
  }

  const { data, error } = await db.rpc('search_knowledge_base', {
    p_query: question,
    p_embedding: embedding,
    p_limit: limit,
  })
  if (error) {
    console.error(JSON.stringify({ event: 'kb_search_failed', message: error.message }))
    return json({ error: 'The policies could not be searched right now.' }, 500, origin)
  }

  return json({ passages: data ?? [], semantic: embedding !== null }, 200, origin)
})
