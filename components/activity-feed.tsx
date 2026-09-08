'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import {
  createPostMedia,
  postWorkflowActivity,
  redactPostMedia,
  togglePostReaction,
} from '@/app/(shell)/groups/actions'
import {
  POST_MEDIA_BUCKET,
  REACTIONS,
  postDocText,
  toggleReaction,
  type PostDoc,
  type PostMedia,
  type PostReaction,
  type ReactionKey,
  type WorkflowPost,
} from '@/lib/workflow-board'
import { createSupabaseBrowserClient } from '@/lib/supabase/client'
import { formatNoteDateTime } from '@/lib/note-date'
import { useServerState } from './use-server-state'
import { PostComposer, type PostUploader } from './post-composer'
import { PostBody } from './post-body'
import { InitialsTile } from './ui'

type Staff = { id: string; name: string }
type Viewer = { id: string; name: string; canRemoveAnyImage: boolean }

/**
 * The activity feed: a composer, then what has been posted, newest first.
 *
 * It takes EVERY post on the workflow and shows the ones for `taskId` — or all
 * of them when `taskId` is null, which is what the workflow's own timeline
 * will pass. Same component, same data, two views of it; that is the shape
 * the table was designed for.
 *
 * Posting is optimistic. The new post appears at the top the moment Post is
 * pressed, marked as posting, with the viewer as its author; if the server
 * refuses it, the entry is removed, the reason is shown, and the composer
 * keeps the words. When the server accepts, its revalidation re-seeds the list
 * through `useServerState` and the real row replaces the provisional one.
 *
 * Reactions are optimistic the same way: the chip changes at once and is put
 * back, with the reason, if the server refuses.
 */
