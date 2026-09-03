// Q Wealth CRM — client identity verification
//
// An adviser on a telephone call sends a one-time code to the mobile ALREADY ON
// FILE, the client reads it back, and the adviser types it in. Twilio Verify
// generates, sends and checks the code, so the plaintext never exists here and
// never reaches a browser. A pass therefore requires the client to have
// actually received the message — the adviser cannot produce one alone.
//
// Auth: Supabase-issued user JWT required, validated in-function. The database
// client is built with the ANON key plus the caller's token, exactly as
// crm-mcp does, so every statement is evaluated by RLS as that person. The
// service-role key appears nowhere.
//
// This function holds no authorisation logic of its own. Staff status, the
// verify_identity permission, access to the party, "individuals only" and both
// rate limits all live in the database functions it calls, so a second caller
// or a bug here cannot route around them.
//
// NO CORS HEADERS, DELIBERATELY. This is called by the Next.js server, never by
// a browser, so there is no reason to make it reachable from a web page.
import 'jsr:@supabase/functions-js/edge-runtime.d.ts'

import { createClient, SupabaseClient } from '@supabase/supabase-js'
import { Hono } from 'hono'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!

const TWILIO_ACCOUNT_SID = Deno.env.get('TWILIO_ACCOUNT_SID') ?? ''
const TWILIO_VERIFY_SERVICE_SID = Deno.env.get('TWILIO_VERIFY_SERVICE_SID') ?? ''
// An API key is preferred over the account auth token: it can be rotated or
// revoked without touching the account password.
const TWILIO_KEY_SID = Deno.env.get('TWILIO_API_KEY_SID') ?? ''
const TWILIO_KEY_SECRET = Deno.env.get('TWILIO_API_KEY_SECRET') ?? ''
const TWILIO_AUTH_TOKEN = Deno.env.get('TWILIO_AUTH_TOKEN') ?? ''

// Stub mode must be turned ON explicitly. It is NOT inferred from missing
// credentials: if it were, losing a secret in production would silently turn
// every identity check into a formality that always passes. Missing credentials
// without this flag is a hard failure instead.
const STUB = Deno.env.get('IDENTITY_VERIFY_STUB') === '1'
// The only code a stubbed check will accept. Fixed and obvious, so a stubbed
// pass can never be mistaken for a real one by whoever is testing.
const STUB_CODE = '000000'

const app = new Hono().basePath('/identity-verify')

function log(event: string, detail: Record<string, unknown> = {}) {
  console.warn(JSON.stringify({ event, ...detail }))
}

const JWT_SHAPE = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function unauthorized(msg: string, detail: Record<string, unknown> = {}) {
  log('identity_verify_auth_rejected', { reason: msg, ...detail })
  return json({ error: msg }, 401)
}

/**
 * Turns a database refusal into a status code and a message fit to show an
 * adviser. The messages already read as English because the database functions
 * were written to be read by a person; what this adds is the right status and a
 * guarantee that raw Postgres noise never reaches the UI.
 */
function fromDbError(message: string) {
  const m = message ?? ''
  if (m.includes('verify_identity required')) return { status: 403, error: m }
  if (m.includes('second factor')) return { status: 403, error: m }
  if (m.includes('Not an active staff member')) return { status: 403, error: m }
  if (m.includes('not within your access')) return { status: 404, error: m }
  if (m.includes('Only an individual')) return { status: 400, error: m }
  if (m.includes('No mobile number on file')) return { status: 409, error: m }
  if (m.includes('Cannot read')) return { status: 409, error: m }
  if (m.includes('codes in the last') || m.includes('which is the limit')) {
    return { status: 429, error: m }
  }
  if (m.includes('Too many attempts')) return { status: 429, error: m }
  if (m.includes('No open verification')) return { status: 409, error: m }
  if (m.includes('recorded once')) return { status: 409, error: m }
  // Anything unrecognised is logged in full and reported blandly. A database
  // error message is not something to hand to a client-facing screen unread.
  log('identity_verify_unmapped_db_error', { message: m })
  return { status: 500, error: 'The verification could not be completed.' }
}

