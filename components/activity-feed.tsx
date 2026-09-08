'use client'

import { useEffect, useRef, useState } from 'react'
import { postWorkflowActivity, togglePostReaction } from '@/app/(shell)/groups/actions'
import {
  REACTIONS,
  postDocText,
  toggleReaction,
  type PostDoc,
  type PostReaction,
  type ReactionKey,
  type WorkflowPost,
} from '@/lib/workflow-board'
import { formatNoteDateTime } from '@/lib/note-date'
import { useServerState } from './use-server-state'
import { PostComposer } from './post-composer'
import { PostBody } from './post-body'
import { InitialsTile } from './ui'

type Staff = { id: string; name: string }
type Viewer = { id: string; name: string }

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
      <PostComposer staff={staff} onPost={post} />

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
                    <PostBody doc={p.body} mentioned={p.mentioned} />
                  </div>
                  {/* A post that has not been accepted yet has nothing to react to. */}
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
