import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Markdown, outline } from '@/components/markdown'
import { Card, PageHeading } from '@/components/ui'
import { createSupabaseServerClient } from '@/lib/supabase/server'

/*
 * The reader: one policy or procedure, from the copy in kb_documents.
 *
 * Inside the CRM rather than a link out to Confluence, for three reasons a
 * search result cares about: it works when Confluence is down, it sits behind
 * the same sign-in and second-factor gate as everything else here, and it is
 * the only way a result can land on the heading it matched — the chunker's
 * `anchor` is the id the Markdown component gives the heading.
 *
 * THREE COLUMNS, THE POLICY IN THE MIDDLE. The page the document's own facts
 * on the left and its headings on the right, so neither interrupts the reading
 * column. The middle stays at six of twelve, which at this type size is close
 * to the 65-character measure a long policy needs; widening it to fill the
 * space would make the page harder to read, not easier.
 *
 * The version and sync time are on the page so a stale copy is visible rather
 * than silent. A retired page (absent from the last sync) still opens, marked
 * as such, because a recorded answer may cite it.
 */
export default async function KnowledgeBasePage({ params }: { params: Promise<{ pageId: string }> }) {
  const { pageId } = await params
  const supabase = await createSupabaseServerClient({ writable: false })
  const { data } = await supabase
    .from('kb_documents')
    .select(
      'id, confluence_page_id, title, section, url, version, body_md, excluded, excluded_reason, retired_at, retired_reason, synced_at, page_created_at, page_updated_at',
    )
    .eq('confluence_page_id', pageId)
    .maybeSingle()
  if (!data) notFound()

  const doc = data as {
    id: string
    confluence_page_id: string
    title: string
    section: string
    url: string
    version: number
    body_md: string
    excluded: boolean
    excluded_reason: string | null
    retired_at: string | null
    retired_reason: string | null
    synced_at: string
    page_created_at: string | null
    page_updated_at: string | null
  }

  /* How many passages this page contributes to search. Zero is not a
     rounding error — it is the whole answer to "why does this page never come
     up", which is otherwise invisible from the reader. */
  const { count } = await supabase
    .from('kb_chunks')
    .select('id', { count: 'exact', head: true })
    .eq('document_id', doc.id)

  const headings = outline(doc.body_md)

  return (
    <>
      <PageHeading
        eyebrow={doc.section}
        title={doc.title}
        description={
          day(doc.page_updated_at)
            ? `Version ${doc.version} · last edited ${day(doc.page_updated_at)} in Confluence`
            : `Version ${doc.version}`
        }
        actions={
          <div className="flex items-center gap-3 text-xs">
            <Link href="/help" className="text-neutral-500 hover:text-neutral-800">
              ← All policies
            </Link>
            <a
              href={doc.url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-brand underline decoration-brand/30 underline-offset-2 hover:decoration-brand"
            >
              Open in Confluence
            </a>
          </div>
        }
      />

      {doc.retired_at ? (
        <div
          data-slot="kb-retired"
          className="col-span-full rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900"
        >
          This page was retired on {day(doc.retired_at)}
          {doc.retired_reason ? ` — ${doc.retired_reason.toLowerCase()}` : ''}. It is kept because an answer may have cited it;
          it is no longer searched.
        </div>
      ) : null}

      {/* Left: what the document is, rather than what it says. */}
      <Card className="col-span-full lg:col-span-3 lg:sticky lg:top-24 lg:self-start">
        <dl data-slot="kb-profile" className="flex flex-col gap-3 text-sm">
          <Fact label="Section" value={doc.section} />
          <Fact label="Version" value={String(doc.version)} />
          <Fact label="Created" value={day(doc.page_created_at)} />
          <Fact label="Updated" value={day(doc.page_updated_at)} />
          <Fact
            label="Synced"
            value={new Date(doc.synced_at).toLocaleString('en-AU', { dateStyle: 'medium', timeStyle: 'short' })}
          />
          <Fact
            label="Passages"
            value={
              doc.excluded
                ? `Not indexed${doc.excluded_reason ? ` — ${doc.excluded_reason.toLowerCase()}` : ''}`
                : count === null
                  ? null
                  : `${count} searchable`
            }
          />
        </dl>
      </Card>

      {/* Middle: the policy. */}
      <Card className="col-span-full lg:col-span-6" padding="roomy">
        <Markdown source={doc.body_md} />
      </Card>

      {/* Right: where to jump to. Hidden on a phone, where the article is
          already the whole screen and a list of links above it is a wall. */}
      {headings.length > 1 ? (
        <Card
          className="col-span-full hidden lg:col-span-3 lg:block lg:sticky lg:top-24 lg:self-start lg:max-h-[calc(100dvh-8rem)] lg:overflow-y-auto"
        >
          <p className="text-[11px] font-semibold uppercase tracking-widest text-neutral-400">On this page</p>
          <nav data-slot="kb-outline" className="mt-3 flex flex-col gap-1.5 text-sm">
            {headings.map((h) => (
              <a
                key={h.id}
                href={`#${h.id}`}
                className={`block text-neutral-600 hover:text-brand ${h.depth === 1 ? 'pl-3 text-[13px] text-neutral-500' : ''}`}
              >
                {h.text}
              </a>
            ))}
          </nav>
        </Card>
      ) : null}
    </>
  )
}

/** One row of the profile. A missing value says so rather than showing a
 *  plausible wrong one — see the migration that added these columns. */
function Fact({ label, value }: { label: string; value: string | null }) {
  return (
    <div>
      <dt className="text-[11px] font-semibold uppercase tracking-widest text-neutral-400">{label}</dt>
      <dd className={`mt-0.5 ${value ? 'text-neutral-800' : 'text-neutral-400'}`}>{value ?? 'Not recorded'}</dd>
    </div>
  )
}

function day(iso: string | null): string | null {
  return iso ? new Date(iso).toLocaleDateString('en-AU', { dateStyle: 'medium' }) : null
}
