/**
 * The board's pure vocabulary: lanes, the status→lane mapping, the card shape.
 *
 * In its own module, with NO server import, because the board component is a
 * Client Component. When these lived beside the fetchers in workflows.ts the
 * browser bundle pulled in lib/supabase/server and, through it, next/headers —
 * which Next refuses at build time. Vitest did not catch that: it does not
 * enforce the server/client boundary. A real browser did, on the first drag.
 */
import type { WorkflowStatus, WorkflowType } from '@/lib/notes'

/**
 * The four lanes of the board, in order. These ARE statuses — dropping a card
 * in a lane sets its status to the lane's id — which is why 'under_review' had
 * to be added to the enum rather than invented on the client.
 */
export const BOARD_COLUMNS = [
  { id: 'not_started', label: 'Not started' },
  { id: 'in_progress', label: 'In progress' },
  { id: 'under_review', label: 'Under review' },
  { id: 'complete', label: 'Completed' },
] as const

export type BoardColumn = (typeof BOARD_COLUMNS)[number]['id']

/**
 * Which lane a status lives in.
 *
 * `blocked` is a CONDITION of work in progress, not a stage of its own, so it
 * sits in the In progress lane and the card carries a warning mark. `cancelled`
 * is not on the board: cancelled work is not at any stage, and a lane for it
 * would turn a board of live work into an archive. The board says how many it
 * is not showing, so nothing disappears silently.
 */
export function columnFor(status: WorkflowStatus): BoardColumn | null {
  switch (status) {
    case 'blocked':
      return 'in_progress'
    case 'cancelled':
      return null
    default:
      return status
  }
}

/**
 * Priority, Jira-shaped. Ordered low → urgent so the menu reads in one
 * direction and `PRIORITIES.indexOf` is a sort key if one is ever needed.
 */
export const PRIORITIES = [
  { id: 'low', label: 'Low' },
  { id: 'medium', label: 'Medium' },
  { id: 'high', label: 'High' },
  { id: 'urgent', label: 'Urgent' },
] as const

export type Priority = (typeof PRIORITIES)[number]['id']

export type BoardCard = {
  id: string
  name: string
  workflow_type: WorkflowType
  status: WorkflowStatus
  priority: Priority
  group_id: string
  group_name: string
  owner_name: string | null
  started_at: string | null
  completed_at: string | null
  updated_at: string
}

/**
 * Board filters. Three, and they are LAYERED: owner first, then kind, then
 * priority. Each narrows what the next one offers, so an adviser who picks
 * themselves is only ever offered the kinds of work they actually own, and so
 * on down. A filter is `null` when it is not applied.
 */
export type BoardFilters = {
  owner: string | null
  type: WorkflowType | null
  priority: Priority | null
}

export const NO_FILTERS: BoardFilters = { owner: null, type: null, priority: null }

/** Sentinel owner key for cards with nobody assigned, so they can be filtered to. */
export const UNASSIGNED = '__unassigned__'

const ownerKey = (c: BoardCard) => c.owner_name ?? UNASSIGNED

export function applyFilters(cards: BoardCard[], f: BoardFilters): BoardCard[] {
  return cards.filter(
    (c) =>
      (f.owner === null || ownerKey(c) === f.owner) &&
      (f.type === null || c.workflow_type === f.type) &&
      (f.priority === null || c.priority === f.priority),
  )
}

/**
 * What each filter may offer, given the filters ABOVE it. Owner sees every
 * card; kind sees the owner's cards; priority sees the owner's cards of that
 * kind. Options come from the cards themselves, so a kind with no card is not
 * offered — an option that yields an empty board is a dead end, not a choice.
 */
export function filterOptions(cards: BoardCard[], f: BoardFilters) {
  const afterOwner = applyFilters(cards, { ...NO_FILTERS, owner: f.owner })
  const afterType = applyFilters(afterOwner, { ...NO_FILTERS, type: f.type })
  const uniq = <T,>(xs: T[]) => [...new Set(xs)]
  return {
    owners: uniq(cards.map(ownerKey)).sort((a, b) =>
      a === UNASSIGNED ? 1 : b === UNASSIGNED ? -1 : a.localeCompare(b),
    ),
    types: uniq(afterOwner.map((c) => c.workflow_type)),
    priorities: PRIORITIES.map((p) => p.id).filter((p) => afterType.some((c) => c.priority === p)),
  }
}

