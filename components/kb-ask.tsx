'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { recordHandoff } from '@/app/(shell)/help/actions'
import {
  ASK_NOTE,
  MIN_QUESTION,
  excerptOf,
  handoffPrompt,
  handoffUrl,
  matchedBy,
  passageHref,
  passageLabel,
  type KbPassage,
} from '@/lib/kb'
import { createSupabaseBrowserClient } from '@/lib/supabase/client'

/**
 * Ask the firm's policies a question.
 *
 * The CRM answers by SHOWING: it searches the policies — keyword fused with
 * meaning — and puts the matching passages on screen, each linking into the
 * reader at the heading it matched. That is the whole answer to most questions
 * ("what's the breach reporting timeframe"), it is instant, and it costs
 * nothing.
 *
 * When somebody wants more than an extract, **the question goes to Claude**
 * rather than being answered here. Clinton's call, 22 Sep 2026, and the reason
 * is capability rather than cost: Claude holds the CRM connector, so a question
 * asked there reaches these same passages alongside the client tools. "Does
 * this file meet the seven best-interests steps" needs both, and this panel is
 * deliberately blind to everything but policy.
 *
 * The hand-off is a REAL LINK, not a scripted window.open, and the recording
 * runs beside it rather than before it — a navigation that waits on an await
 * is a navigation a popup blocker eats. It points at the DESKTOP APP; the
 * browser link beside it exists because a `claude://` URL with no handler does
 * nothing at all, silently, and somebody without the app installed needs a way
 * through rather than a dead button. See `HANDOFF_DESKTOP`.
 *
 * Searching happens on submit, never per keystroke: the vector arm needs an
 * embedding, which is a round trip to an edge function, and a typed sentence
 * would otherwise cost eight of them instead of one.
 */
