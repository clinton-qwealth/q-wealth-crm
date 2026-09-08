'use client'

import { useState } from 'react'
import { postWorkflowActivity } from '@/app/(shell)/groups/actions'
import { postDocText, type PostDoc, type WorkflowPost } from '@/lib/workflow-board'
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
