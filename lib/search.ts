import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * One thing the search found, in the shape the modal draws.
 *
 * `href` rather than an id and a kind, so the modal never has to know how a
 * section's rows are addressed — a new section is a query and a link, not a
 * branch in the component.
 */
export type SearchHit = {
  id: string
  title: string
  /** The line under the title: which group, what kind. Absent when there is
   *  nothing worth saying. */
  detail: string | null
  href: string
}

/**
 * The sections, in the order the modal shows them.
 *
 * Named rather than a flat list with a `kind` field, because the sections are
 * not interchangeable: each comes from a different query and carries a
 * different meaning, and a flat list would put that difference in a string.
 */
export type SearchResults = {
  households: SearchHit[]
  entities: SearchHit[]
  providers: SearchHit[]
  people: SearchHit[]
  workflows: SearchHit[]
  /** Passages of the firm's policies, since 22 Sep 2026. */
  knowledgebase: SearchHit[]
}

export const EMPTY_RESULTS: SearchResults = {
  households: [],
  entities: [],
  providers: [],
  people: [],
  workflows: [],
  knowledgebase: [],
}

/** Two characters, so a single keystroke does not sweep the whole database. */
export const MIN_QUERY = 2

/** Per section, so one section cannot crowd out the rest. */
export const PER_SECTION = 5

/**
 * Make a user's typing safe to put inside a PostgREST `ilike` filter.
 *
 * Two separate hazards, and both are real:
 *
 *   * `%` and `_` are LIKE wildcards. Typing `%` would otherwise match
 *     everything, which is not what the person meant and is a needless read of
 *     the whole table.
 *   * `,` `.` `(` `)` and `"` are PostgREST's own filter syntax. An unescaped
 *     comma ends the filter and the rest is parsed as another one, which fails
 *     the request rather than returning something wrong — but it fails on a
 *     perfectly ordinary thing to type, like "Smith, J".
 *
 * Wildcards are escaped with a backslash; the syntax characters are dropped,
 * because there is nothing sensible to match on them and quoting the value
 * would still leave the quote itself to handle.
 */
