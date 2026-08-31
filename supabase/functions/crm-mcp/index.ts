// Q Wealth CRM MCP Server
// Auth: Supabase-issued user JWT required (validated in-function; RLS applies per user).
// Security rules: no raw SQL, no sensitive reveals (R5), append-only notes (R3).
import 'jsr:@supabase/functions-js/edge-runtime.d.ts'

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js'
import { createClient, SupabaseClient } from '@supabase/supabase-js'
import { Hono } from 'hono'
import { z } from 'zod'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!
// Deep-link base for the CRM UI. Set the APP_BASE_URL secret per environment;
// falls back to production so existing deployments keep working.
const APP_BASE = (Deno.env.get('APP_BASE_URL') ?? 'https://crm.qwealth.com.au').replace(/\/+$/, '')
const SELF_URL = `${SUPABASE_URL}/functions/v1/crm-mcp`

const app = new Hono().basePath('/crm-mcp')

type Staff = {
  id: string
  full_name: string
  email: string
  status: string
  access_profiles: {
    name: string
    view_all_groups: boolean
    view_sensitive: boolean
    manage_groups: boolean
    manage_staff: boolean
    file_unmatched_notes: boolean
  }
}

// Every rejection is logged in one structured shape so the auth path is
// greppable in the function logs (readiness checklist item 6: hostile-path
// tokens must be rejected AND logged). Token contents are never logged - only
// whether one was presented and how long it was.
function logRejection(reason: string, detail: Record<string, unknown> = {}) {
  console.warn(JSON.stringify({ event: 'mcp_auth_rejected', reason, ...detail }))
}

// A bearer token must at least look like a JWT before we spend a network
// round-trip asking Supabase Auth about it.
const JWT_SHAPE = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/

// NO RATE LIMITING HERE, DELIBERATELY. An in-memory per-instance throttle was
// built and measured on 31 Aug 2026: 28 rejections arrived across 26 distinct
// executions, so the counter never accumulated. Edge functions are stateless and
// horizontally scaled, and rejecting inside the function has already paid for the
// invocation anyway. Meaningful rate limiting belongs at an edge/CDN layer in
// front of this function. Tracked as an open item, not silently solved here.

function unauthorized(msg: string, detail: Record<string, unknown> = {}) {
  logRejection(msg, detail)
  return new Response(JSON.stringify({ error: msg }), {
    status: 401,
    headers: {
      'Content-Type': 'application/json',
      'WWW-Authenticate': `Bearer resource_metadata="${SELF_URL}/.well-known/oauth-protected-resource"`,
    },
  })
}

// OAuth protected resource metadata (RFC 9728) for MCP client discovery
app.get('/.well-known/oauth-protected-resource', (c) =>
  c.json({
    resource: SELF_URL,
    authorization_servers: [`${SUPABASE_URL}/auth/v1`],
    bearer_methods_supported: ['header'],
  })
)

app.get('/health', (c) => c.json({ ok: true, service: 'q-wealth-crm-mcp' }))

function groupLink(id: string) {
  return `${APP_BASE}/groups/${id}`
}
function clientLink(id: string) {
  return `${APP_BASE}/clients/${id}`
}

function ok(data: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] }
}
function fail(message: string) {
  return { content: [{ type: 'text' as const, text: `Error: ${message}` }], isError: true }
}

// Resolve the CALLING staff member. Must filter on auth_user_id: staff_users is
// readable by every active staff member, so an unfiltered select returns all rows
// and limit(1) picks an arbitrary one - the defect that broke add_note in August.
//
// The access profile is reached through staff_access_assignments, not directly.
// profile_id was moved out of staff_users on 31 Aug 2026 so that staff identity
// could be readable by colleagues while the permission mapping stayed restricted
// to administrators. Each staff member can always read their own assignment.
async function getStaff(db: SupabaseClient, authUserId: string): Promise<Staff | null> {
  const { data, error } = await db
    .from('staff_users')
    .select(
      'id, full_name, email, status, staff_access_assignments(access_profiles(name, view_all_groups, view_sensitive, manage_groups, manage_staff, file_unmatched_notes))'
    )
    .eq('auth_user_id', authUserId)
    .maybeSingle()
  if (error || !data) return null

  // The assignment is to-one (its primary key is staff_id), so PostgREST returns
  // an object. Tolerate an array too, in case relationship detection changes.
  const row = data as Record<string, unknown>
  const rawAssignment = row.staff_access_assignments
  const assignment = (Array.isArray(rawAssignment) ? rawAssignment[0] : rawAssignment) as
    | { access_profiles?: Staff['access_profiles'] }
    | null
    | undefined
  const profile = assignment?.access_profiles
  // No profile means no permissions at all. Refuse rather than proceed with a
  // partially-populated staff object.
  if (!profile) return null

  return {
    id: row.id as string,
    full_name: row.full_name as string,
    email: row.email as string,
    status: row.status as string,
    access_profiles: profile,
  }
}

