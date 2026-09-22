'use client'

import { useEffect, useRef, useState } from 'react'
import { createSupabaseBrowserClient } from '@/lib/supabase/client'
import {
  ASK_NOTE,
  citationHref,
  citationLabel,
  parseNdjson,
  splitCitations,
  summaryLine,
  type KbCitation,
  type KbMessage,
} from '@/lib/kb'

/**
 * Ask the policies a question, and keep talking.
 *
 * The browser calls the `kb-ask` edge function DIRECTLY with the session
 * token — the shape the app already uses to reach identity-verify, minus the
 * server hop, because the answer streams and a Server Action cannot stream.
 * The function authenticates the token, requires a second factor, and then
 * does every read and write as this person under RLS.
 *
 * What is drawn is TEXT. The answer arrives as prose with `[n]` markers; the
 * markers become links into the reader and everything else lands in text
 * nodes. The audit trail's `<img onerror>` test pins the same rule for a
 * payload, and `__tests__/kb-ask.test.tsx` pins it here.
 *
 * A conversation survives a refresh: the first answer's `meta` event names the
 * conversation, the URL becomes `/help?c=<id>`, and the server page hands the
 * recorded messages back as `initialMessages`.
 */
export function KbAsk({
  functionsUrl,
  conversationId: initialConversationId,
  initialMessages,
  getToken,
}: {
  /** `${SUPABASE_URL}/functions/v1/kb-ask`, resolved on the server. */
  functionsUrl: string
  conversationId: string | null
  initialMessages: KbMessage[]
  /** The session's access token. Defaults to the browser client; tests pass one. */
  getToken?: () => Promise<string | null>
}) {
  const [conversationId, setConversationId] = useState<string | null>(initialConversationId)
  const [messages, setMessages] = useState<KbMessage[]>(initialMessages)
  const [question, setQuestion] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const endRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    // jsdom has no layout and no scrollIntoView; the guard keeps the test
    // environment honest rather than stubbing a scroll that cannot happen.
    const el = endRef.current
    if (messages.length > 0 && el && typeof el.scrollIntoView === 'function') el.scrollIntoView({ block: 'nearest' })
  }, [messages])

  const token = async () => {
    if (getToken) return getToken()
    const {
      data: { session },
    } = await createSupabaseBrowserClient().auth.getSession()
    return session?.access_token ?? null
  }

  async function ask() {
    const q = question.trim()
    if (q.length < 3 || busy) return
    setError(null)
    setBusy(true)
    setQuestion('')

    const userId = `u-${Date.now()}`
    const answerId = `a-${Date.now()}`
    setMessages((prev) => [
      ...prev,
      { id: userId, role: 'user', content: q, refused: false, model: null, citations: [] },
      { id: answerId, role: 'assistant', content: '', refused: false, model: null, citations: [], pending: true },
    ])

    const patchAnswer = (fn: (m: KbMessage) => KbMessage) =>
      setMessages((prev) => prev.map((m) => (m.id === answerId ? fn(m) : m)))

    try {
      const t = await token()
      if (!t) throw new Error('Your session has expired. Sign in again.')
      const res = await fetch(functionsUrl, {
        method: 'POST',
        headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ conversation_id: conversationId, question: q }),
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(body.error ?? 'The assistant could not be reached.')
      }
      if (!res.body) throw new Error('The assistant sent nothing back.')

      let offered: KbCitation[] = []
      const reader = res.body.getReader()
      const dec = new TextDecoder()
      let carry = ''
      for (;;) {
        const { value, done } = await reader.read()
        if (done) break
        const { events, rest } = parseNdjson(carry + dec.decode(value, { stream: true }))
        carry = rest
        for (const ev of events) {
          if (ev.type === 'meta') {
            offered = ev.citations
            if (!conversationId) {
              setConversationId(ev.conversation_id)
              window.history.replaceState(null, '', `/help?c=${encodeURIComponent(ev.conversation_id)}`)
            }
          } else if (ev.type === 'delta') {
            patchAnswer((m) => ({ ...m, content: m.content + ev.text }))
          } else if (ev.type === 'done') {
            const cited = offered.filter((c) => ev.cited.includes(c.n))
            patchAnswer((m) => ({
              ...m,
              id: ev.message_id ?? m.id,
              refused: ev.refused,
              model: ev.model ?? null,
              citations: cited,
              pending: false,
            }))
          } else if (ev.type === 'error') {
            throw new Error(ev.message)
          }
        }
      }
      patchAnswer((m) => ({ ...m, pending: false }))
    } catch (e) {
      setMessages((prev) => prev.filter((m) => m.id !== answerId))
      setError(e instanceof Error ? e.message : 'Something went wrong.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div data-slot="kb-ask" className="flex flex-col gap-4">
      <p className="text-xs leading-relaxed text-neutral-500">{ASK_NOTE}</p>

      {messages.length > 0 ? (
        <ol className="flex flex-col gap-4" aria-label="Conversation">
          {messages.map((m) => (
            <li key={m.id} data-slot="kb-message" data-role={m.role}>
              {m.role === 'user' ? (
                <p className="ml-auto max-w-[85%] whitespace-pre-wrap rounded-lg bg-neutral-100 px-3 py-2 text-sm text-neutral-800">
                  {m.content}
                </p>
              ) : (
                <Answer message={m} />
              )}
            </li>
          ))}
        </ol>
      ) : null}
      <div ref={endRef} />

      {error ? (
        <p role="alert" data-slot="kb-error" className="text-sm text-red-600">
          {error}
        </p>
      ) : null}

      <form
        onSubmit={(e) => {
          e.preventDefault()
          void ask()
        }}
        className="flex flex-col gap-2"
      >
        <label htmlFor="kb-question" className="text-xs font-medium text-neutral-600">
          {messages.length ? 'Ask a follow-up' : 'Your question'}
        </label>
        <textarea
          id="kb-question"
          data-slot="kb-question"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              void ask()
            }
          }}
          rows={2}
          maxLength={2000}
          placeholder={messages.length ? 'And what about…' : 'What do I do if a client complains?'}
          className="w-full resize-y rounded-md border border-neutral-200 bg-white px-3 py-2 text-sm text-neutral-900 outline-none placeholder:text-neutral-400 focus-visible:border-brand-300 focus-visible:ring-2 focus-visible:ring-brand/15"
        />
        <div className="flex items-center justify-between gap-3">
          <span className="text-[11px] text-neutral-400">Enter to ask · Shift+Enter for a new line</span>
          <button
            type="submit"
            disabled={busy || question.trim().length < 3}
            className="rounded-md bg-brand px-3 py-1.5 text-xs font-medium text-white outline-none transition-colors hover:bg-brand-600 disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-brand/40"
          >
            {busy ? 'Answering…' : 'Ask'}
          </button>
        </div>
      </form>
    </div>
  )
}

