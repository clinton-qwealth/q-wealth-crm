import Link from 'next/link'
import { KbAsk } from '@/components/kb-ask'
import { RegisterHeader, ROOT_CRUMB } from '@/components/register-header'
import { Card } from '@/components/ui'
import { SUPABASE_URL } from '@/lib/env'
import type { KbQuestion } from '@/lib/kb'
import { createSupabaseServerClient } from '@/lib/supabase/server'

export const metadata = { title: 'Help · Q Wealth CRM' }

/*
 * /help, rebuilt on 22 Sep 2026 around the firm's own policies.
 *
 * Until then this was a stub that said so — "Written procedures live in
 * Confluence". Now they live HERE too: synced into kb_documents, listed by
 * section, opened in the CRM's own reader, and searched by the box at the top.
 *
 * **The CRM shows; Claude answers.** The box retrieves passages and puts them
 * on screen; a question that wants more than an extract goes to Claude, where
 * the connector reaches these same passages alongside the client record. What
 * is kept here is the question and what was shown — see `kb_record_handoff`.
 *
 * Everything is read as the caller. kb_documents is readable by every active
 * staff member — the firm's rules are not territory-scoped — and a person's
 * questions are readable by them and by an administrator.
 */
export default async function HelpPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { q } = await searchParams
  const supabase = await createSupabaseServerClient({ writable: false })

  /* One wave: the list and the person's earlier questions need nothing from
     one another. The passages themselves are fetched by the box, on submit. */
  const [docsRes, askedRes] = await Promise.all([
    supabase
      .from('kb_documents')
      .select('confluence_page_id, title, section, version, synced_at')
      .is('retired_at', null)
      .eq('excluded', false)
      .order('section')
      .order('title'),
    supabase.from('kb_conversations').select('id, title, updated_at').order('updated_at', { ascending: false }).limit(15),
  ])

  const docs = (docsRes.data ?? []) as {
    confluence_page_id: string
    title: string
    section: string
    version: number
    synced_at: string
  }[]
  const sections = new Map<string, typeof docs>()
  for (const d of docs) sections.set(d.section, [...(sections.get(d.section) ?? []), d])
  const lastSynced = docs.reduce<string | null>((max, d) => (max === null || d.synced_at > max ? d.synced_at : max), null)

  const asked = (askedRes.data ?? []) as KbQuestion[]

  return (
    <>
      <div className="col-span-full">
        <RegisterHeader
          trail={[ROOT_CRUMB, { label: 'Help' }]}
          title="Policies and procedures"
          description="Search what the firm’s written policies say, open one to read it, or take the question to Claude. Synced from Confluence; every page shows its version and when it was last synced."
        />
      </div>

      <Card className="col-span-full lg:col-span-8" title="Ask about a policy">
        <KbAsk searchUrl={`${SUPABASE_URL()}/functions/v1/kb-search`} initialQuestion={q ?? ''} />
      </Card>

      <div className="col-span-full flex flex-col gap-4 lg:col-span-4">
        <Card title="Policies and procedures">
          {docs.length === 0 ? (
            <p data-slot="kb-empty" className="text-sm text-neutral-500">
              Nothing has been synced yet. The first sync fills this list.
            </p>
          ) : (
            <div className="flex flex-col gap-4">
              {[...sections.entries()].map(([section, list]) => (
                <section key={section} data-slot="kb-section">
                  <h3 className="mb-1.5 flex items-baseline justify-between text-[11px] font-semibold uppercase tracking-wider text-neutral-500">
                    <span>{section}</span>
                    <span className="font-medium tabular-nums text-neutral-400">{list.length}</span>
                  </h3>
                  <ul className="flex flex-col">
                    {list.map((d) => (
                      <li key={d.confluence_page_id}>
                        <Link
                          href={`/help/${encodeURIComponent(d.confluence_page_id)}`}
                          className="flex items-baseline justify-between gap-3 rounded px-1.5 py-1 text-sm text-neutral-800 hover:bg-neutral-50"
                        >
                          <span className="min-w-0 truncate">{d.title}</span>
                          <span className="shrink-0 text-[11px] tabular-nums text-neutral-400">v{d.version}</span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                </section>
              ))}
              {lastSynced ? (
                <p className="text-[11px] text-neutral-400">
                  Last synced {new Date(lastSynced).toLocaleString('en-AU', { dateStyle: 'medium', timeStyle: 'short' })}
                </p>
              ) : null}
            </div>
          )}
        </Card>

        <Card title="Your questions">
          {asked.length === 0 ? (
            <p className="text-sm text-neutral-500">
              Questions you take to Claude are recorded here — the question and what the policies showed at the time,
              not Claude’s answer, which stays in your own account.
            </p>
          ) : (
            /* Re-asks the question rather than replaying a stored snapshot: the
               policy may have been re-synced since, and the fresh answer is the
               one that matters. The snapshot stays in the database regardless. */
            <ul data-slot="kb-history" className="flex flex-col">
              {asked.map((k) => (
                <li key={k.id}>
                  <Link
                    href={`/help?q=${encodeURIComponent(k.title)}`}
                    className="block rounded px-1.5 py-1 text-sm text-neutral-800 hover:bg-neutral-50"
                  >
                    <span className="block truncate">{k.title}</span>
                    <span className="block text-[11px] text-neutral-400">
                      {new Date(k.updated_at).toLocaleDateString('en-AU', { dateStyle: 'medium' })}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Card className="col-span-full lg:col-span-6" title="Getting started">
        <dl className="flex flex-col gap-3">
          <div>
            <dt className="text-xs text-neutral-500">Two-factor authentication</dt>
            <dd className="mt-0.5 text-sm text-neutral-700">
              Required for everyone, with no exceptions and no way to skip it. If you have lost your authenticator, ask for
              your factor to be reset — it cannot be recovered from this end.
            </dd>
          </div>
          <div>
            <dt className="text-xs text-neutral-500">What you can see</dt>
            <dd className="mt-0.5 text-sm text-neutral-700">
              Your access profile and user groups decide which client groups appear. Seeing fewer groups than a colleague
              is the system working, not a fault. Your current profile is shown on your{' '}
              <Link href="/profile" className="text-brand underline decoration-brand/30 underline-offset-2 hover:decoration-brand">
                profile page
              </Link>
              .
            </dd>
          </div>
          <div>
            <dt className="text-xs text-neutral-500">Hidden identifiers</dt>
            <dd className="mt-0.5 text-sm text-neutral-700">
              Tax file numbers and similar identifiers show as dots with an eye icon beside them. Revealing one is
              recorded against your name, and the value hides itself again after thirty seconds.
            </dd>
          </div>
        </dl>
      </Card>

      <Card className="col-span-full lg:col-span-6" title="If something looks wrong">
        <p className="text-sm text-neutral-700">
          Client records are audited on every change, so a mistake can always be traced and corrected — please report it
          rather than working around it.
        </p>
        <ul className="mt-3 flex flex-col gap-2 text-sm text-neutral-700">
          <li className="flex gap-2">
            <span aria-hidden className="select-none text-neutral-300">
              &middot;
            </span>
            <span>
              A record you expected to see is missing, or one you did not expect is visible — this is an access question,
              not a data one.
            </span>
          </li>
          <li className="flex gap-2">
            <span aria-hidden className="select-none text-neutral-300">
              &middot;
            </span>
            <span>A valuation or benefit amount does not match the provider statement.</span>
          </li>
          <li className="flex gap-2">
            <span aria-hidden className="select-none text-neutral-300">
              &middot;
            </span>
            <span>A save appears to succeed but the change is not there afterwards.</span>
          </li>
        </ul>
        <p className="mt-4 text-sm text-neutral-500">
          A policy on this page is a copy of the Confluence page, refreshed by the nightly sync. If the copy and Confluence
          disagree, Confluence is right and the sync is behind.
        </p>
      </Card>
    </>
  )
}