export function ActivityFeed({
  workflowId,
  taskId,
  posts: initial,
  staff,
  viewer,
}: {
  workflowId: string
  /** Null shows the whole workflow's timeline. */
  taskId: string | null
  posts: WorkflowPost[]
  staff: Staff[]
  viewer: Viewer
}) {
  const [posts, setPosts] = useServerState(initial)
  const [error, setError] = useState<string | null>(null)

  const shown = taskId === null ? posts : posts.filter((p) => p.task_id === taskId)

  /**
   * How a picture gets out of the browser, in the two steps the database
   * requires: reserve the row, then write the bytes to the path it names.
   *
   * `send` goes straight from here to Storage rather than through a Server
   * Action. A Server Action's body is capped at 1 MB by default, and pushing
   * ten megabytes through the server would put them on the wire twice for
   * nothing — the upload is evaluated by the same RLS either way, as the same
   * staff member, because the browser client uses the publishable key and this
   * person's session.
   */
  const uploader = useMemo<PostUploader>(
    () => ({
      reserve: async (file, dimensions) => {
        const reserved = await createPostMedia(workflowId, {
          mime: file.type,
          size: file.size,
          name: file.name,
          width: dimensions?.width ?? null,
          height: dimensions?.height ?? null,
        })
        if ('error' in reserved) return reserved
        return { id: reserved.id, path: reserved.storage_path }
      },
      send: async (path, file) => {
        const supabase = createSupabaseBrowserClient()
        const { error: failure } = await supabase.storage
          .from(POST_MEDIA_BUCKET)
          .upload(path, file, { contentType: file.type, upsert: false })
        return failure ? { error: failure.message } : null
      },
    }),
    [workflowId],
  )

  async function post(doc: PostDoc): Promise<boolean> {
    const provisional: WorkflowPost & { pending: true } = {
      id: `pending-${Date.now()}`,
      workflow_id: workflowId,
      task_id: taskId,
      author_staff_id: viewer.id,
      author_name: viewer.name,
      body: doc,
      body_text: postDocText(doc),
      created_at: new Date().toISOString(),
      mentioned: [],
      /* Empty, and the renderer expects that: an image in a post the server
         has not accepted yet is drawn from the document alone. */
      media: [],
      reactions: [],
      pending: true,
    }
    setError(null)
    setPosts((ps) => [provisional, ...ps])
    /* A refusal comes back as a value; a failure the action did not expect
       comes back as a throw. Both mean the post did not happen, so both take
       the provisional entry away and keep the writer's words. Without the
       catch, a thrown action left a "Posting…" entry at the top of the feed
       for ever — seen in a browser, the first time the server rejected a
       document it could not read. */
    let result: Awaited<ReturnType<typeof postWorkflowActivity>>
    try {
      result = await postWorkflowActivity(workflowId, taskId, doc)
    } catch {
      result = { error: 'The post could not be saved. Nothing was lost — try again.' }
    }
    if (result && 'error' in result) {
      setPosts((ps) => ps.filter((p) => p.id !== provisional.id))
      setError(result.error)
      return false
    }
    return true
  }

  /**
   * Take a picture off a post.
   *
   * The post is not touched — it cannot be, and should not be: what somebody
   * wrote stands. The upload is marked redacted and its bytes are deleted, and
   * the feed then says so in the place the picture was. Optimistic like the
   * reactions, and put back with the reason if the server refuses.
   */
  async function removeImage(postId: string, mediaId: string) {
    const before = posts.find((p) => p.id === postId)?.media
    if (!before) return
    setError(null)
    setPosts((ps) =>
      ps.map((p) =>
        p.id === postId
          ? {
              ...p,
              media: p.media.map((m) =>
                m.id === mediaId
                  ? { ...m, redacted_at: new Date().toISOString(), redacted_by_name: viewer.name }
                  : m,
              ),
            }
          : p,
      ),
    )
    let result: Awaited<ReturnType<typeof redactPostMedia>>
    try {
      result = await redactPostMedia(workflowId, mediaId)
    } catch {
      result = { error: 'The image could not be removed. Try again.' }
    }
    if (result && 'error' in result) {
      setPosts((ps) => ps.map((p) => (p.id === postId ? { ...p, media: before } : p)))
      setError(result.error)
    }
  }

  async function react(postId: string, key: ReactionKey) {
    const before = posts.find((p) => p.id === postId)?.reactions
    if (!before) return
    const me = { staff_id: viewer.id, full_name: viewer.name }
    setError(null)
    setPosts((ps) => ps.map((p) => (p.id === postId ? { ...p, reactions: toggleReaction(p.reactions, key, me) } : p)))
    let result: Awaited<ReturnType<typeof togglePostReaction>>
    try {
      result = await togglePostReaction(workflowId, postId, key)
    } catch {
      result = { error: 'The reaction could not be saved. Try again.' }
    }
    if (result && 'error' in result) {
      setPosts((ps) => ps.map((p) => (p.id === postId ? { ...p, reactions: before } : p)))
      setError(result.error)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <PostComposer staff={staff} onPost={post} uploader={uploader} />

      {error ? (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      ) : null}

      {shown.length ? (
        <ol aria-label="Posts" className="flex flex-col divide-y divide-neutral-200/80">
          {shown.map((p) => {
            const pending = 'pending' in p && p.pending === true
            return (
              <li key={p.id} className="flex gap-3 py-3.5 first:pt-1">
                <span className="mt-0.5 shrink-0 [&>span]:h-7 [&>span]:w-7 [&>span]:text-[10px]">
                  <InitialsTile name={p.author_name ?? '?'} />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline gap-x-2">
                    <span className="text-sm font-semibold text-neutral-900">
                      {p.author_name ?? 'Unknown author'}
                    </span>
                    <span className="text-xs text-neutral-500">
                      {pending ? 'Posting…' : formatNoteDateTime(p.created_at)}
                    </span>
                  </div>
                  <div className={`mt-1 ${pending ? 'opacity-60' : ''}`}>
                    <PostBody doc={p.body} mentioned={p.mentioned} media={p.media} />
                  </div>
                  {/* A post that has not been accepted yet has nothing to react to. */}
                  {pending ? null : (
                    <RemovableImages
                      media={p.media}
                      canRemove={p.author_staff_id === viewer.id || viewer.canRemoveAnyImage}
                      onRemove={(mediaId) => removeImage(p.id, mediaId)}
                    />
                  )}
                  {pending ? null : (
                    <Reactions
                      reactions={p.reactions}
                      viewerId={viewer.id}
                      onToggle={(key) => react(p.id, key)}
                    />
                  )}
                </div>
              </li>
            )
          })}
        </ol>
      ) : (
        <p className="text-xs leading-relaxed text-neutral-400">
          Nothing posted yet. Updates, questions and decisions about this task go here, and will also
          appear on the workflow’s timeline.
        </p>
      )}
    </div>
  )
}

/**
 * The way a picture comes back off a post.
 *
 * Offered only to the person who wrote the post and to an administrator,
 * which is the same pair `redact_post_media()` will accept — a control that
 * could only fail is worse than no control.
 *
 * TWO STEPS ON PURPOSE. The post survives, but the bytes do not: this is the
 * one irreversible thing anywhere in the feed, and "Remove" landing under a
 * mis-aimed click would be a poor way to discover that. Nothing is shown at
 * all for a post whose pictures are all still there and unremovable, so an
 * ordinary post carries no extra furniture.
 */
function RemovableImages({
  media,
  canRemove,
  onRemove,
}: {
  media: PostMedia[]
  canRemove: boolean
  onRemove: (mediaId: string) => void
}) {
  const [confirming, setConfirming] = useState<string | null>(null)
  const removable = media.filter((m) => m.kind === 'image' && !m.redacted_at)
  if (!canRemove || removable.length === 0) return null

  return (
    <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
      {removable.map((m) =>
        confirming === m.id ? (
          <span key={m.id} className="inline-flex items-center gap-2 text-xs text-neutral-600">
            Remove {m.name} for good?
            <button
              type="button"
              onClick={() => {
                setConfirming(null)
                onRemove(m.id)
              }}
              className="rounded px-1.5 py-0.5 font-medium text-red-600 outline-none hover:bg-red-50 focus-visible:ring-2 focus-visible:ring-red-300"
            >
              Remove
            </button>
            <button
              type="button"
              onClick={() => setConfirming(null)}
              className="rounded px-1.5 py-0.5 outline-none hover:bg-neutral-100 focus-visible:ring-2 focus-visible:ring-brand/30"
            >
              Keep
            </button>
          </span>
        ) : (
          <button
            key={m.id}
            type="button"
            onClick={() => setConfirming(m.id)}
            className="rounded text-xs text-neutral-400 underline decoration-dotted underline-offset-2 outline-none hover:text-neutral-700 focus-visible:ring-2 focus-visible:ring-brand/30"
          >
            {removable.length === 1 ? 'Remove image' : `Remove ${m.name}`}
          </button>
        ),
      )}
    </div>
  )
}

/**
 * The reactions under a post: one chip per kind that anyone has given, with
 * the count, pressed when the viewer is among them, and an add button that
 * opens the six on offer. Each chip is a toggle, so `aria-pressed` — not a
 * menu: nothing here is a single choice.
 */
function Reactions({
  reactions,
  viewerId,
  onToggle,
}: {
  reactions: PostReaction[]
  viewerId: string
  onToggle: (key: ReactionKey) => void
}) {
  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-1" aria-label="Reactions">
      {reactions.map((r) => {
        const def = REACTIONS.find((d) => d.key === r.reaction)
        if (!def || r.by.length === 0) return null
        const mine = r.by.some((b) => b.staff_id === viewerId)
        return (
          <button
            key={r.reaction}
            type="button"
            aria-pressed={mine}
            aria-label={`${def.label}: ${r.by.length}`}
            title={r.by.map((b) => b.full_name).join(', ')}
            onClick={() => onToggle(r.reaction)}
            className={`inline-flex h-6 items-center gap-1 rounded-full border px-2 text-xs outline-none transition-colors focus-visible:ring-2 focus-visible:ring-brand/30 ${
              mine
                ? 'border-brand-300 bg-brand-50 text-brand-700'
                : 'border-neutral-200 bg-white text-neutral-700 hover:bg-neutral-50'
            }`}
          >
            <span aria-hidden>{def.glyph}</span>
            <span className="tabular-nums">{r.by.length}</span>
          </button>
        )
      })}
      <AddReaction onPick={onToggle} />
    </div>
  )
}