/**
 * Changing an upstream filter can strand a downstream one — pick an owner who
 * has no insurance claims and the kind filter "insurance_claim" now matches
 * nothing. Rather than show an empty board with a stale filter, a downstream
 * value the new options do not offer is cleared.
 */
export function reconcileFilters(cards: BoardCard[], f: BoardFilters): BoardFilters {
  const step1 = { ...f }
  const o1 = filterOptions(cards, step1)
  if (step1.type !== null && !o1.types.includes(step1.type)) step1.type = null
  const o2 = filterOptions(cards, step1)
  if (step1.priority !== null && !o2.priorities.includes(step1.priority)) step1.priority = null
  return step1
}

/* The words for the enums, here with the rest of the vocabulary so both a
   Client Component and a Server Component can read them. They used to live in
   the (client) file-notes module, which the workflow detail page — a Server
   Component — could not use. */
export const WORKFLOW_TYPE_LABEL: Record<WorkflowType, string> = {
  onboarding: 'Onboarding',
  annual_review: 'Annual review',
  advice_production: 'Advice production',
  insurance_claim: 'Insurance claim',
  ad_hoc: 'Ad hoc',
}

/**
 * Every status, in the order a person would read them: the four lanes in
 * sequence, with `blocked` beside the stage it is a condition of and
 * `cancelled` last because it is where work goes to stop.
 *
 * BOARD_COLUMNS is deliberately not this list. The board can only offer the
 * four it has lanes for; the detail page has no lanes, so it is the one screen
 * that can mark work blocked or cancelled.
 */
export const WORKFLOW_STATUSES = [
  'not_started',
  'in_progress',
  'blocked',
  'under_review',
  'complete',
  'cancelled',
] as const satisfies readonly WorkflowStatus[]

export const WORKFLOW_STATUS_LABEL: Record<WorkflowStatus, string> = {
  not_started: 'Not started',
  in_progress: 'In progress',
  blocked: 'Blocked',
  under_review: 'Under review',
  complete: 'Complete',
  cancelled: 'Cancelled',
}

/**
 * A workflow as its own page needs it: the card, plus the three fields only the
 * detail page reads.
 *
 * Deliberately NOT folded into BoardCard. The board fetches every workflow the
 * caller can see and renders none of these — a description per card is payload
 * for nothing, on the one query that returns the most rows.
 */
export type WorkflowDetail = BoardCard & {
  /** The owner's staff id, for the picker. `owner_name` is the resolved name. */
  owner_staff_id: string | null
  /** An instant: when the record was made. Rendered in the reader's timezone. */
  created_at: string
  /** A calendar date, or none set. Rendered by splitting the string. */
  due_at: string | null
  description: string | null
}

/**
 * How far a workflow has come, as a percentage — DERIVED from its status, never
 * stored.
 *
 * The board's four lanes are the stages, so the status already answers this. A
 * `progress` column would be a second answer to the same question, and the two
 * would part company the first time somebody dragged a card without updating
 * it. Evenly spaced across the four lanes: 0, 33, 67, 100.
 *
 * `blocked` reports the same 33% as in_progress, because blocked work sits in
 * the In progress lane. It has come exactly as far as it has come; the amber
 * Blocked pill is what says it has stopped, and moving the bar backwards would
 * claim work was undone.
 *
 * `cancelled` reports NO percentage. Cancelled work stopped somewhere nobody
 * recorded, and printing 0% would assert that nothing had been done.
 */
export function workflowProgress(status: WorkflowStatus): {
  percent: number | null
  label: string
} {
  const label = WORKFLOW_STATUS_LABEL[status]
  if (status === 'cancelled') return { percent: null, label }
  const lane = columnFor(status)
  const index = BOARD_COLUMNS.findIndex((c) => c.id === lane)
  return { percent: Math.round((index / (BOARD_COLUMNS.length - 1)) * 100), label }
}