function twilioAuthHeader(): string | null {
  if (TWILIO_KEY_SID && TWILIO_KEY_SECRET) {
    return 'Basic ' + btoa(`${TWILIO_KEY_SID}:${TWILIO_KEY_SECRET}`)
  }
  if (TWILIO_ACCOUNT_SID && TWILIO_AUTH_TOKEN) {
    return 'Basic ' + btoa(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`)
  }
  return null
}

/** Twilio error codes worth translating rather than passing through raw. */
const TWILIO_MESSAGES: Record<number, string> = {
  21608: 'That number is not verified with the telephony provider. On a trial account a code can only be sent to a number added as a Verified Caller ID.',
  21614: 'That number cannot receive SMS.',
  60200: 'The telephony provider rejected that number.',
  60202: 'Too many attempts on this code. Send a new one.',
  60203: 'The provider has capped how many codes may be sent to this number. Try again later.',
  60205: 'That number is a landline and cannot receive SMS.',
  60212: 'Too many requests for this number at once. Try again in a moment.',
  20404: 'That code has expired or has already been used. Send a new one.',
  20003: 'The telephony credentials were rejected. Check the API key in the function secrets.',
}

type TwilioResult =
  | { ok: true; sid: string }
  | { ok: false; status: number; error: string }

async function twilioStartVerification(toE164: string): Promise<TwilioResult> {
  const auth = twilioAuthHeader()
  if (!auth || !TWILIO_VERIFY_SERVICE_SID) {
    // Reached only when stub mode is off, because start() checks STUB first.
    log('identity_verify_missing_credentials', {
      have_service_sid: Boolean(TWILIO_VERIFY_SERVICE_SID),
      have_auth: Boolean(auth),
    })
    return {
      ok: false,
      status: 503,
      error: 'Identity verification is not configured on the server.',
    }
  }

  const res = await fetch(
    `https://verify.twilio.com/v2/Services/${TWILIO_VERIFY_SERVICE_SID}/Verifications`,
    {
      method: 'POST',
      headers: {
        Authorization: auth,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ To: toE164, Channel: 'sms' }),
    },
  )

  const body = await res.json().catch(() => ({}))
  if (!res.ok) {
    const code = Number(body?.code ?? 0)
    // The destination is never logged: it is a client's mobile number.
    log('identity_verify_provider_refused', { http: res.status, provider_code: code })
    return {
      ok: false,
      status: res.status === 429 ? 429 : 502,
      error: TWILIO_MESSAGES[code] ?? 'The telephony provider refused to send the code.',
    }
  }
  return { ok: true, sid: String(body.sid) }
}

