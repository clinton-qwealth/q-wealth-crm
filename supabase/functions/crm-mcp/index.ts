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
  // Two columns since 19 Sep 2026; `whoami` still returns one composed `name`,
  // so the contract to Claude is unchanged.
  first_name: string
  last_name: string
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

// THERE IS NO CLIENT PAGE. A person is read and edited in the member panel on
// their group's page, and has no URL of their own - the routes are /groups,
// /groups/[id], /workflows and /workflows/[id]. A `/clients/{id}` link was
// handed out here until 17 Sep 2026 and went to a 404. The link a client gets
// is their PRIMARY group's page, where the members list opens their record;
// a client in no current group gets no link rather than a broken one.
async function primaryGroupLinks(
  db: SupabaseClient,
  partyIds: string[],
): Promise<Record<string, string>> {
  if (partyIds.length === 0) return {}
  const { data } = await db
    .from('client_group_members')
    .select('party_id, group_id, is_primary_group')
    .in('party_id', partyIds)
    .is('end_date', null)
  const links: Record<string, string> = {}
  // Primary first; any current group as the fallback, so a person whose
  // primary flag was never set still resolves somewhere real.
  for (const row of data ?? []) {
    const r = row as { party_id: string; group_id: string; is_primary_group: boolean }
    if (r.is_primary_group || !links[r.party_id]) links[r.party_id] = groupLink(r.group_id)
  }
  return links
}

/**
 * Accounts and policies have no group column: they belong to the group(s) their
 * related parties belong to. Both tools therefore resolve parties first, and
 * share that step rather than duplicating it.
 */