/**
 * A task under a workflow: one thing to be done as part of the work.
 *
 * `task_type` has one value today. A checkbox task is a boolean selection —
 * done or not done — and its status IS that selection. Other kinds are
 * expected once templates exist; the column is here so the meaning is in place
 * before the second kind arrives.
 */
export type TaskType = 'checkbox'
export type TaskStatus = 'open' | 'done' | 'cancelled'

export const TASK_TYPE_LABEL: Record<TaskType, string> = {
  checkbox: 'Checkbox',
}

export const TASK_STATUS_LABEL: Record<TaskStatus, string> = {
  open: 'Open',
  done: 'Done',
  cancelled: 'Cancelled',
}

export type WorkflowTask = {
  id: string
  workflow_id: string
  task_type: TaskType
  subject: string
  /** What the task is. */
  description: string | null
  /** What the person doing it had to say. */
  comment: string | null
  /** A calendar date, or none. Rendered by splitting the string. */
  due_at: string | null
  status: TaskStatus
  /** The same four levels as a workflow's — see the Data Model page. */
  priority: Priority
  assigned_to_staff_id: string | null
  assigned_to_name: string | null
  completed_at: string | null
  created_at: string
  updated_at: string
}

/* ------------------------------------------------------------------------ */
/* Posts: the activity feed                                                 */
/* ------------------------------------------------------------------------ */

/**
 * A post's body is a DOCUMENT, never HTML.
 *
 * The shape is ProseMirror's — the editor produces it, the database validates
 * it, the renderer walks it — and it is deliberately a small subset: the node
 * and mark types below and no others. `post_workflow_activity()` refuses
 * anything else, so every stored document is one the renderer knows how to
 * draw, and nothing that reaches the screen is ever interpreted as markup.
 * The same list, in the same order, lives in that function; if one grows the
 * other must. It grew once, on 8 September, when the editor's remaining
 * built-in blocks — heading, blockquote, codeBlock, horizontalRule — and the
 * underline mark were switched on; the database's list grew in the same
 * change, and a heading may be level 1, 2 or 3 and nothing else.
 *
 * It grew again on 8 September to admit `image` and `attachment`, the first
 * nodes that are not typed. Both carry an ID from `workflow_post_media` and
 * NOTHING RESEMBLING AN ADDRESS — a `src` or an `href` would let a document
 * point at any host on the internet, which is the class of thing this closed
 * list exists to prevent. `post_workflow_activity()` refuses such a node
 * outright rather than scrubbing it, because nothing in this system produces
 * one.
 *
 * Two node types for one table, on purpose: an image is drawn in the post and
 * an attachment is a chip you click, so the renderer branches completely. The
 * row says what the bytes are and the node says how the post uses them, and
 * the write path checks the two agree.
 */
export const POST_NODE_TYPES = [
  'doc', 'paragraph', 'text', 'hardBreak', 'mention', 'entity', 'bulletList', 'orderedList', 'listItem',
  'heading', 'blockquote', 'codeBlock', 'horizontalRule', 'image', 'attachment', 'callout',
] as const
export const POST_MARK_TYPES = ['bold', 'italic', 'strike', 'code', 'link', 'underline'] as const
/**
 * A post has ONE heading size.
 *
 * It began as three, on the reasoning that three sizes of emphasis was already
 * a big reduction from the six the editor ships with. In use even three was
 * too many: a post is a paragraph or two about a piece of work, and nobody
 * writing one needs a heading hierarchy — the sizes were being picked
 * arbitrarily rather than structurally. Narrowed to one on 8 September.
 *
 * **The renderer still understands 2 and 3**, deliberately. Nothing stored
 * uses them — checked, zero headings of any level existed — but a renderer
 * that forgot how to draw a level it once accepted would be a renderer that
 * breaks history the moment one turns up.
 *
 * This constant is the only place the set is written. It configures the
 * editor's extension, decides how many buttons the toolbar has, and drives
 * what the composer parses back; the database's own check is narrowed in the
 * same change, because the database is the gate and the editor is not.
 */
export const POST_HEADING_LEVELS = [1] as const

