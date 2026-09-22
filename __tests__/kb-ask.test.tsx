import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { KbAsk } from '@/components/kb-ask'
import { REFUSAL, type KbCitation } from '@/lib/kb'

/**
 * The Ask panel against a streamed `kb-ask` response.
 */
const citations: KbCitation[] = [
  { n: 1, document_id: 'd1', page_id: '10092549', title: 'Complaints Policy', heading_path: ['Timeframes'], anchor: 'timeframes', version: 7, excerpt: 'Acknowledge within one business day.' },
  { n: 2, document_id: 'd2', page_id: '12746777', title: 'Privacy Policy', heading_path: [], anchor: null, version: 3, excerpt: 'We collect only what is needed.' },
  { n: 3, document_id: 'd1', page_id: '10092549', title: 'Complaints Policy', heading_path: ['IDR'], anchor: 'idr', version: 7, excerpt: 'Resolve within 30 days.' },
]

function ndjson(events: unknown[]): ReadableStream<Uint8Array> {
  const enc = new TextEncoder()
  const lines = events.map((e) => JSON.stringify(e) + '\n')
  return new ReadableStream({
    start(controller) {
      /* Two events share one push, and one event is torn across two, so the
         carry logic is exercised and not merely present. */
      const joined = lines.join('')
      const cut = Math.floor(joined.length * 0.6)
      controller.enqueue(enc.encode(joined.slice(0, cut)))
      controller.enqueue(enc.encode(joined.slice(cut)))
      controller.close()
    },
  })
}

function answerWith(events: unknown[], init: { ok?: boolean; status?: number; json?: unknown } = {}) {
  const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
    ok: init.ok ?? true,
    status: init.status ?? 200,
    body: init.ok === false ? null : ndjson(events),
    json: async () => init.json ?? {},
  } as unknown as Response)
  return spy
}

afterEach(() => {
  vi.restoreAllMocks()
})

const setup = () =>
  render(<KbAsk functionsUrl="https://x.supabase.co/functions/v1/kb-ask" conversationId={null} initialMessages={[]} getToken={async () => 'tok'} />)