function buildServer(db: SupabaseClient, staff: Staff) {
  const server = new McpServer({ name: 'q-wealth-crm', version: '0.1.5' })

  server.registerTool(
    'whoami',
    {
      title: 'Who am I',
      description:
        'Returns the calling staff member, their access profile and permissions. Use this to understand what the user can see and do.',
      inputSchema: {},
    },
    async () =>
      ok({
        staff: { name: staff.full_name, email: staff.email },
        profile: staff.access_profiles.name,
        permissions: staff.access_profiles,
        notes:
          'Sensitive values (TFN etc.) are never available here - masked hints only. Full reveals happen in the CRM app.',
      })
  )

  server.registerTool(
    'search_clients',
    {
      title: 'Search clients',
      description:
        'Search active clients (people and organisations) by name. Only returns clients visible to the calling staff member.',
      inputSchema: { query: z.string().min(2).describe('Name or part of a name') },
    },
    async ({ query }) => {
      const { data, error } = await db
        .from('clients')
        .select('party_id, party_type, display_name, client_since, preferred_email, preferred_mobile')
        .ilike('display_name', `%${query}%`)
        .limit(20)
      if (error) return fail(error.message)
      return ok(
        (data ?? []).map((r) => ({ ...r, link: clientLink(r.party_id) }))
      )
    }
  )

  server.registerTool(
    'get_client_profile',
    {
      title: 'Get client profile',
      description:
        'Full profile for a party (person or organisation): details, roles, relationships, contact points, group memberships, masked sensitive hints. Sensitive values are masked - full values only in the CRM app.',
      inputSchema: { party_id: z.string().uuid() },
    },
    async ({ party_id }) => {
      const { data: party, error } = await db
        .from('parties')
        .select('*, persons(*), organisations(*)')
        .eq('id', party_id)
        .maybeSingle()
      if (error) return fail(error.message)
      if (!party) return fail('Not found (or not within your visibility).')

      const [roles, contacts, memberships, relsFrom, relsTo, tfnHint] = await Promise.all([
        db.from('party_roles').select('role, status, start_date, end_date').eq('party_id', party_id),
        db
          .from('contact_points')
          .select('kind, value, address_line_1, suburb, state, postcode, is_preferred')
          .eq('party_id', party_id),
        db
          .from('client_group_members')
          .select('member_role, is_primary_group, client_groups(id, name, group_type, status)')
          .eq('party_id', party_id)
          .is('end_date', null),
        db
          .from('party_relationships')
          .select('relationship_type, to_party_id')
          .eq('from_party_id', party_id)
          .is('end_date', null),
        db
          .from('party_relationships')
          .select('relationship_type, from_party_id')
          .eq('to_party_id', party_id)
          .is('end_date', null),
        db.rpc('get_masked_hint', { p_party_id: party_id, p_kind: 'tfn' }),
      ])

      // resolve relationship names
      const relIds = [
        ...(relsFrom.data ?? []).map((r) => r.to_party_id),
        ...(relsTo.data ?? []).map((r) => r.from_party_id),
      ]
      let names: Record<string, string> = {}
      if (relIds.length) {
        const { data: relParties } = await db.from('parties').select('id, display_name').in('id', relIds)
        names = Object.fromEntries((relParties ?? []).map((p) => [p.id, p.display_name]))
      }

      return ok({
        party: { id: party.id, type: party.party_type, name: party.display_name, status: party.status },
        person: party.persons ?? null,
        organisation: party.organisations ?? null,
        roles: roles.data ?? [],
        relationships: [
          ...(relsFrom.data ?? []).map((r) => ({
            type: r.relationship_type,
            with: names[r.to_party_id] ?? r.to_party_id,
            direction: 'from this party',
          })),
          ...(relsTo.data ?? []).map((r) => ({
            type: r.relationship_type,
            with: names[r.from_party_id] ?? r.from_party_id,
            direction: 'towards this party',
          })),
        ],
        contact_points: contacts.data ?? [],
        groups: (memberships.data ?? []).map((m: any) => ({
          role: m.member_role,
          primary: m.is_primary_group,
          group: m.client_groups,
          link: m.client_groups ? groupLink(m.client_groups.id) : null,
        })),
        sensitive: { tfn_hint: tfnHint.data ?? null, note: 'Full values available in the CRM app only.' },
        link: clientLink(party.id),
      })
    }
  )

  server.registerTool(
    'search_groups',
    {
      title: 'Search client groups',
      description: 'Search households and business entity groups by name.',
      inputSchema: { query: z.string().min(2) },
    },
    async ({ query }) => {
      const { data, error } = await db
        .from('group_summary')
        .select('*')
        .ilike('name', `%${query}%`)
        .limit(20)
      if (error) return fail(error.message)
      return ok((data ?? []).map((g) => ({ ...g, link: groupLink(g.group_id) })))
    }
  )

  server.registerTool(
    'get_group',
    {
      title: 'Get client group',
      description: 'Household or business entity group detail with members and roles.',
      inputSchema: { group_id: z.string().uuid() },
    },
    async ({ group_id }) => {
      const { data, error } = await db.from('group_summary').select('*').eq('group_id', group_id).maybeSingle()
      if (error) return fail(error.message)
      if (!data) return fail('Not found (or not within your visibility).')
      return ok({ ...data, link: groupLink(group_id) })
    }
  )

  server.registerTool(
    'list_my_groups',
    {
      title: 'List my client groups',
      description:
        'All client groups visible to you. For advisers this is your book (owned + assigned); Services/Management/Admin see all groups.',
      inputSchema: {},
    },
    async () => {
      const { data, error } = await db.from('group_summary').select('*').order('name').limit(100)
      if (error) return fail(error.message)
      return ok((data ?? []).map((g) => ({ ...g, link: groupLink(g.group_id) })))
    }
  )

  server.registerTool(
    'get_notes',
    {
      title: 'Get notes',
      description: 'File notes and meeting summaries for a client (party_id) or a group (group_id), newest first.',
      inputSchema: {
        party_id: z.string().uuid().optional(),
        group_id: z.string().uuid().optional(),
        limit: z.number().int().min(1).max(50).default(10),
      },
    },
    async ({ party_id, group_id, limit }) => {
      if (!party_id && !group_id) return fail('Provide party_id or group_id.')
      // Query notes as the base table so ORDER BY and LIMIT are applied by
      // Postgres to the notes themselves. Filtering via an !inner embed on
      // note_subjects keeps the subject restriction without paginating on it.
      let q = db
        .from('notes')
        .select('id, note_type, title, body, occurred_at, source, match_status, note_subjects!inner(party_id, group_id)')
      q = party_id ? q.eq('note_subjects.party_id', party_id) : q.eq('note_subjects.group_id', group_id!)
      const { data, error } = await q.order('occurred_at', { ascending: false }).limit(limit)
      if (error) return fail(error.message)
      // A note can carry several subjects; drop the join column and de-duplicate.
      const seen = new Set<string>()
      const notes = (data ?? [])
        .filter((n: any) => (seen.has(n.id) ? false : (seen.add(n.id), true)))
        .map(({ note_subjects: _subjects, ...note }: any) => note)
      return ok(notes)
    }
  )

  server.registerTool(
    'search_notes',
    {
      title: 'Search notes and transcripts',
      description:
        'Full-text search across note titles, bodies and meeting transcripts (visibility-scoped). Example: "superannuation contribution".',
      inputSchema: { query: z.string().min(2), limit: z.number().int().min(1).max(25).default(10) },
    },
    async ({ query, limit }) => {
      const { data, error } = await db
        .from('notes')
        .select('id, note_type, title, body, occurred_at')
        .textSearch('search_tsv', query, { type: 'websearch', config: 'english' })
        .order('occurred_at', { ascending: false })
        .limit(limit)
      if (error) return fail(error.message)
      return ok(data ?? [])
    }
  )

  server.registerTool(
    'list_unmatched_notes',
    {
      title: 'List unmatched integration notes',
      description:
        'Meeting notes ingested from integrations (e.g. Fyxer) not yet filed to a client. Visible to the meeting host and Services/Admin.',
      inputSchema: {},
    },
    async () => {
      const { data, error } = await db
        .from('notes')
        .select('id, title, body, source_system, occurred_at')
        .eq('match_status', 'unmatched')
        .order('occurred_at', { ascending: false })
        .limit(25)
      if (error) return fail(error.message)
      return ok(data ?? [])
    }
  )

  server.registerTool(
    'add_note',
    {
      title: 'Add a file note',
      description:
        'Add an append-only file note against one or more clients and/or a group. Notes cannot be edited or deleted afterwards (rule R3) - corrections are made with a follow-up note.',
      inputSchema: {
        body: z.string().min(3).describe('The note text'),
        title: z.string().optional(),
        note_type: z
          .enum(['file_note', 'meeting_summary', 'phone_call', 'email_record', 'task_note', 'other'])
          .default('file_note'),
        party_ids: z.array(z.string().uuid()).optional().describe('Clients this note is about'),
        group_id: z.string().uuid().optional().describe('Group this note is about'),
        occurred_at: z.string().datetime().optional().describe('When it happened (defaults to now)'),
      },
    },
    async ({ body, title, note_type, party_ids, group_id, occurred_at }) => {
      if (!party_ids?.length && !group_id)
        return fail('A note must be about someone: provide party_ids and/or group_id.')
      // One transaction: the note and its subjects are written together or not
      // at all. Previously these were two statements and a failure between them
      // left a note filed against nobody.
      const { data: noteId, error } = await db.rpc('create_note_with_subjects', {
        p_body: body,
        p_party_ids: party_ids ?? null,
        p_group_id: group_id ?? null,
        p_title: title ?? null,
        p_note_type: note_type,
        p_occurred_at: occurred_at ?? null,
      })
      if (error) return fail(error.message)
      return ok({
        note_id: noteId,
        filed_against: (party_ids?.length ?? 0) + (group_id ? 1 : 0),
        reminder: 'Notes are append-only.',
      })
    }
  )

  server.registerTool(
    'file_note_to_client',
    {
      title: 'File an unmatched note',
      description:
        'File an integration note (e.g. a Fyxer meeting) that has not yet been matched to a client. Attaches it to one or more clients and/or a group, then marks it matched. Only unmatched notes can be filed, and the note content itself is never altered.',
      inputSchema: {
        note_id: z.string().uuid().describe('The unmatched note, from list_unmatched_notes'),
        party_ids: z.array(z.string().uuid()).optional().describe('Clients this note is about'),
        group_id: z.string().uuid().optional().describe('Group this note is about'),
      },
    },
    async ({ note_id, party_ids, group_id }) => {
      if (!party_ids?.length && !group_id)
        return fail('A note must be filed against someone: provide party_ids and/or group_id.')
      // One transaction. The function attaches the subjects first and flips the
      // status second: while a note is unmatched the caller's access comes from
      // being the meeting host or holding file_unmatched_notes, and once matched
      // it derives from the subjects. Doing it the other way would drop the
      // caller's own access mid-operation.
      const { data: filedId, error } = await db.rpc('file_unmatched_note', {
        p_note_id: note_id,
        p_party_ids: party_ids ?? null,
        p_group_id: group_id ?? null,
      })
      if (error) return fail(error.message)
      return ok({
        note_id: filedId,
        filed_against: (party_ids?.length ?? 0) + (group_id ? 1 : 0),
        match_status: 'matched',
        note: 'Filing is the only permitted change to a note. Content remains append-only.',
      })
    }
  )

  return server
}