/**
 * What an EMAIL body may contain — a narrower list than a post's.
 *
 * A post may name a colleague, a client, or bytes it has claimed. An email may
 * name none of those, and the reasons are specific rather than tidiness:
 *
 *  - a `mention` resolves to a staff member's CURRENT name at read time, which
 *    would silently rewrite a message that has already gone out;
 *  - an `entity` chip publishes a client's label into the record's plain text,
 *    which is the disclosure the chip rules exist to prevent;
 *  - an `image` or `attachment` claims a `workflow_post_media` row, and that
 *    claim belongs to posts — an email has its own attachments, one day, and
 *    they will not be post media.
 *
 * `record_task_action()` enforces exactly this list. As always the DATABASE is
 * the gate and the editor is configured to match, never the other way round;
 * a test asserts the two agree, both ways.
 */
export const EMAIL_NODE_TYPES = [
  'doc', 'paragraph', 'text', 'hardBreak', 'bulletList', 'orderedList', 'listItem',
  'heading', 'blockquote', 'codeBlock', 'horizontalRule',
] as const
export const EMAIL_MARK_TYPES = [
  'bold', 'italic', 'strike', 'code', 'link', 'underline', 'textStyle',
] as const

/**
 * The fonts a message may be written in — a CLOSED set, unlike its colour.
 *
 * Six stacks plus the default. Closed for two reasons that are about email
 * rather than about tidiness: a font the recipient's mail client does not have
 * silently falls back to something nobody chose, and these six are the ones
 * that render the same almost everywhere. `record_task_action()` checks a
 * stored `fontFamily` against exactly this list.
 *
 * **No quotes in any stack.** `font-family: Courier New, monospace` is valid
 * CSS unquoted, and keeping it that way means the database's `in (...)` check
 * is a plain string comparison rather than an escaping problem — the sort of
 * thing that drifts between two places the moment one of them needs a quote.
 *
 * The stack itself is stored, not a key, so the editor can show the writer the
 * font they picked. The renderer still checks membership before emitting it.
 */
export const EMAIL_FONTS = [
  { label: 'Default', stack: null },
  { label: 'Arial', stack: 'Arial, Helvetica, sans-serif' },
  { label: 'Georgia', stack: 'Georgia, serif' },
  { label: 'Times New Roman', stack: 'Times New Roman, serif' },
  { label: 'Courier New', stack: 'Courier New, monospace' },
  { label: 'Verdana', stack: 'Verdana, sans-serif' },
  { label: 'Tahoma', stack: 'Tahoma, sans-serif' },
] as const

export const EMAIL_FONT_STACKS: readonly string[] = EMAIL_FONTS.flatMap((f) =>
  f.stack ? [f.stack as string] : [],
)

/**
 * A message's colour is FREE, and the one place this schema stores a colour
 * rather than a key.
 *
 * Everywhere else the rule is the opposite — a callout's tone is `warning`, not
 * an amber, precisely so the tint stays the client's decision and every stored
 * row follows when it changes. A message is the exception on purpose: it is
 * prose sent to somebody outside the firm, so how it looks is a decision the
 * writer is making about that message and not a state this app renders.
 *
 * The cost is accepted rather than hidden: a colour in a message can never be
 * restyled, because it was never ours to restyle.
 *
 * Six hex digits only — no `rgb()`, no named colours, no `currentColor`. The
 * value reaches a `style` attribute in the History tab, so the gate checks the
 * shape and the renderer checks it again.
 */
export const HEX_COLOUR = /^#[0-9a-f]{6}$/i

export function isEmailColour(value: unknown): value is string {
  return typeof value === 'string' && HEX_COLOUR.test(value)
}

export function isEmailFont(value: unknown): value is string {
  return typeof value === 'string' && EMAIL_FONT_STACKS.includes(value)
}

/**
 * One heading size in a message, as a post has one.
 *
 * Written separately from POST_HEADING_LEVELS even though both are [1] today:
 * the two rules are independent — a message is prose sent to a client, a post
 * is a note to a colleague — and collapsing them would mean narrowing one
 * silently narrowed the other. `record_task_action()` enforces this one.
 */
