/**
 * The audit trail, as a screen reads it.
 *
 * Pure: types and presentation maps, no Supabase and no `next/headers`, so the
 * client component that draws the list can import it. The reader that fetches
 * rows is `lib/admin.ts`, the same split `workflow-board.ts` / `workflows.ts`
 * keep for posts and for the same reason.
 *
 * ## What the rows mean
 *
 * `record_audit()` writes one row per change. On INSERT `new_data` is the whole
 * row; on DELETE `old_data` is; on UPDATE both are NARROWED to the keys in
 * `changed_fields`, sorted, and an update that changed nothing writes no row.
 * `actor_staff_id` is null when the write came from the dashboard, a feed or
 * a direct connection (`actor_context = 'elevated'`): that is not missing
 * data, it is the record that no staff member did it, and the screen says
 * "System" rather than "Unknown".
 */

export type AuditAction = 'insert' | 'update' | 'delete'

export type AuditEntry = {
  id: number
  occurred_at: string
  table_name: string
  record_id: string | null
  action: AuditAction
  changed_fields: string[] | null
  old_data: Record<string, unknown> | null
  new_data: Record<string, unknown> | null
  actor_staff_id: string | null
  actor_context: 'api' | 'elevated'
  /** From staff_directory, so a former colleague is still named. */
  actor_name: string | null
  /** Recovered by the view from this row or an earlier one on the same record. */
  record_label: string | null
}

export type AuditFilters = {
  table?: string
  action?: AuditAction
  /** A staff id, or `'system'` for rows with no staff actor. */
  actor?: string
  /** Instants, ISO. `to` is exclusive. */
  from?: string
  to?: string
}

/** Where the last page ended. Both keys, because two rows can share an instant. */
export type AuditCursor = { occurred_at: string; id: number }

export type AuditActor = { id: string; name: string; status: string }

export const ACTION_LABEL: Record<AuditAction, string> = {
  insert: 'Added',
  update: 'Changed',
  delete: 'Removed',
}

/** `Pill` tones: a removal is the one that warrants colour. */
export const ACTION_TONE: Record<AuditAction, 'success' | 'neutral' | 'danger'> = {
  insert: 'success',
  update: 'neutral',
  delete: 'danger',
}

/**
 * Every table that carries a `record_audit` trigger, in plain words.
 *
 * `__tests__/audit.test.ts` scans the migrations and insists this map and the
 * set of audited tables agree in both directions, so a newly audited table
 * cannot reach the screen as `financial_account_owners`.
 */
export const TABLE_LABEL: Record<string, string> = {
  parties: 'Party',
  persons: 'Person',
  organisations: 'Organisation',
  party_roles: 'Party role',
  party_relationships: 'Relationship',
  contact_points: 'Contact detail',
  client_groups: 'Client group',
  client_group_members: 'Group membership',
  staff_users: 'Staff member',
  access_profiles: 'Access profile',
  staff_private_details: 'Staff private details',
  /* Renamed from teams / team_members on 20 Sep 2026, when the empty July
     tables became territories. The census follows `alter table … rename to`. */
  user_groups: 'User group',
  user_group_members: 'User group membership',
  client_group_access: 'Group access grant',
  notes: 'File note',
  note_subjects: 'Note subject',
  note_attachments: 'Note attachment',
  financial_accounts: 'Investment account',
  financial_account_owners: 'Account owner',
  financial_account_valuations: 'Account valuation',
  staff_access_assignments: 'Staff access assignment',
  workflow_post_media: 'Post attachment',
  assets_liabilities: 'Asset or liability',
  asset_liability_owners: 'Asset or liability owner',
  insurance_policies: 'Insurance policy',
  insurance_policy_parties: 'Policy party',
  staff_email_domains: 'Staff email domain',
}

export const NOT_AUDITED_COPY =
  'Not everything is audited. Workflows, tasks and posts, policy covers, account allocations, ' +
  'feed-supplied valuations and sensitive identifiers are outside this trail; sensitive-field ' +
  'reveals have their own log.'

/** `closed_on` → `Closed on`. */
export function humaniseField(key: string): string {
  const words = key.replace(/_id$/, '').split('_').filter(Boolean)
  if (words.length === 0) return key
  return words.map((w, i) => (i === 0 ? w[0]!.toUpperCase() + w.slice(1) : w)).join(' ')
}

/** The first block of a uuid, for a record the trail cannot name. */
export function shortId(id: string | null): string {
  return id ? id.slice(0, 8) : '—'
}

export function tableLabel(table: string): string {
  return TABLE_LABEL[table] ?? table
}

/**
 * Who did it. "System" for a write with no staff actor from an elevated
 * context — the dashboard, a feed, a direct connection. A row with no actor
 * from the API is possible only for a person not yet on the staff (see the
 * registration flow), and is named as such rather than as unknown.
 */
export function actorName(e: Pick<AuditEntry, 'actor_name' | 'actor_context'>): string {
  if (e.actor_name) return e.actor_name
  return e.actor_context === 'elevated' ? 'System' : 'Someone not yet on the staff'
}

/**
 * A value from a payload, as text. Never markup: whatever a person typed into
 * a record comes back here and is rendered as a text node or inside a `<pre>`.
 */
export function formatValue(v: unknown): { text: string; block: boolean } {
  if (v === null || v === undefined) return { text: '—', block: false }
  if (typeof v === 'boolean') return { text: v ? 'Yes' : 'No', block: false }
  if (typeof v === 'number') return { text: String(v), block: false }
  if (typeof v === 'string') return { text: v === '' ? '(blank)' : v, block: false }
  return { text: JSON.stringify(v, null, 2), block: true }
}

/** "Changed Investment account · Netwealth Wrap" */
export function describe(e: AuditEntry): string {
  const label = e.record_label ?? shortId(e.record_id)
  return `${ACTION_LABEL[e.action]} ${tableLabel(e.table_name)} · ${label}`
}

/**
 * The rows an expanded entry shows. An update lists exactly its changed
 * fields; an insert or a delete lists every key of the payload it kept.
 */
export function detailRows(e: AuditEntry): { field: string; before: unknown; after: unknown }[] {
  if (e.action === 'update') {
    return (e.changed_fields ?? []).map((f) => ({
      field: f,
      before: e.old_data?.[f],
      after: e.new_data?.[f],
    }))
  }
  const data = (e.action === 'insert' ? e.new_data : e.old_data) ?? {}
  return Object.keys(data)
    .sort()
    .map((f) => ({ field: f, before: e.action === 'delete' ? data[f] : undefined, after: e.action === 'insert' ? data[f] : undefined }))
}