// MCP endpoint - authenticated
app.all('/', async (c) => {
  const authz = c.req.header('Authorization') ?? ''
  if (!authz.startsWith('Bearer ')) {
    return unauthorized('Missing bearer token', { header_present: authz.length > 0 })
  }
  const token = authz.slice(7)

  // Cheap structural check before the round-trip to Supabase Auth.
  if (!JWT_SHAPE.test(token)) {
    return unauthorized('Malformed bearer token', { token_length: token.length })
  }

  const db = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const { data: userData, error: userErr } = await db.auth.getUser(token)
  if (userErr || !userData?.user) {
    // getUser delegates to Supabase Auth, which rejects expired, wrong-audience,
    // wrong-issuer and badly signed tokens alike. The upstream reason is recorded
    // so those cases are distinguishable in the logs.
    return unauthorized('Invalid or expired token', {
      token_length: token.length,
      upstream: userErr?.message ?? 'no user on token',
    })
  }

  const staff = await getStaff(db, userData.user.id)
  if (!staff || staff.status !== 'active') {
    logRejection('Authenticated but not active staff', {
      email: userData.user.email,
      staff_row: staff ? 'found but inactive' : 'none',
    })
    return new Response(JSON.stringify({ error: 'Not an active Q Wealth staff member' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const server = buildServer(db, staff)
  const transport = new WebStandardStreamableHTTPServerTransport()
  await server.connect(transport)
  return transport.handleRequest(c.req.raw)
})

Deno.serve(app.fetch)