describe('asking', () => {
  test('sends the question with the session token, streams the answer, and links only what was cited', async () => {
    const spy = answerWith([
      { type: 'meta', conversation_id: 'conv-1', citations },
      { type: 'delta', text: 'Acknowledge the complaint within one business day [1]. ' },
      { type: 'delta', text: 'Resolve it within 30 days [3].' },
      { type: 'done', message_id: 'm-9', refused: false, cited: [1, 3], model: 'claude-sonnet-5' },
    ])
    const user = userEvent.setup()
    setup()
    expect(screen.getByText(/don’t include client names or details/)).toBeTruthy()

    await user.type(screen.getByLabelText('Your question'), 'what do I do if a client complains')
    await user.click(screen.getByRole('button', { name: 'Ask' }))

    await waitFor(() => expect(document.querySelectorAll('[data-slot="kb-citation"]')).toHaveLength(2))

    const [url, init] = spy.mock.calls[0]
    expect(url).toBe('https://x.supabase.co/functions/v1/kb-ask')
    expect((init as RequestInit).headers).toMatchObject({ Authorization: 'Bearer tok' })
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({ conversation_id: null, question: 'what do I do if a client complains' })

    const answer = document.querySelector('[data-slot="kb-answer"]')!
    expect(answer.textContent).toContain('Acknowledge the complaint within one business day')
    expect(answer.textContent).toContain('Resolve it within 30 days')
    /* [1] and [3] are links into the reader; [2] was offered but not cited, so it is not listed. */
    const markers = [...answer.querySelectorAll('[data-slot="kb-marker"]')]
    expect(markers.map((m) => m.getAttribute('href'))).toEqual(['/help/10092549#timeframes', '/help/10092549#idr'])
    const cited = [...document.querySelectorAll('[data-slot="kb-citation"]')].map((c) => c.textContent)
    expect(cited[0]).toContain('Complaints Policy › Timeframes')
    expect(cited.join(' ')).not.toContain('Privacy Policy')
    expect(document.querySelector('[data-slot="kb-summary"]')!.textContent).toBe('Written from 2 passages · Complaints Policy v7')
    /* The URL now names the conversation, so a refresh keeps it. */
    expect(window.location.search).toBe('?c=conv-1')
    expect(screen.getByLabelText('Ask a follow-up')).toBeTruthy()
  })

  test('a follow-up carries the conversation id', async () => {
    const spy = answerWith([
      { type: 'meta', conversation_id: 'conv-2', citations },
      { type: 'delta', text: 'Yes [2].' },
      { type: 'done', message_id: 'm-1', refused: false, cited: [2] },
    ])
    const user = userEvent.setup()
    render(<KbAsk functionsUrl="https://x/kb-ask" conversationId="conv-2" initialMessages={[{ id: 'u0', role: 'user', content: 'earlier', refused: false, model: null, citations: [] }]} getToken={async () => 'tok'} />)
    await user.type(screen.getByLabelText('Ask a follow-up'), 'and privacy?{Enter}')
    await waitFor(() => expect(document.querySelectorAll('[data-slot="kb-citation"]')).toHaveLength(1))
    expect(JSON.parse((spy.mock.calls[0][1] as RequestInit).body as string)).toEqual({ conversation_id: 'conv-2', question: 'and privacy?' })
  })

  test('the refusal is shown as the answer, with no citations and no summary', async () => {
    answerWith([
      { type: 'meta', conversation_id: 'conv-3', citations: [] },
      { type: 'delta', text: REFUSAL },
      { type: 'done', message_id: 'm-2', refused: true, cited: [] },
    ])
    const user = userEvent.setup()
    setup()
    await user.type(screen.getByLabelText('Your question'), 'what is the office wifi password{Enter}')
    await waitFor(() => expect(document.querySelector('[data-slot="kb-answer"]')?.textContent).toBe(REFUSAL))
    expect(document.querySelector('[data-slot="kb-citation"]')).toBeNull()
    expect(document.querySelector('[data-slot="kb-summary"]')).toBeNull()
  })

  /* The rule the audit trail pins for a payload, pinned for an answer. */
  test('markup in an answer is text, and a marker with no passage is left as typed', async () => {
    answerWith([
      { type: 'meta', conversation_id: 'conv-4', citations },
      { type: 'delta', text: 'Try <img src=x onerror=alert(1)> and see [9] [1].' },
      { type: 'done', message_id: 'm-3', refused: false, cited: [1] },
    ])
    const user = userEvent.setup()
    setup()
    await user.type(screen.getByLabelText('Your question'), 'anything at all{Enter}')
    await waitFor(() => expect(document.querySelectorAll('[data-slot="kb-citation"]')).toHaveLength(1))
    const answer = document.querySelector('[data-slot="kb-answer"]')!
    expect(answer.querySelector('img')).toBeNull()
    expect(answer.textContent).toContain('<img src=x onerror=alert(1)>')
    expect(answer.textContent).toContain('[9]')
    expect(answer.querySelectorAll('[data-slot="kb-marker"]')).toHaveLength(1)
  })

  test('a refused request shows the database’s sentence and keeps the question for another go', async () => {
    answerWith([], { ok: false, status: 429, json: { error: 'You have asked thirty questions in the last hour. Try again a little later.' } })
    const user = userEvent.setup()
    setup()
    await user.type(screen.getByLabelText('Your question'), 'one more question{Enter}')
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('thirty questions'))
    /* The pending answer was removed; the question row stays so the person sees what they asked. */
    expect(document.querySelectorAll('[data-slot="kb-message"][data-role="assistant"]')).toHaveLength(0)
    expect(document.querySelectorAll('[data-slot="kb-message"][data-role="user"]')).toHaveLength(1)
  })

  test('a short question does not send', async () => {
    const spy = vi.spyOn(globalThis, 'fetch')
    const user = userEvent.setup()
    setup()
    await user.type(screen.getByLabelText('Your question'), 'hi{Enter}')
    expect(spy).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Ask' }).hasAttribute('disabled')).toBe(true)
  })
})
