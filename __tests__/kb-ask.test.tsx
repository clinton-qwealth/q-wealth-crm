import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { KbAsk } from '@/components/kb-ask'
import { handoffPrompt, type KbPassage } from '@/lib/kb'

/**
 * The Ask panel: the CRM shows passages, Claude gets the question.
 */
const recordHandoff = vi.hoisted(() => vi.fn(async () => ({}) as { error?: string }))
vi.mock('@/app/(shell)/help/actions', () => ({ recordHandoff }))

const passages: KbPassage[] = [
  {
    chunk_id: 'c1', document_id: 'd1', page_id: '10092549', title: 'Complaints Policy', section: 'Policies',
    heading_path: ['Timeframes'], anchor: 'timeframes', version: 7, score: 0.06, lexical_rank: 1, semantic_rank: 2,
    content: 'Complaints Policy › Timeframes\n\nA complaint must be acknowledged within one business day.',
  },
  {
    chunk_id: 'c2', document_id: 'd2', page_id: '12746777', title: 'Privacy Policy', section: 'Policies',
    heading_path: [], anchor: null, version: 3, score: 0.04, lexical_rank: null, semantic_rank: 1,
    content: 'Privacy Policy\n\nWe collect only what is reasonably needed.',
  },
]

function answerWith(body: unknown, init: { ok?: boolean; status?: number } = {}) {
  return vi.spyOn(globalThis, 'fetch').mockResolvedValue({
    ok: init.ok ?? true,
    status: init.status ?? 200,
    json: async () => body,
  } as unknown as Response)
}

afterEach(() => {
  vi.restoreAllMocks()
  recordHandoff.mockClear()
})

const setup = (initialQuestion = '') =>
  render(<KbAsk searchUrl="https://x.supabase.co/functions/v1/kb-search" initialQuestion={initialQuestion} getToken={async () => 'tok'} />)

describe('searching', () => {
  test('sends the question with the session token and lists the passages it matched', async () => {
    const spy = answerWith({ passages, semantic: true })
    const user = userEvent.setup()
    setup()

    await user.type(screen.getByLabelText('Your question'), 'what do I do if a client complains')
    await user.click(screen.getByRole('button', { name: 'Search policies' }))

    await waitFor(() => expect(document.querySelectorAll('[data-slot="kb-passage"]')).toHaveLength(2))

    const [url, init] = spy.mock.calls[0]
    expect(url).toBe('https://x.supabase.co/functions/v1/kb-search')
    expect((init as RequestInit).headers).toMatchObject({ Authorization: 'Bearer tok' })
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({ question: 'what do I do if a client complains' })

    const rows = [...document.querySelectorAll('[data-slot="kb-passage"]')]
    expect(rows[0].querySelector('a')?.getAttribute('href')).toBe('/help/10092549#timeframes')
    expect(rows[0].textContent).toContain('Complaints Policy › Timeframes')
    expect(rows[0].textContent).toContain('v7')
    expect(rows[0].textContent).toContain('A complaint must be acknowledged within one business day.')
    /* The breadcrumb is stripped from the shown text — it is there for the
       index and the embedding, not for a reader who can see the heading. */
    expect(rows[0].querySelector('p')?.textContent).not.toContain('›')
    /* Found by meaning alone reads as such, so an unexpected hit is explicable. */
    expect(rows[1].textContent).toContain('matched on meaning')
  })

  /* One embed per question, not per keystroke. Mutation: search on change → this fails. */
  test('typing alone searches nothing; submitting does', async () => {
    const spy = answerWith({ passages })
    const user = userEvent.setup()
    setup()
    await user.type(screen.getByLabelText('Your question'), 'complaints')
    expect(spy).not.toHaveBeenCalled()
    await user.keyboard('{Enter}')
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(1))
  })

  test('a question arriving in the url is asked again on arrival', async () => {
    const spy = answerWith({ passages })
    setup('what is the breach reporting timeframe')
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(1))
    expect(JSON.parse((spy.mock.calls[0][1] as RequestInit).body as string)).toEqual({
      question: 'what is the breach reporting timeframe',
    })
  })

  test('nothing found says so and still offers Claude', async () => {
    answerWith({ passages: [] })
    const user = userEvent.setup()
    setup()
    await user.type(screen.getByLabelText('Your question'), 'what is the office wifi password{Enter}')
    await waitFor(() => expect(document.querySelector('[data-slot="kb-no-results"]')).not.toBeNull())
    expect(document.querySelector('[data-slot="kb-handoff"]')).not.toBeNull()
  })

  test('a refusal from the function is shown and nothing is claimed to have matched', async () => {
    answerWith({ error: 'A verified second factor is required.' }, { ok: false, status: 403 })
    const user = userEvent.setup()
    setup()
    await user.type(screen.getByLabelText('Your question'), 'anything at all{Enter}')
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('second factor'))
    expect(document.querySelector('[data-slot="kb-handoff"]')).toBeNull()
  })

  test('a question shorter than three characters does not search', async () => {
    const spy = vi.spyOn(globalThis, 'fetch')
    const user = userEvent.setup()
    setup()
    await user.type(screen.getByLabelText('Your question'), 'hi{Enter}')
    expect(spy).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Search policies' }).hasAttribute('disabled')).toBe(true)
  })
})