export const EMAIL_HEADING_LEVELS = [1] as const

/** What a task's Tools tab can record. One today; the check constraint holds the same set. */
export const TASK_ACTION_KINDS = ['email'] as const
export type TaskActionKind = (typeof TASK_ACTION_KINDS)[number]

/** A closed set, checked before any call — so a bad kind is a sentence, not a constraint name. */
export function isTaskActionKind(value: unknown): value is TaskActionKind {
  return typeof value === 'string' && (TASK_ACTION_KINDS as readonly string[]).includes(value)
}

/**
 * One recorded action from a task's Tools tab, as the History tab reads it.
 *
 * `recipient` and `sender` are what was USED, not a live lookup — a record has
 * to say where the thing actually went, so a client changing their address
 * later must not rewrite it.
 */
export type TaskAction = {
  id: string
  workflow_id: string
  task_id: string
  kind: TaskActionKind
  actor_staff_id: string
  /** Resolved through staff_directory, so a departed colleague still has a name. */
  actor_name: string | null
  recipient: string | null
  sender: string | null
  subject: string | null
  body: PostDoc | null
  body_text: string
  /** An instant. Rendered in the reader's timezone. */
  occurred_at: string
}

/**
 * A callout's tone, as a KEY rather than a colour.
 *
 * The same reasoning as the reaction keys. A colour in the document would be a
 * decision one writer's browser made — unchangeable afterwards, impossible to
 * restyle, and free to imitate the tint the application itself uses to warn
 * about sensitive data. A key from a closed set is a meaning; the client maps
 * it to a tint. The database's check holds the same three.
 */
export const POST_CALLOUT_TONES = [
  { tone: 'info', label: 'Note' },
  { tone: 'warning', label: 'Careful' },
  { tone: 'success', label: 'Settled' },
] as const
export type CalloutTone = (typeof POST_CALLOUT_TONES)[number]['tone']
export function isCalloutTone(value: unknown): value is CalloutTone {
  return typeof value === 'string' && POST_CALLOUT_TONES.some((t) => t.tone === value)
}

/**
 * A mark on a run of text.
 *
 * The union covers a post's marks AND a message's, because ONE renderer draws
 * both — `PostBody` is handed an email body in the History tab. `textStyle` is
 * a message's only, and the renderer checks its two attributes against the
 * closed font list and the hex shape before it draws either.
 */
export type PostMark = {
  type: (typeof POST_MARK_TYPES)[number] | (typeof EMAIL_MARK_TYPES)[number]
  attrs?: { href?: string; fontFamily?: string; color?: string }
}
export type PostNode = {
  type: string
  text?: string
  attrs?: Record<string, unknown>
  marks?: PostMark[]
  content?: PostNode[]
}
export type PostDoc = { type: 'doc'; content?: PostNode[] }
export type PostMention = { staff_id: string; full_name: string }

/* ---- the things a post can point at ----------------------------------- */

/**
 * `#` names a client, a group, or another workflow.
 *
 * The chip carries an id and the label as typed, like a mention — but unlike a
 * mention it may only name something in the SAME CLIENT GROUP as the workflow
 * the post sits on. That is enforced by `post_workflow_activity()`, and the
 * reason is `body_text`: a chip's label is part of a post's plain text, which
 * everyone who can read the post can read, so a chip pointing outside the
 * group would publish a client's name to people with no right to it.
 */
export const POST_ENTITY_KINDS = [
  { kind: 'client', label: 'Client', noun: 'a client' },
  { kind: 'group', label: 'Group', noun: 'a group' },
  { kind: 'workflow', label: 'Workflow', noun: 'a workflow' },
] as const
export type EntityKind = (typeof POST_ENTITY_KINDS)[number]['kind']
export function isEntityKind(value: unknown): value is EntityKind {
  return typeof value === 'string' && POST_ENTITY_KINDS.some((k) => k.kind === value)
}

/** One candidate for the `#` menu: what the composer is allowed to offer. */
export type EntityChoice = { kind: EntityKind; id: string; label: string }