export function KbAsk({
  searchUrl,
  initialQuestion = '',
  /** The session's access token. Defaults to the browser client; tests pass one. */
  getToken,
}: {
  /** `${SUPABASE_URL}/functions/v1/kb-search`, resolved on the server. */
  searchUrl: string
  initialQuestion?: string
  getToken?: () => Promise<string | null>
}) {
  const [question, setQuestion] = useState(initialQuestion)
  /** The question the passages on screen belong to — not what is being typed. */
  const [searched, setSearched] = useState('')
  const [passages, setPassages] = useState<KbPassage[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const ran = useRef(false)

  const search = useCallback(
    async (q: string) => {
      if (q.trim().length < MIN_QUESTION || busy) return
      setError(null)
      setBusy(true)
      setCopied(false)
      try {
        const token = getToken
          ? await getToken()
          : (await createSupabaseBrowserClient().auth.getSession()).data.session?.access_token ?? null
        if (!token) throw new Error('Your session has expired. Sign in again.')
        const res = await fetch(searchUrl, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ question: q.trim() }),
        })
        const body = (await res.json().catch(() => ({}))) as { passages?: KbPassage[]; error?: string }
        if (!res.ok) throw new Error(body.error ?? 'The policies could not be searched.')
        setPassages(body.passages ?? [])
        setSearched(q.trim())
      } catch (e) {
        setPassages([])
        setSearched('')
        setError(e instanceof Error ? e.message : 'Something went wrong.')
      } finally {
        setBusy(false)
      }
    },
    [busy, getToken, searchUrl],
  )

  /* Arriving from the list of earlier questions (/help?q=…) re-asks it, rather
     than replaying a stored snapshot — the policy may have changed since. */
  useEffect(() => {
    if (ran.current || !initialQuestion.trim()) return
    ran.current = true
    void search(initialQuestion)
  }, [initialQuestion, search])

  /* Shared by both links: which one was followed changes where the question
     lands, not what is recorded about it. */
  function record() {
    void recordHandoff(searched, passages).then((r) => {
      if (r.error) setError(`Opened in Claude, but the question was not recorded: ${r.error}`)
    })
  }

  async function copyPrompt() {
    try {
      await navigator.clipboard.writeText(handoffPrompt(searched))
      setCopied(true)
    } catch {
      setError('Copying is not available here — select the question and copy it.')
    }
  }

  return (
    <div data-slot="kb-ask" className="flex flex-col gap-4">
      <form
        onSubmit={(e) => {
          e.preventDefault()
          void search(question)
        }}
        className="flex flex-col gap-2"
      >
        <label htmlFor="kb-question" className="text-xs font-medium text-neutral-600">
          Your question
        </label>
        <textarea
          id="kb-question"
          data-slot="kb-question"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              void search(question)
            }
          }}
          rows={2}
          maxLength={2000}
          placeholder="What do I do if a client complains?"
          className="w-full resize-y rounded-md border border-neutral-200 bg-white px-3 py-2 text-sm text-neutral-900 outline-none placeholder:text-neutral-400 focus-visible:border-brand-300 focus-visible:ring-2 focus-visible:ring-brand/15"
        />
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs leading-relaxed text-neutral-400">{ASK_NOTE}</p>
          <button
            type="submit"
            disabled={busy || question.trim().length < MIN_QUESTION}
            className="shrink-0 rounded-md bg-brand px-3 py-1.5 text-xs font-medium text-white outline-none transition-colors hover:bg-brand-600 disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-brand/40"
          >
            {busy ? 'Searching…' : 'Search policies'}
          </button>
        </div>
      </form>

      {error ? (
        <p role="alert" data-slot="kb-error" className="text-sm text-red-600">
          {error}
        </p>
      ) : null}

      {searched ? (
        <div className="flex flex-col gap-3">
          {passages.length === 0 ? (
            <p data-slot="kb-no-results" className="text-sm text-neutral-500">
              Nothing in the policies matches that. Claude can look wider — including at the client record — or ask
              the compliance manager.
            </p>
          ) : (
            <ol data-slot="kb-results" className="flex flex-col gap-2.5">
              {passages.map((p) => (
                <li key={p.chunk_id} data-slot="kb-passage" className="text-sm">
                  <a
                    href={passageHref(p)}
                    className="font-medium text-neutral-900 underline decoration-neutral-300 underline-offset-2 hover:decoration-neutral-600"
                  >
                    {passageLabel(p)}
                  </a>
                  <span className="text-xs text-neutral-400">
                    {' '}
                    · v{p.version} · matched on {matchedBy(p)}
                  </span>
                  <p className="mt-0.5 leading-relaxed text-neutral-600">{excerptOf(p)}</p>
                </li>
              ))}
            </ol>
          )}

          {/* A real anchor: the browser navigates natively and the recording
              runs alongside, so a blocked popup cannot swallow the hand-off. */}
          <div className="flex flex-wrap items-center gap-2 border-t border-neutral-200 pt-3">
            {/* No target on the desktop link: a custom scheme is handed to
                the OS rather than navigated to, and a _blank would leave an
                empty tab behind. The browser link is an ordinary new tab. */}
            <a
              data-slot="kb-handoff"
              href={handoffUrl(searched)}
              onClick={record}
              className="rounded-md bg-brand px-3 py-1.5 text-xs font-medium text-white no-underline outline-none transition-colors hover:bg-brand-600 focus-visible:ring-2 focus-visible:ring-brand/40"
            >
              Ask Claude
            </a>
            <a
              data-slot="kb-handoff-web"
              href={handoffUrl(searched, 'web')}
              target="_blank"
              rel="noopener noreferrer"
              onClick={record}
              className="rounded-md px-2 py-1 text-xs font-medium text-neutral-600 no-underline outline-none transition-colors hover:bg-neutral-100 hover:text-neutral-900 focus-visible:ring-2 focus-visible:ring-brand/30"
            >
              Open in the browser
            </a>
            <button
              type="button"
              onClick={() => void copyPrompt()}
              className="rounded-md px-2 py-1 text-xs font-medium text-neutral-600 outline-none transition-colors hover:bg-neutral-100 hover:text-neutral-900 focus-visible:ring-2 focus-visible:ring-brand/30"
            >
              {copied ? 'Copied' : 'Copy the prompt'}
            </button>
            <span className="text-[11px] text-neutral-400">
              Opens the Claude app. It sees these passages and your client records; its answer stays in your Claude
              account.
            </span>
          </div>
        </div>
      ) : null}
    </div>
  )
}