describe('handing over', () => {
  const ask = async (question = 'what do I do if a client complains') => {
    answerWith({ passages })
    const user = userEvent.setup()
    setup()
    await user.type(screen.getByLabelText('Your question'), `${question}{Enter}`)
    await waitFor(() => expect(document.querySelector('[data-slot="kb-handoff"]')).not.toBeNull())
    return user
  }

  /**
   * **A real link, opened by the browser.** A scripted window.open after an
   * awaited recording is what a popup blocker eats; the anchor navigates
   * natively and the recording runs beside it.
   */
  test('the button is an anchor into the desktop app, carrying the whole prompt', async () => {
    await ask()
    const a = document.querySelector('[data-slot="kb-handoff"]') as HTMLAnchorElement
    expect(a.tagName).toBe('A')
    const url = new URL(a.getAttribute('href')!)
    expect(url.protocol).toBe('claude:')
    expect(`${url.host}${url.pathname}`).toBe('claude.ai/new')
    expect(url.searchParams.get('q')).toBe(handoffPrompt('what do I do if a client complains'))
    /* No target: the OS takes a custom scheme, and _blank would leave an empty
       tab behind. Mutation: add target="_blank" → this fails. */
    expect(a.getAttribute('target')).toBeNull()
  })

  /**
   * A `claude://` link with no handler does nothing, silently. Somebody
   * without the desktop app gets the same question in a browser, where the
   * account-level connector gives Claude the same tools.
   */
  test('a browser link sits beside it, in a new tab, with the same prompt', async () => {
    await ask()
    const web = document.querySelector('[data-slot="kb-handoff-web"]') as HTMLAnchorElement
    const url = new URL(web.href)
    expect(`${url.origin}${url.pathname}`).toBe('https://claude.ai/new')
    expect(url.searchParams.get('q')).toBe(handoffPrompt('what do I do if a client complains'))
    expect(web.getAttribute('target')).toBe('_blank')
    expect(web.getAttribute('rel')).toBe('noopener noreferrer')
  })

  test('either route records the same hand-off', async () => {
    const user = await ask()
    await user.click(screen.getByRole('link', { name: 'Open in the browser' }))
    await waitFor(() => expect(recordHandoff).toHaveBeenCalledTimes(1))
    const [question] = recordHandoff.mock.calls[0] as unknown as [string, KbPassage[]]
    expect(question).toBe('what do I do if a client complains')
  })

  test('following it records the question and the passages that were on screen', async () => {
    const user = await ask()
    await user.click(screen.getByRole('link', { name: 'Ask Claude' }))
    await waitFor(() => expect(recordHandoff).toHaveBeenCalledTimes(1))
    const [question, recorded] = recordHandoff.mock.calls[0] as unknown as [string, KbPassage[]]
    expect(question).toBe('what do I do if a client complains')
    expect(recorded.map((p) => p.chunk_id)).toEqual(['c1', 'c2'])
  })

  /**
   * **What is recorded is what was ON SCREEN**, not what is in the box.
   *
   * Search, then start typing the next question, then follow the link: the
   * passages belong to the first question, so recording the second would file
   * a question against extracts that never answered it. Mutation: record
   * `question` rather than `searched` → this fails.
   */
  test('editing the box after searching does not change what is recorded', async () => {
    const user = await ask('what do I do if a client complains')
    await user.type(screen.getByLabelText('Your question'), ' and then what')
    expect((screen.getByLabelText('Your question') as HTMLTextAreaElement).value).toBe(
      'what do I do if a client complains and then what',
    )
    await user.click(screen.getByRole('link', { name: 'Ask Claude' }))
    await waitFor(() => expect(recordHandoff).toHaveBeenCalledTimes(1))
    const [recordedQuestion] = recordHandoff.mock.calls[0] as unknown as [string, KbPassage[]]
    expect(recordedQuestion).toBe('what do I do if a client complains')
    /* And the link itself still carries the searched question. */
    const a = document.querySelector('[data-slot="kb-handoff"]') as HTMLAnchorElement
    expect(new URL(a.href).searchParams.get('q')).toBe(handoffPrompt('what do I do if a client complains'))
  })

  /* The answer matters more than the record: a failed write says so and does
     not stand between the person and Claude. */
  test('a failed recording is reported without blocking the hand-off', async () => {
    recordHandoff.mockResolvedValueOnce({ error: 'Only an active staff member can ask the assistant' })
    const user = await ask()
    await user.click(screen.getByRole('link', { name: 'Ask Claude' }))
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('not recorded'))
    expect(document.querySelector('[data-slot="kb-handoff"]')).not.toBeNull()
  })

  test('the prompt can be copied, for the day the prefill parameter changes', async () => {
    const user = await ask('when can I give time critical advice')
    /* Stubbed AFTER userEvent.setup(), which installs a clipboard of its own
       and would otherwise replace this one. jsdom defines navigator.clipboard
       as getter-only, so it is redefined rather than assigned. */
    const writeText = vi.fn(async () => {})
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    await user.click(screen.getByRole('button', { name: 'Copy the prompt' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Copied' })).toBeTruthy())
    expect(writeText).toHaveBeenCalledWith(handoffPrompt('when can I give time critical advice'))
  })

  test('the screen says where the answer will live', async () => {
    await ask()
    expect(document.body.textContent).toContain('stays in your Claude account')
  })
})