/**
 * An entity a post names, as the feed's view reports it.
 *
 * `label` is null when the reader cannot see the thing. The renderer draws a
 * neutral word in that case and never the document's own label — the one place
 * in the feed where falling back to stored text would be a disclosure.
 */
export type PostEntity = { kind: EntityKind; entity_id: string; label: string | null }

/** Where a chip goes when clicked. Workflows and groups have pages; a client is shown on its group's. */
export function entityHref(entity: PostEntity): string | null {
  if (entity.kind === 'workflow') return `/workflows/${entity.entity_id}`
  if (entity.kind === 'group') return `/groups/${entity.entity_id}`
  return null
}

/* ---- the bytes a post carries ----------------------------------------- */

/**
 * What a post may carry, and how big.
 *
 * The same three facts live in `post_media_size_limit()`,
 * `post_media_mime_types()` and `post_media_kind()` in the database, and THOSE
 * are the rule — they are the bucket's own settings, so Storage refuses a
 * wrong-typed or oversized body before a policy is even consulted. These
 * copies exist so a 40 MB drop is a sentence in the composer instead of a
 * round trip, and a test holds the two lists to each other.
 *
 * SVG and HTML are absent on purpose. Both can carry script, and drawing
 * either would undo the rule the entire document model exists to enforce.
 */
export const POST_MEDIA_BUCKET = 'post-media'
export const POST_MEDIA_SIZE_LIMIT = 10 * 1024 * 1024
export const POST_MEDIA_MIME_TYPES = [
  'image/png', 'image/jpeg', 'image/webp', 'image/gif',
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/csv', 'text/plain',
] as const
/** Drawn in the post, or offered as a chip to download. Derived, never taken from a client. */
export function postMediaKind(mime: string): 'image' | 'file' {
  return mime.startsWith('image/') ? 'image' : 'file'
}

/**
 * Just the pictures, for the Image button's file chooser.
 *
 * Derived from the one list rather than written out again, so a type added
 * above cannot be missing here — and `postMediaKind` stays the single
 * definition of what counts as a picture.
 */
export const POST_IMAGE_MIME_TYPES = POST_MEDIA_MIME_TYPES.filter(
  (mime) => postMediaKind(mime) === 'image',
)
export function isPostMediaType(mime: string): mime is (typeof POST_MEDIA_MIME_TYPES)[number] {
  return (POST_MEDIA_MIME_TYPES as readonly string[]).includes(mime)
}
/** What the composer may drag an image to, and what the database will accept. */
export const POST_IMAGE_MIN_WIDTH = 40
export const POST_IMAGE_MAX_WIDTH = 2000

/**
 * A file on a post, as the feed's view reports it.
 *
 * The document names only the id; everything else comes from here, so a
 * filename corrected in the row shows through on a post that cannot itself be
 * edited. `redacted_at` set means the bytes are gone: the post is unchanged and
 * the screen says who removed it, which is the whole point of redacting rather
 * than deleting.
 */
export type PostMedia = {
  id: string
  kind: 'image' | 'file'
  name: string
  mime_type: string
  byte_size: number
  /** Images only, measured by the browser: enough to reserve the space so the feed does not jump. */
  width: number | null
  height: number | null
  redacted_at: string | null
  redacted_by_name: string | null
}

/** Where the app serves a post's bytes from. The route re-checks access and signs a short-lived URL. */
export function postMediaUrl(id: string): string {
  return `/api/post-media/${id}`
}

export type WorkflowPost = {
  id: string
  workflow_id: string
  /** Null for a post on the workflow as a whole; the timeline shows both. */
  task_id: string | null
  author_staff_id: string
  author_name: string | null
  body: PostDoc
  /** The database's plain-text reading of the body. */
  body_text: string
  /** A timestamptz — an instant. Rendered in the reader's timezone. */
  created_at: string
  /** Who the post names, resolved to their CURRENT names by the view. */
  mentioned: PostMention[]
  /** Reactions grouped by kind, in the order each kind first appeared, each naming who gave it. */
  reactions: PostReaction[]
  /** The files the post carries, by upload order. Empty on a post still being accepted. */
  media: PostMedia[]
  /** The clients, groups and workflows the post names, each resolved to its current name. */
  entities: PostEntity[]
  /** The post this one answers. Null starts a thread. Any depth is permitted. */
  parent_post_id: string | null
  /** The thread this belongs to. Null means this post IS the thread's root. */
  root_post_id: string | null
  /** Who is being answered, for the one case a single indent cannot show — see `threadOf`. */
  parent_author_name: string | null
}