/** The assistant's turn: prose with its markers as links, then what it cited. */
function Answer({ message }: { message: KbMessage }) {
  /* The highest passage number cited, not the count: an answer citing [1]
     and [3] has two citations and a marker numbered three. While streaming
     nothing is known yet, so every plausible marker is treated as one. */
  const known = message.citations.length ? Math.max(...message.citations.map((c) => c.n)) : 99
  const parts = splitCitations(message.content, known)
  const byN = new Map(message.citations.map((c) => [c.n, c]))
  return (
    <div className="flex flex-col gap-2">
      <p
        data-slot="kb-answer"
        className={`whitespace-pre-wrap text-sm leading-relaxed ${message.refused ? 'text-neutral-600' : 'text-neutral-800'}`}
      >
        {parts.map((p, i) => {
          if (p.kind === 'text') return <span key={i}>{p.text}</span>
          const c = byN.get(p.n)
          return c ? (
            <a
              key={i}
              href={citationHref(c)}
              title={citationLabel(c)}
              data-slot="kb-marker"
              className="mx-0.5 rounded bg-brand-50 px-1 text-[11px] font-medium text-brand no-underline hover:bg-brand-100"
            >
              {p.n}
            </a>
          ) : (
            <span key={i} className="mx-0.5 text-[11px] text-neutral-400">
              [{p.n}]
            </span>
          )
        })}
        {message.pending ? <span aria-hidden className="ml-0.5 inline-block h-3.5 w-1.5 animate-pulse bg-neutral-300 align-middle" /> : null}
      </p>
      {message.citations.length > 0 ? (
        <div className="rounded-md border border-neutral-200 bg-neutral-50/60 p-3">
          <p data-slot="kb-summary" className="mb-2 text-[11px] font-medium uppercase tracking-wider text-neutral-500">
            {summaryLine(message.citations)}
          </p>
          <ol className="flex flex-col gap-2">
            {message.citations.map((c) => (
              <li key={c.n} data-slot="kb-citation" className="flex gap-2 text-xs">
                <span className="shrink-0 rounded bg-brand-50 px-1 font-medium text-brand">{c.n}</span>
                <span className="min-w-0">
                  <a href={citationHref(c)} className="font-medium text-neutral-800 underline decoration-neutral-300 underline-offset-2 hover:decoration-neutral-600">
                    {citationLabel(c)}
                  </a>
                  <span className="text-neutral-400"> · v{c.version}</span>
                  <span className="mt-0.5 block text-neutral-500">{c.excerpt}</span>
                </span>
              </li>
            ))}
          </ol>
        </div>
      ) : null}
    </div>
  )
}