async function resolveParties(
  db: SupabaseClient,
  partyId: string | undefined,
  groupId: string | undefined,
): Promise<{ ids: string[] } | { error: string }> {
  if (partyId) return { ids: [partyId] }
  const { data, error } = await db
    .from('client_group_members')
    .select('party_id')
    .eq('group_id', groupId!)
    .is('end_date', null)
  if (error) return { error: error.message }
  return { ids: (data ?? []).map((m) => (m as Record<string, unknown>).party_id as string) }
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
//
// Since 19 Sep 2026 a row may exist WITHOUT a profile: a person who asked to
// join and is awaiting approval, or one whose request was declined. The gate
// wants to tell those apart from "no row at all", so the row's status comes
// back alongside the staff object, which stays null until a profile exists.
async function getStaff(db: SupabaseClient, authUserId: string): Promise<{ staff: Staff | null; rowStatus: string | null }> {
  const { data, error } = await db
    .from('staff_users')
    .select(
      'id, first_name, last_name, email, status, staff_access_assignments(access_profiles(name, view_all_groups, view_sensitive, manage_groups, manage_staff, file_unmatched_notes))'
    )
    .eq('auth_user_id', authUserId)
    .maybeSingle()
  if (error || !data) return { staff: null, rowStatus: null }

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
  if (!profile) return { staff: null, rowStatus: row.status as string }

  return {
    staff: {
      id: row.id as string,
      first_name: row.first_name as string,
      last_name: row.last_name as string,
      email: row.email as string,
      status: row.status as string,
      access_profiles: profile,
    },
    rowStatus: row.status as string,
  }
}

function buildServer(db: SupabaseClient, staff: Staff) {
  const server = new McpServer({ name: 'q-wealth-crm', version: '0.2.2' })

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
        staff: { name: [staff.first_name, staff.last_name].filter(Boolean).join(' '), email: staff.email },
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
        'Search active clients (people and organisations) by name. Only returns clients visible to the calling staff member. ' +
        'group_link opens the page of the client\'s primary group, where their record is read and edited from the members list - ' +
        'a client has no page of their own. It is absent for a client in no current group.',
      inputSchema: { query: z.string().min(2).describe('Name or part of a name') },
    },
    async ({ query }) => {
      const { data, error } = await db
        .from('clients')
        .select('party_id, party_type, display_name, client_since, preferred_email, preferred_mobile')
        .ilike('display_name', `%${query}%`)
        .limit(20)
      if (error) return fail(error.message)
      const links = await primaryGroupLinks(db, (data ?? []).map((r) => r.party_id))
      return ok((data ?? []).map((r) => ({ ...r, group_link: links[r.party_id] ?? null })))
    }
  )

  server.registerTool(
    'get_client_profile',
    {
      title: 'Get client profile',
      description:
        'Full profile for a party (person or organisation): details, roles, relationships, contact points, group memberships, masked sensitive hints. ' +
        'Sensitive values are masked - full values only in the CRM app. Each group membership carries a link to that group\'s page; ' +
        'a client is opened from there, via the members list, and has no page of their own.',
      inputSchema: { party_id: z.string().uuid() },
    },
    async ({ party_id }) => {
      const { data: party, error } = await db
        .from('parties')
        // The organisation embed NAMES ITS KEY. `organisations` carries two
        // foreign keys to `parties` - party_id (the party it is) and
        // trustee_party_id (who acts for it) - and PostgREST refuses to guess
        // between them: "more than one relationship was found". Surfaced on
        // 17 Sep 2026 against a real client. `persons` has one key and needs
        // no hint.
        .select('*, persons(*), organisations!organisations_party_id_fkey(*)')
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
        groups: (memberships.data ?? []).map((row) => {
          const m = row as Record<string, unknown>
          const grp = m.client_groups as { id: string } | null
          return {
            role: m.member_role,
            primary: m.is_primary_group,
            group: grp,
            link: grp ? groupLink(grp.id) : null,
          }
        }),
        sensitive: { tfn_hint: tfnHint.data ?? null, note: 'Full values available in the CRM app only.' },
        // No `link`: the groups above each carry theirs, and the primary one is
        // where this person is opened. See primaryGroupLinks().
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
        'All client groups visible to you: the ones you own, the ones in your user groups (territories), the ones shared with you, and — unless your record is limited to your user groups — every group your access profile lets you see. Each row names its user_group_name, or null for a group in no territory.',
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
        .filter((row) => {
          const id = (row as Record<string, unknown>).id as string
          if (seen.has(id)) return false
          seen.add(id)
          return true
        })
        .map((row) => {
          // note_subjects is the join used to scope the query; it is not part of
          // the note. Copied and stripped rather than destructured, so no unused
          // binding is left behind.
          const note = { ...(row as Record<string, unknown>) }
          delete note.note_subjects
          return note
        })
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
        'Meeting notes ingested from integrations (e.g. Fyxer) not yet filed to a client. Visible to the meeting host and Services/Admin. Use file_note_to_client to file one.',
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
    'get_client_accounts',
    {
      title: 'Get financial accounts',
      description:
        'Investment and superannuation accounts for a client (party_id) or every member of a group (group_id). ' +
        'Ownership, not the group, is what an account belongs to, so a jointly-owned account is returned for both owners. ' +
        'IMPORTANT on values: latest_value is the most recent RECORDED valuation and valued_on is the date it applied - ' +
        'it is NOT a live balance and may be days or months old, so always state the as-at date when reporting a value. ' +
        'change_amount and change_pct compare latest_value against baseline_value, the average of the valuations in the ' +
        '30 days BEFORE the latest one. baseline_points is how many valuations that average came from; 0 means no trend ' +
        'can be stated at all. All amounts are AUD. ' +
        'valuation_source says who recorded latest_value: manual means a staff member typed it, integration means a ' +
        'provider feed wrote it and valuation_source_system names which one. ' +
        'available_cash is cash available to trade as at snapshot_as_at - a CURRENT figure, not a series, and it is ' +
        'already INSIDE latest_value, so never add the two. ' +
        'allocation is how the account is invested, as a list of {asset_class, weight}. Weights are FRACTIONS OF ONE ' +
        '(0.2456 is 24.56%), they MAY BE NEGATIVE - a short overlay or a pending settlement is real - and they are as ' +
        'the provider reported them, so they need not total exactly 1. allocation_as_at dates them and can be OLDER ' +
        'than snapshot_as_at, because a feed run refreshes cash every day but skips the allocation when its own checks ' +
        'fail. Always state allocation_as_at when reporting a mix.',
      inputSchema: {
        party_id: z.string().uuid().optional(),
        group_id: z.string().uuid().optional(),
      },
    },
    async ({ party_id, group_id }) => {
      if (!party_id && !group_id) return fail('Provide party_id or group_id.')
      const partyIds = await resolveParties(db, party_id, group_id)
      if ('error' in partyIds) return fail(partyIds.error)
      if (partyIds.ids.length === 0) return ok([])

      const { data: owners, error: oErr } = await db
        .from('financial_account_owners')
        .select('account_id')
        .in('party_id', partyIds.ids)
      if (oErr) return fail(oErr.message)

      const ids = [...new Set((owners ?? []).map((o) => (o as Record<string, unknown>).account_id as string))]
      if (ids.length === 0) return ok([])

      /*
       * An explicit column list, not `select('*')`, and the reason is one
       * column.
       *
       * `financial_accounts_summary` gained `product_display_name` on
       * 16 September. It reads like an account's name and is a fee-schedule
       * identifier: eleven of the first twenty HUB24 accounts shared one
       * string, and every CLOSED account's contains the word ACTIVE. A model
       * handed that alongside `label` will present it as the account's name,
       * and unlike a screen there is no designer between the value and the
       * reader. So it is withheld here deliberately - the web app shows it
       * under a "Product" heading, where saying ACTIVE is harmless.
       *
       * A star select would also mean every future column reaches a language
       * model the day it is added, unexplained.
       */
      const { data, error } = await db
        .from('financial_accounts_summary')
        .select(
          'account_id, account_type, label, account_number, status, opened_on, closed_on, ' +
            'provider, owners, owner_count, latest_value, valued_on, change_amount, change_pct, ' +
            'baseline_value, baseline_points, available_cash, snapshot_as_at, ' +
            'valuation_source, valuation_source_system, allocation, allocation_as_at',
        )
        .in('account_id', ids)
        .order('label')
      if (error) return fail(error.message)
      return ok(data ?? [])
    }
  )

  server.registerTool(
    'get_client_insurance',
    {
      title: 'Get insurance policies',
      description:
        'Personal insurance for a client (party_id) or every member of a group (group_id): life, TPD, trauma and income protection. ' +
        'A policy has BOTH owners (who hold the contract) and lives_insured (who is covered). These are often different people, ' +
        'so never assume the owner is the person covered. One policy can bundle several covers under one policy number. ' +
        'CRITICAL on amounts: every cover carries benefit_amount together with benefit_basis. benefit_basis is lump_sum for ' +
        'life, TPD and trauma, and monthly (occasionally annual) for income protection. A benefit_amount of 6500 with basis ' +
        'monthly means $6,500 PER MONTH, not $6,500 of cover. benefit_display gives the correctly worded figure - prefer it. ' +
        'total_lump_sum_cover and total_monthly_benefit are separate on purpose: a lump sum and an income stream are ' +
        'different quantities and must never be added together. All amounts are AUD.',
      inputSchema: {
        party_id: z.string().uuid().optional(),
        group_id: z.string().uuid().optional(),
      },
    },
    async ({ party_id, group_id }) => {
      if (!party_id && !group_id) return fail('Provide party_id or group_id.')
      const partyIds = await resolveParties(db, party_id, group_id)
      if ('error' in partyIds) return fail(partyIds.error)
      if (partyIds.ids.length === 0) return ok([])

      // Any policy role counts: a person whose life is insured on a policy someone
      // else owns still holds that cover.
      const { data: links, error: lErr } = await db
        .from('insurance_policy_parties')
        .select('policy_id')
        .in('party_id', partyIds.ids)
      if (lErr) return fail(lErr.message)

      const ids = [...new Set((links ?? []).map((r) => (r as Record<string, unknown>).policy_id as string))]
      if (ids.length === 0) return ok([])

      const { data: policies, error } = await db
        .from('insurance_policies_summary')
        .select('*')
        .in('policy_id', ids)
        .order('label')
      if (error) return fail(error.message)

      const { data: covers, error: cErr } = await db
        .from('insurance_policy_covers')
        .select('policy_id, cover_type, benefit_amount, benefit_basis, benefit_period, waiting_period, indexed')
        .in('policy_id', ids)
      if (cErr) return fail(cErr.message)

      // The web app has a formatter that encodes the basis rule. This consumer has
      // none, so the wording is applied here rather than left to be inferred.
      //
      // Return type stated explicitly: spreading a Record<string, unknown> into
      // an object literal drops the index signature, so the caller could no
      // longer read policy_id off the result.
      const worded = (row: Record<string, unknown>): Record<string, unknown> => {
        const money = Number(row.benefit_amount).toLocaleString('en-AU', {
          style: 'currency',
          currency: 'AUD',
          maximumFractionDigits: 0,
        })
        const basis = row.benefit_basis as string
        return {
          ...row,
          benefit_display:
            basis === 'monthly'
              ? `${money} per month`
              : basis === 'annual'
                ? `${money} per year`
                : `${money} lump sum`,
        }
      }

      const byPolicy = new Map<string, Record<string, unknown>[]>()
      for (const c of covers ?? []) {
        const row = worded(c as Record<string, unknown>)
        const key = row.policy_id as string
        if (!byPolicy.has(key)) byPolicy.set(key, [])
        byPolicy.get(key)!.push(row)
      }

      return ok(
        (policies ?? []).map((pol) => {
          const row = pol as Record<string, unknown>
          return { ...row, covers: byPolicy.get(row.policy_id as string) ?? [] }
        })
      )
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

  const { staff, rowStatus } = await getStaff(db, userData.user.id)
  if (!staff || staff.status !== 'active') {
    // Three sentences for three situations, so a person setting up the
    // connector learns what to do next rather than only that they may not.
    // None of them changes what is granted: nothing, in every case.
    const message =
      rowStatus === 'pending'
        ? 'Your request to join Q Wealth CRM is awaiting an administrator\'s approval'
        : rowStatus === null
          ? 'This account is not a Q Wealth staff member — sign in to the CRM and request access'
          : 'Not an active Q Wealth staff member'
    logRejection('Authenticated but not active staff', {
      email: userData.user.email,
      staff_row: rowStatus ?? 'none',
    })
    return new Response(JSON.stringify({ error: message }), {
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