/* ---- threads ----------------------------------------------------------- */

/**
 * A top-level post and everything that answers it, however deeply.
 *
 * **Arbitrary depth in the data, one indent on the screen.** A reply may
 * answer a reply, and `parent_post_id` records exactly that — it is a real
 * fact about a conversation and cannot be recovered once flattened. But every
 * descendant is drawn at a single indent, because the reading column runs out
 * of room at the third level and a deep thread makes the workflow timeline
 * unreadable once posts from several tasks interleave.
 *
 * The cost of flattening is that a reply three levels down would look like a
 * reply to the root, so `parent_author_name` is shown whenever the parent is
 * NOT the root — which is the only case a single indent cannot express on its
 * own.
 */
export type PostThread = { root: WorkflowPost; replies: WorkflowPost[] }

/**
 * Group a flat list of posts into threads.
 *
 * Roots keep the order they arrive in — newest first, which the query decides —
 * and replies are sorted **oldest first** within their thread: a timeline is
 * scanned from the top, a conversation is read downward.
 *
 * A reply whose root is not in the list is promoted to a root of its own
 * rather than dropped. That happens when the feed is filtered to one task and
 * something has gone wrong upstream — and a reply that cannot find its parent
 * is still something a person wrote, so it is shown rather than silently lost.
 */
export function threadPosts(posts: WorkflowPost[]): PostThread[] {
  const roots = posts.filter((p) => p.root_post_id === null)
  const byRoot = new Map<string, WorkflowPost[]>(roots.map((r) => [r.id, []]))
  const orphans: WorkflowPost[] = []

  for (const p of posts) {
    if (p.root_post_id === null) continue
    const thread = byRoot.get(p.root_post_id)
    if (thread) thread.push(p)
    else orphans.push(p)
  }

  const oldestFirst = (a: WorkflowPost, b: WorkflowPost) =>
    a.created_at === b.created_at ? a.id.localeCompare(b.id) : a.created_at.localeCompare(b.created_at)

  const threads: PostThread[] = roots.map((root) => ({
    root,
    replies: (byRoot.get(root.id) ?? []).sort(oldestFirst),
  }))
  for (const o of orphans) threads.push({ root: o, replies: [] })
  return threads
}

/**
 * The six reactions a post can carry. A closed set, stored as the KEY rather
 * than the character: "heart" cannot arrive with and without a variation
 * selector and become two rows, and the key is what the accessible label is
 * built from. The database's check constraint holds the same six; if one list
 * grows the other must.
 */
export const REACTIONS = [
  { key: 'thumbs_up', glyph: '👍', label: 'Thumbs up' },
  { key: 'tick', glyph: '✅', label: 'Done' },
  { key: 'eyes', glyph: '👀', label: 'Looking at this' },
  { key: 'party', glyph: '🎉', label: 'Celebrate' },
  { key: 'heart', glyph: '❤️', label: 'Love' },
  { key: 'thanks', glyph: '🙏', label: 'Thanks' },
] as const
export type ReactionKey = (typeof REACTIONS)[number]['key']
export const REACTION_KEYS: readonly ReactionKey[] = REACTIONS.map((r) => r.key)
export function isReactionKey(value: unknown): value is ReactionKey {
  return typeof value === 'string' && (REACTION_KEYS as readonly string[]).includes(value)
}
export type PostReaction = { reaction: ReactionKey; by: PostMention[] }

/**
 * The optimistic half of a toggle: what the reactions look like once the
 * viewer's reaction is added or taken away. Mirrors what the view will say
 * after the server's round trip — a new kind goes on the end, an emptied kind
 * disappears — so the provisional and the real render the same.
 */