export function escapeForFilter(query: string) {
  return query
    .replace(/[%_\\]/g, (c) => `\\${c}`)
    .replace(/[,.()"]/g, ' ')
    .trim()
}

/**
 * Everything the caller may see, matching what they typed.
 *
 * ## Access
 *
 * **Nothing here filters by who is asking**, and that is deliberate rather than
 * missing: every table and view below is protected by row-level security, so a
 * query runs as the caller and returns exactly the rows that person could
 * already open. A staff member who has been deactivated matches nothing at all,
 * because every policy rests on `current_staff_id()`.
 *
 * ## Cost
 *
 * **One wave of five.** The queries need nothing from one another, so they go
 * together — a request to Supabase costs about 170ms whatever it carries, and
 * chaining these would make a search-as-you-type control five times slower for
 * no reason. Capped per section rather than overall, so a group with many
 * matching workflows cannot push the households off the list.
 *
 * ## The knowledge base is keyword-only here, on purpose
 *
 * `search_knowledge_base` fuses keyword and vector search when it is given an
 * embedding. Computing one means a hop to an edge function BEFORE this wave
 * can start (the vector is an input to the query), and a cold isolate takes
 * seconds to load the model — on the first search of a session, the one that
 * forms the opinion. So the palette passes `p_embedding = null` and gets the
 * keyword arm alone, in this same wave, at no added cost. Titles and jargon
 * are exactly where keyword matching is strongest; /help and the MCP tool are
 * where meaning-based search earns its hop.
 *
 * The RAW query goes to the function, not the escaped one: `escapeForFilter`
 * exists for PostgREST filter grammar, and an RPC argument is a bound
 * parameter that `websearch_to_tsquery` parses itself.
 */
export async function searchEverything(
  supabase: SupabaseClient,
  rawQuery: string,
): Promise<SearchResults> {
  const q = escapeForFilter(rawQuery)
  if (q.length < MIN_QUERY) return EMPTY_RESULTS

  const like = `%${q}%`

  const [groupsRes, peopleRes, providersRes, workflowsRes, kbRes] = await Promise.all([
    supabase
      .from('client_groups')
      .select('id, name, group_type')
      .ilike('name', like)
      .order('name')
      .limit(PER_SECTION * 2),
    /* `!inner` so the filter on the embedded name restricts the ROWS rather
       than merely emptying the embed — without it every current membership
       comes back with a null party attached. */
    supabase
      .from('client_group_members')
      .select('party_id, group_id, parties!inner(display_name), client_groups!inner(name)')
      .is('end_date', null)
      .ilike('parties.display_name', like)
      .limit(PER_SECTION),
    supabase
      .from('party_roles')
      .select('party_id, parties!inner(display_name)')
      .eq('role', 'product_provider')
      .eq('status', 'active')
      .is('end_date', null)
      .ilike('parties.display_name', like)
      .limit(PER_SECTION),
    supabase
      .from('workflow_board')
      .select('id, name, group_name')
      .ilike('name', like)
      .order('updated_at', { ascending: false })
      .limit(PER_SECTION),
    supabase.rpc('search_knowledge_base', {
      p_query: rawQuery.trim(),
      p_embedding: null,
      p_limit: PER_SECTION,
    }),
  ])

  const one = <T,>(v: unknown): T | null =>
    (Array.isArray(v) ? (v[0] as T) : (v as T)) ?? null

  const groups = groupsRes.data ?? []
  const asGroup = (type: string): SearchHit[] =>
    groups
      .filter((g) => g.group_type === type)
      .slice(0, PER_SECTION)
      .map((g) => ({
        id: g.id as string,
        title: g.name as string,
        detail: null,
        href: `/groups/${g.id}`,
      }))

  return {
    households: asGroup('household'),
    entities: asGroup('business_entity'),
    providers: (providersRes.data ?? []).map((r) => ({
      id: r.party_id as string,
      title: one<{ display_name?: string }>((r as Record<string, unknown>).parties)?.display_name ?? 'Unnamed',
      detail: 'Service provider',
      /* No page of its own yet. A provider is reachable only as a name on an
         account, so the link goes nowhere useful and the modal says so rather
         than sending somebody to a 404. */
      href: '',
    })),
    people: (peopleRes.data ?? []).map((r) => ({
      id: r.party_id as string,
      title: one<{ display_name?: string }>((r as Record<string, unknown>).parties)?.display_name ?? 'Unnamed',
      detail: one<{ name?: string }>((r as Record<string, unknown>).client_groups)?.name ?? null,
      /* Into their group's page. A person has no page of their own — their
         record is a panel on the group — so the group is where they are. */
      href: `/groups/${r.group_id}`,
    })),
    workflows: (workflowsRes.data ?? []).map((w) => ({
      id: w.id as string,
      title: w.name as string,
      detail: (w.group_name as string) ?? null,
      href: `/workflows/${w.id}`,
    })),
    knowledgebase: ((kbRes.data ?? []) as KnowledgeBaseHit[]).map((h) => ({
      id: h.chunk_id,
      title: h.title,
      /* The heading the passage sits under, so two passages of one policy
         read as two places rather than as a duplicate. The section when the
         passage is above the first heading. */
      detail: h.heading_path.length ? h.heading_path.join(' › ') : h.section,
      href: knowledgeBaseHref(h),
    })),
  }
}

/** A row of `search_knowledge_base`, as the palette and /help both receive it. */
export type KnowledgeBaseHit = {
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

/** Into the CRM's own reader, at the heading that matched — never out to Confluence. */
export function knowledgeBaseHref(hit: Pick<KnowledgeBaseHit, 'page_id' | 'anchor'>): string {
  return `/help/${encodeURIComponent(hit.page_id)}${hit.anchor ? `#${hit.anchor}` : ''}`
}