async function twilioCheckVerification(
  verificationSid: string,
  code: string,
): Promise<{ ok: true; approved: boolean } | { ok: false; status: number; error: string }> {
  const auth = twilioAuthHeader()
  if (!auth || !TWILIO_VERIFY_SERVICE_SID) {
    return { ok: false, status: 503, error: 'Identity verification is not configured on the server.' }
  }

  const res = await fetch(
    `https://verify.twilio.com/v2/Services/${TWILIO_VERIFY_SERVICE_SID}/VerificationCheck`,
    {
      method: 'POST',
      headers: {
        Authorization: auth,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      // Checked by VerificationSid rather than by number: it is exact, and it
      // means this function never has to hold the client's number to check.
      body: new URLSearchParams({ VerificationSid: verificationSid, Code: code }),
    },
  )

  const body = await res.json().catch(() => ({}))
  if (!res.ok) {
    const pcode = Number(body?.code ?? 0)
    log('identity_verify_check_refused', { http: res.status, provider_code: pcode })
    return {
      ok: false,
      status: res.status === 429 ? 429 : 502,
      error: TWILIO_MESSAGES[pcode] ?? 'The code could not be checked.',
    }
  }
  // Twilio reports 'approved' with valid: true. Anything else is not a pass.
  return { ok: true, approved: body?.status === 'approved' && body?.valid === true }
}

type Caller = { db: SupabaseClient; userId: string; email?: string }

/** Bearer token in, authenticated database client out. */
async function authenticate(authz: string): Promise<Caller | Response> {
  if (!authz.startsWith('Bearer ')) {
    return unauthorized('Missing bearer token', { header_present: authz.length > 0 })
  }
  const token = authz.slice(7)
  if (!JWT_SHAPE.test(token)) {
    // Supabase's publishable and secret keys are opaque strings, not JWTs, so
    // they land here. Worth naming, because "malformed" reads like a bug when
    // in fact an API key can never stand in for a person.
    return unauthorized('A user access token is required, not an API key', {
      token_length: token.length,
    })
  }

  const db = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const { data, error } = await db.auth.getUser(token)
  if (error || !data?.user) {
    return unauthorized('Invalid or expired token', {
      token_length: token.length,
      upstream: error?.message ?? 'no user on token',
    })
  }
  return { db, userId: data.user.id, email: data.user.email }
}

async function body(c: { req: { json: () => Promise<unknown> } }) {
  try {
    return (await c.req.json()) as Record<string, unknown>
  } catch {
    return {}
  }
}

// ---------------------------------------------------------------------------
// Start: send a code
// ---------------------------------------------------------------------------
app.post('/start', async (c) => {
  const who = await authenticate(c.req.header('Authorization') ?? '')
  if (who instanceof Response) return who
  const { db } = who

  const input = await body(c)
  const partyId = typeof input.party_id === 'string' ? input.party_id : ''
  const groupId = typeof input.group_id === 'string' ? input.group_id : null
  if (!partyId) return json({ error: 'No individual selected.' }, 400)

  // Everything that decides whether this is allowed happens here, in the
  // database: staff status, the permission, access to the party, individuals
  // only, the mobile looked up server-side, and both rate limits. The row is
  // written before the provider is called, so the limit cannot be outrun.
  const { data, error } = await db
    .rpc('begin_identity_verification', { p_party_id: partyId, p_group_id: groupId })
    .maybeSingle()

  if (error) {
    const mapped = fromDbError(error.message)
    return json({ error: mapped.error }, mapped.status)
  }
  if (!data) return json({ error: 'The verification could not be started.' }, 500)

  const verificationId = data.verification_id as string
  const e164 = data.destination_e164 as string
  const masked = data.destination_masked as string

  // The E.164 number exists only inside this function, for the provider call.
  // It is never put in the response.
  let sid: string
  let provider: 'twilio_verify' | 'stub'

  if (STUB) {
    log('identity_verify_stubbed_send', { verification_id: verificationId })
    sid = `STUB-${crypto.randomUUID()}`
    provider = 'stub'
  } else {
    const sent = await twilioStartVerification(e164)
    if (!sent.ok) {
      // The row already exists and counts against the rate limit, which is the
      // safe direction. Close it honestly rather than leaving it pending.
      await db.rpc('abandon_identity_verification', {
        p_id: verificationId,
        p_status: 'cancelled',
        p_reason: sent.error,
      })
      return json({ error: sent.error }, sent.status)
    }
    sid = sent.sid
    provider = 'twilio_verify'
  }

  const { error: attachErr } = await db.rpc('attach_verification_provider_sid', {
    p_id: verificationId,
    p_sid: sid,
    p_provider: provider,
  })
  if (attachErr) {
    // The code has been sent; failing to record the reference is a record
    // problem, not a client-facing one, so it is logged loudly and the caller
    // still learns the verification is open.
    log('identity_verify_attach_failed', {
      verification_id: verificationId,
      message: attachErr.message,
    })
  }

  return json({
    verification_id: verificationId,
    destination_masked: masked,
    provider,
    // Twilio's default verification lifetime. The countdown in the UI is
    // informational — expiry is the provider's to enforce.
    expires_in_seconds: 600,
    ...(STUB ? { stub_code: STUB_CODE } : {}),
  })
})

// ---------------------------------------------------------------------------
// Check: the client read a code back
// ---------------------------------------------------------------------------
app.post('/check', async (c) => {
  const who = await authenticate(c.req.header('Authorization') ?? '')
  if (who instanceof Response) return who
  const { db } = who

  const input = await body(c)
  const id = typeof input.verification_id === 'string' ? input.verification_id : ''
  const code = typeof input.code === 'string' ? input.code.replace(/\D/g, '') : ''
  if (!id) return json({ error: 'No verification selected.' }, 400)
  if (code.length !== 6) return json({ error: 'Enter the six digits the client read back.' }, 400)

  // Counted before the code is checked, so a wrong guess costs an attempt.
  const { error: attemptErr } = await db.rpc('note_verification_check_attempt', { p_id: id })
  if (attemptErr) {
    const mapped = fromDbError(attemptErr.message)
    return json({ error: mapped.error }, mapped.status)
  }

  // RLS decides whether this row is visible. `destination` is deliberately not
  // selected: checking by the provider's reference means this path never needs
  // the client's number.
  const { data: row, error: readErr } = await db
    .from('identity_verification')
    .select('provider, provider_sid, status')
    .eq('id', id)
    .maybeSingle()

  if (readErr || !row) return json({ error: 'No open verification to check.' }, 409)
  if (row.status !== 'pending') return json({ error: 'That verification is already closed.' }, 409)

  let approved: boolean
  if (row.provider === 'stub') {
    approved = code === STUB_CODE
    log('identity_verify_stubbed_check', { verification_id: id, approved })
  } else {
    if (!row.provider_sid) {
      return json({ error: 'That verification has no provider reference and cannot be checked.' }, 409)
    }
    const checked = await twilioCheckVerification(row.provider_sid, code)
    if (!checked.ok) return json({ error: checked.error }, checked.status)
    approved = checked.approved
  }

  const { error: outcomeErr } = await db.rpc('record_verification_outcome', {
    p_id: id,
    p_passed: approved,
    p_source: 'code_checked',
  })
  if (outcomeErr) {
    const mapped = fromDbError(outcomeErr.message)
    return json({ error: mapped.error }, mapped.status)
  }

  return json({ passed: approved, outcome_source: 'code_checked' })
})

// ---------------------------------------------------------------------------
// Attest: the fallback when no code could be delivered
// ---------------------------------------------------------------------------
// Recorded as adviser_attested, never as code_checked. The two are different
// strengths of evidence and the record keeps them apart permanently.
app.post('/attest', async (c) => {
  const who = await authenticate(c.req.header('Authorization') ?? '')
  if (who instanceof Response) return who
  const { db } = who

  const input = await body(c)
  const id = typeof input.verification_id === 'string' ? input.verification_id : ''
  if (!id) return json({ error: 'No verification selected.' }, 400)
  if (typeof input.passed !== 'boolean') {
    return json({ error: 'Say whether the check passed or failed.' }, 400)
  }

  const { error } = await db.rpc('record_verification_outcome', {
    p_id: id,
    p_passed: input.passed,
    p_source: 'adviser_attested',
  })
  if (error) {
    const mapped = fromDbError(error.message)
    return json({ error: mapped.error }, mapped.status)
  }
  return json({ passed: input.passed, outcome_source: 'adviser_attested' })
})

// ---------------------------------------------------------------------------
// Abandon: the code timed out, or the call ended
// ---------------------------------------------------------------------------
app.post('/abandon', async (c) => {
  const who = await authenticate(c.req.header('Authorization') ?? '')
  if (who instanceof Response) return who
  const { db } = who

  const input = await body(c)
  const id = typeof input.verification_id === 'string' ? input.verification_id : ''
  const status = input.status === 'expired' ? 'expired' : 'cancelled'
  const reason = typeof input.reason === 'string' ? input.reason.slice(0, 200) : null
  if (!id) return json({ error: 'No verification selected.' }, 400)

  const { error } = await db.rpc('abandon_identity_verification', {
    p_id: id,
    p_status: status,
    p_reason: reason,
  })
  if (error) {
    const mapped = fromDbError(error.message)
    return json({ error: mapped.error }, mapped.status)
  }
  return json({ status })
})

// Configuration readout. Deliberately says only whether each piece is PRESENT —
// never a value, never a partial value. Requires a valid staff token, so it is
// not a public fingerprint of the deployment.
app.get('/config', async (c) => {
  const who = await authenticate(c.req.header('Authorization') ?? '')
  if (who instanceof Response) return who
  return json({
    stub_mode: STUB,
    account_sid_present: Boolean(TWILIO_ACCOUNT_SID),
    verify_service_sid_present: Boolean(TWILIO_VERIFY_SERVICE_SID),
    provider_auth_present: Boolean(twilioAuthHeader()),
    auth_style: TWILIO_KEY_SID ? 'api_key' : TWILIO_AUTH_TOKEN ? 'auth_token' : 'none',
    ready: STUB || Boolean(twilioAuthHeader() && TWILIO_VERIFY_SERVICE_SID),
  })
})

// Confirms the provider credentials actually work, WITHOUT sending anything:
// it reads the Verify service back. No message, no cost, nobody's telephone
// rings. Staff-only, and it returns no client data of any kind.
app.get('/selftest', async (c) => {
  const who = await authenticate(c.req.header('Authorization') ?? '')
  if (who instanceof Response) return who

  const auth = twilioAuthHeader()
  if (!auth || !TWILIO_VERIFY_SERVICE_SID) {
    return json({ ok: false, reason: 'No provider credentials configured.' }, 503)
  }

  const res = await fetch(
    `https://verify.twilio.com/v2/Services/${TWILIO_VERIFY_SERVICE_SID}`,
    { headers: { Authorization: auth } },
  )
  const body = await res.json().catch(() => ({}))
  if (!res.ok) {
    const code = Number(body?.code ?? 0)
    log('identity_verify_selftest_failed', { http: res.status, provider_code: code })
    return json(
      {
        ok: false,
        http: res.status,
        provider_code: code,
        reason: TWILIO_MESSAGES[code] ?? 'The provider rejected the credentials.',
      },
      res.status === 401 || res.status === 403 ? 502 : 502,
    )
  }
  return json({
    ok: true,
    // The friendly name matters: it is interpolated into the message a client
    // receives, so it is worth reading back rather than assuming.
    service_friendly_name: body?.friendly_name ?? null,
    code_length: body?.code_length ?? null,
    auth_style: TWILIO_KEY_SID ? 'api_key' : 'auth_token',
  })
})

app.all('*', () => json({ error: 'Not found' }, 404))

Deno.serve(app.fetch)