function AddReaction({ onPick }: { onPick: (key: ReactionKey) => void }) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLSpanElement>(null)

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <span ref={rootRef} className="relative inline-flex">
      <button
        type="button"
        aria-label="Add reaction"
        aria-haspopup="true"
        aria-expanded={open}
        title="Add reaction"
        onClick={() => setOpen((o) => !o)}
        className={`inline-flex h-6 items-center gap-0.5 rounded-full border border-dashed px-1.5 text-xs outline-none transition-colors focus-visible:ring-2 focus-visible:ring-brand/30 ${
          open ? 'border-neutral-400 text-neutral-700' : 'border-neutral-300 text-neutral-500 hover:border-neutral-400 hover:text-neutral-700'
        }`}
      >
        <SmilePlusGlyph />
      </button>
      {open ? (
        /* Absolute within the post, not fixed: the panel this feed lives in is
           a transformed <dialog>, which turns fixed into absolute-to-itself. */
        <div
          role="group"
          aria-label="Add a reaction"
          className="absolute left-0 top-full z-20 mt-1 flex gap-0.5 rounded-lg border border-neutral-200 bg-white p-1 shadow-[0_1px_2px_rgb(0_0_0/0.05),0_8px_24px_-12px_rgb(0_0_0/0.18)]"
        >
          {REACTIONS.map((r) => (
            <button
              key={r.key}
              type="button"
              aria-label={r.label}
              title={r.label}
              onClick={() => {
                setOpen(false)
                onPick(r.key)
              }}
              className="flex h-8 w-8 items-center justify-center rounded-md text-lg leading-none outline-none transition-colors hover:bg-neutral-100 focus-visible:bg-neutral-100"
            >
              <span aria-hidden>{r.glyph}</span>
            </button>
          ))}
        </div>
      ) : null}
    </span>
  )
}

function SmilePlusGlyph() {
  return (
    <svg aria-hidden viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
      <circle cx="7" cy="8.5" r="5.5" />
      <path d="M4.8 9.6a2.8 2.8 0 004.4 0" />
      <path d="M5.3 7h.01M8.7 7h.01" strokeWidth="1.8" />
      <path d="M12.5 1.5v4M10.5 3.5h4" />
    </svg>
  )
}