export function toggleReaction(
  reactions: PostReaction[],
  key: ReactionKey,
  viewer: PostMention,
): PostReaction[] {
  const existing = reactions.find((r) => r.reaction === key)
  if (!existing) return [...reactions, { reaction: key, by: [viewer] }]
  const mine = existing.by.some((b) => b.staff_id === viewer.staff_id)
  const by = mine ? existing.by.filter((b) => b.staff_id !== viewer.staff_id) : [...existing.by, viewer]
  return reactions
    .map((r) => (r.reaction === key ? { ...r, by } : r))
    .filter((r) => r.by.length > 0)
}

/** The cheap shape check a client can do before a round trip. The database does the real one. */
export function isPostDoc(value: unknown): value is PostDoc {
  if (typeof value !== 'object' || value === null) return false
  const v = value as { type?: unknown; content?: unknown }
  return v.type === 'doc' && (v.content === undefined || Array.isArray(v.content))
}

/**
 * The plain text of a document, for "is there anything here" and for the
 * optimistic entry before the server's own `body_text` arrives. The database's
 * `activity_doc_text()` is the authority; this agrees with it on the cases the
 * client needs and is tested against the same inputs.
 */
const POST_TEXT_BLOCKS = new Set(['paragraph', 'listItem', 'hardBreak', 'heading', 'blockquote', 'codeBlock', 'horizontalRule'])
export function postDocText(doc: PostDoc): string {
  const out: string[] = []
  const walk = (n: PostNode) => {
    if (n.type === 'text') out.push(n.text ?? '')
    else if (n.type === 'mention') out.push('@' + String(n.attrs?.label ?? ''))
    /* Inline, like a mention: a chip is a word in a sentence, so it emits no
       block boundary. */
    else if (n.type === 'entity') out.push('#' + String(n.attrs?.label ?? ''))
    /* A newline AND its words, in that order: media emits text where every
       other block emits a boundary, so without the newline its alt text runs
       into the paragraph above — "we saw thisscreenshot.png". */
    else if (n.type === 'image') out.push('\n' + imageWords(n))
    else if (n.type === 'attachment') out.push('\n' + (attr(n, 'name') || 'File'))
    else if (POST_TEXT_BLOCKS.has(n.type)) out.push('\n')
    for (const c of n.content ?? []) walk(c)
  }
  for (const c of doc.content ?? []) walk(c)
  return out.join('').replace(/\n{2,}/g, '\n').trim()
}

/** One trimmed string attribute, or ''. */
function attr(n: PostNode, key: string): string {
  return String(n.attrs?.[key] ?? '').trim()
}

/**
 * What an image reads as: its alt text, else its filename, else the word.
 *
 * An attachment has no `alt` and does not need one — a filename IS the
 * description of a file, whereas a picture needs one written because its
 * content is not in its name.
 */
function imageWords(n: PostNode): string {
  return attr(n, 'alt') || attr(n, 'name') || 'Image'
}

/** Every staff id a document mentions, once each. */
export function postMentionIds(doc: PostDoc): string[] {
  const ids = new Set<string>()
  const walk = (n: PostNode) => {
    if (n.type === 'mention' && typeof n.attrs?.id === 'string') ids.add(n.attrs.id)
    for (const c of n.content ?? []) walk(c)
  }
  for (const c of doc.content ?? []) walk(c)
  return [...ids]
}

/**
 * Every upload a document names — pictures and attached files alike — once
 * each.
 *
 * The companion to `postMentionIds`, and unused by the app for the same
 * reason: the composer tracks uploads still in flight with a counter rather
 * than by re-walking the document, and the database does its own claiming
 * from the document it was handed. Kept because "what does this document
 * refer to" is a question worth being able to ask of a stored post without
 * writing the walk again.
 */
export function postMediaIds(doc: PostDoc): string[] {
  const ids = new Set<string>()
  const walk = (n: PostNode) => {
    if ((n.type === 'image' || n.type === 'attachment') && typeof n.attrs?.id === 'string') {
      ids.add(n.attrs.id)
    }
    for (const c of n.content ?? []) walk(c)
  }
  for (const c of doc.content ?? []) walk(c)
  return [...ids]
}
